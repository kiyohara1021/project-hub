# API・RLS設計

## 実装状況

P2で認証・プロジェクト管理、P3でタスクCRUD・移動・再送対応とダッシュボードGETを実装。現在の契約・対象外は[ダッシュボード仕様](../specs/005-connected-dashboard.md)、[カンバン仕様](../specs/004-connected-kanban.md)、[ローカル手順](../local-development.md)を参照。以下は今後を含む基本設計であり、全APIの実装済み保証ではない。HTTP変更は32KiBのJSONのみ、契約の全項目を必須とし、不明なキーを拒否する。タスクの状態変更は専用moveルートでbefore_idを指定し、position自体は入力として受け付けない。タスク編集/削除/移動はadmin/memberに許可、アーカイブ内では拒否する。

ダッシュボードGETは追加クエリーを受け付けず、集計日と本人はDBの現在時刻・auth.uid()から決定する。read_dashboardはSECURITY INVOKERでテーブルのRLSとSELECT権限を維持する。役割に関係なく所属者はworkspace全体を集計できるが、個人タスクは呼出者本人に限定。進捗・タスク・ログの表示上限5件と、全件数を使う集計は別に処理する。

## API契約

Next.js Route Handlersの `/api/v1`。セッションcookieを検証しユーザーJWTでSupabaseに接続する。通常操作でservice_roleを使用しない。

以下のパスは `/workspaces/:wid` を接頭辞に持つ。

| メソッド・パス | 入出力・用途 | ロール |
|---|---|---|
| GET /dashboard | 進捗・期限超過・未解決課題集計 | 所属者 |
| GET /projects | q/status/cursor/limitで一覧 | 所属者 |
| POST /projects | name,description,due_dateで作成 | admin |
| PATCH /projects/:pid | name,status,due_date,versionで編集 | admin |
| GET /projects/:pid/tasks | status/assignee/cursor/limitで一覧 | 所属者 |
| POST /projects/:pid/tasks | title,description,priority,assignee_id,due_date | admin/member |
| PATCH /projects/:pid/tasks/:id | 編集・status/position/version | admin/member |
| DELETE /projects/:pid/tasks/:id | version必須 | admin/member |
| GET・POST /projects/:pid/issues | 一覧・課題作成 | 読取は所属者、作成はadmin/member |
| PATCH・DELETE /projects/:pid/issues/:id | 編集・削除、version必須 | admin/member |
| GET /members | 架空表示名・ロール・担当数 | 所属者 |
| POST /members | 登録済みデモuser_id,role | admin |
| PATCH /members/:uid | role変更 | admin |
| DELETE /members/:uid | 担当解除と所属削除 | admin |
| GET /activity | project/action/actor/cursor/limit | 所属者 |

ログイン・ログアウト・callbackはSupabase Authの別ルート。招待メールと一般登録は初期対象外。ローカルで架空ユーザーを事前作成する。

課題の作成入力はtitle/description/priority/assignee_id/due_date、更新にはstatusも許可。タスクも課題も状態の初期値はそれぞれtodo/open。

作成201、更新200、削除204。一覧は `{ "data": [], "nextCursor": null }`、単一は `{ "data": { "id": "uuid", "version": 1 } }`。日時はISO 8601 UTC、期限はYYYY-MM-DD。

400入力不正、401未認証、403ロール不足、404無所属/不存在、409競合・最後のadmin削除、429過剰要求、500内部失敗。エラーは `{ "error": { "code": "VERSION_CONFLICT", "message": "再読み込みしてください", "requestId": "..." } }`。SQLや秘密情報を返さない。

limitは1〜100、初期25。通常一覧はcreated_at DESC,id DESC、履歴も同順。カンバンはstatusごとにposition ASC,id ASC。カーソルはソート値とidを含み形式検証。全変更は単一トランザクションのRPCで権限・所属・アーカイブ・versionを確認する。UPDATEのversion条件に一致しなければ409。カンバン移動はproject行をロックして順序とversionを更新し、失敗時に楽観的UIを戻す。POSTはIdempotency-Keyをactor/workspace/path単位に24時間保持し、同じキーで異なる本文は409。

## 認可・RLS

実装前の設計。public業務テーブルは全てRLSを有効化。anonは全拒否。authenticatedも所属のない行は拒否。UI非表示は認可の代わりにならない。

| テーブル | SELECT | 変更 |
|---|---|---|
| profiles | 自分・共通workspaceの所属者のid/表示名 | 自分の表示名だけ専用RPC |
| workspaces | 所属者 | 初期作成RPCのみ |
| memberships | 同じworkspace所属者 | admin RPCのみ |
| projects | 所属者 | admin RPCのみ |
| tasks/issues | 所属者 | admin/member RPCのみ |
| activity_logs | 所属者 | DBトリガーのみ |

authenticatedの直接テーブル書込権限をREVOKEし、許可したRPCにだけEXECUTEをGRANT。SELECTをRLSで保護する。通常利用者は履歴を変更・削除できない。

```sql
-- 概念例。実装時に全テーブルへ展開して検証する
alter table public.projects enable row level security;
create policy projects_read on public.projects
for select to authenticated
using (private.is_member(workspace_id));
```

private.is_member/has_roleはsecurity definer、search_path=''、完全修飾参照。auth.uid()がNULLならfalse。API非公開スキーマに配置し、所属表RLSの再帰を防ぐ。限定した所有者で実行しPUBLIC権限を剥奪、必要なauthenticatedだけに実行許可。任意actor_idを引数にしない。

変更RPCはRLSを迂回し得るため、auth.uid()からactorを確定して必要ロール・行のworkspace一致を明示検証する。workspace_id/project_idの書換えを禁止し、アーカイブ内の変更を拒否。所属変更はworkspace行をFOR UPDATEでロックし、最後のadminを失う変更を拒否。初期workspaceと作成者adminは同時作成する。

履歴トリガーは変更項目名と状態など許可した値だけ記録し、本文・トークンを保存しない。actorとchangesはクライアント入力を信用しない。変更と履歴は同時確定。DB管理者による変更まで防ぐ改ざん証明機構ではない。service_roleをブラウザ・通常APIに配置しない。

## 必須テスト

未認証、無所属、別workspace、viewer、member、adminそれぞれのJWTで全テーブルと全RPCの許可/拒否を確認。ID推測、担当すり替え、workspace変更、直接REST書込、自己昇格、履歴偽造、最後のadminの同時削除、アーカイブへの書込、version競合、集計からの漏洩を検証する。

参考: [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)。
