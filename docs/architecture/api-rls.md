# APIとアクセス制御

DB接続モードで提供するAPIと認可の仕様です。画面からの操作も、以下のAPIと通常ユーザーのJWTを使います。機能ごとの受け入れ条件は[仕様一覧](../specs/)、データの構造は[データモデル](data-model.md)を参照してください。

## 共通ルール

- ベースパスは `/api/v1/workspaces/:wid`。`:wid` はワークスペースのUUIDです。
- セッションCookieを検証し、ユーザーのJWTでSupabaseに接続します。通常の画面・APIで管理キー（service_role）は使いません。
- 所属するワークスペース内の全プロジェクトを閲覧できます。無所属と対象の不存在は、どちらも404です。
- 変更要求は `APP_ORIGIN` と同じOriginからだけ受け付けます。JSONの上限は32KiBです。本文の全項目を必須とし、不明なキーを拒否します。未設定の担当・期限は `null` を送ります。
- 業務APIのJSON応答には `Cache-Control: private, no-store` を付けます。認証済みデータを共有キャッシュしません。

| ロール | 閲覧 | 変更できるもの |
|---|---|---|
| admin（管理者） | 所属先の全データ | プロジェクト、タスク、課題・コメント、メンバー所属 |
| member（メンバー） | 所属先の全データ | タスク、課題・コメント（他者のコメントの変更は不可） |
| viewer（閲覧者） | 所属先の全データ | なし |

アーカイブ済みプロジェクトのタスク・課題・コメントは、全ロールで閲覧専用です。管理者はプロジェクト情報の編集とアーカイブからの復元ができます。

## エンドポイント

以下はすべてベースパスからの相対パスです。`pid`、`tid`、`iid`、`cid`、`uid` はそれぞれプロジェクト、タスク、課題、コメント、ユーザーのUUIDです。

| メソッド・パス | 用途・本文 | 権限・成功応答 |
|---|---|---|
| GET /dashboard | ワークスペースの集計。クエリー指定不可 | 所属者 / 200 |
| GET /projects | プロジェクト一覧 | 所属者 / 200 |
| POST /projects | `name, description, due_date` | admin / 201 |
| GET /projects/:pid | プロジェクト取得 | 所属者 / 200 |
| PATCH /projects/:pid | `name, description, due_date, status, version` | admin / 200 |
| GET /projects/:pid/tasks | タスク一覧 | 所属者 / 200 |
| POST /projects/:pid/tasks | `title, description, priority, assignee_id, due_date` | admin・member / 201 |
| GET /projects/:pid/tasks/:tid | タスク取得 | 所属者 / 200 |
| PATCH /projects/:pid/tasks/:tid | 作成と同じ5項目 + `version` | admin・member / 200 |
| POST /projects/:pid/tasks/:tid/move | `status, before_id, version` | admin・member / 200 |
| DELETE /projects/:pid/tasks/:tid | `version` | admin・member / 204 |
| GET /projects/:pid/issues | 課題一覧 | 所属者 / 200 |
| POST /projects/:pid/issues | `title, description, priority, assignee_id, due_date` | admin・member / 201 |
| GET /projects/:pid/issues/:iid | 課題取得 | 所属者 / 200 |
| PATCH /projects/:pid/issues/:iid | 作成と同じ5項目 + `status, version` | admin・member / 200 |
| DELETE /projects/:pid/issues/:iid | `version` | admin・member / 204 |
| GET /projects/:pid/issues/:iid/comments | コメント一覧（limit/cursor） | 所属者 / 200 |
| POST /projects/:pid/issues/:iid/comments | `body`、Idempotency-Key必須 | admin・member / 201 |
| GET /projects/:pid/issues/:iid/comments/:cid | コメント取得 | 所属者 / 200 |
| PATCH /projects/:pid/issues/:iid/comments/:cid | `body, version` | admin・投稿者本人のmember / 200 |
| DELETE /projects/:pid/issues/:iid/comments/:cid | `version` | admin・投稿者本人のmember / 204 |
| GET /members | メンバー一覧・担当件数 | 所属者 / 200 |
| POST /members | 登録済みユーザーの `user_id, role` | admin / 201 |
| GET /members/:uid | 所属情報取得（担当件数は含まない） | 所属者 / 200 |
| PATCH /members/:uid | `role, version` | admin / 204 |
| DELETE /members/:uid | `version`。担当解除と所属解除 | admin / 204 |
| GET /activity | 操作履歴。変更APIは提供しない | 所属者 / 200 |

プロジェクトの削除APIはありません。アーカイブで代替します。タスク編集では状態・位置を変更せず、専用のmove APIを使います。`before_id` は移動先で直後に続くタスクID、`null` は列の末尾です。`position` 自体は入力に含めません。

## 自分の表示名

ワークスペースのAPIとは別に `PATCH /api/v1/me/profile` を提供します。本文は `{display_name}` のみ、成功は200 `{data:{id,display_name}}` です。認証済みの本人が所属やロールに関係なく利用できます。対象ユーザーIDは受け取りません。Origin、JSON32KiB、未知・欠落キーを検査し、応答は `private, no-store` です。

前後の空白を取り除き、Unicodeの文字数で1〜80文字を受け付けます。空文字、長さ超過、NUL文字は400です。DBの `update_my_profile(p_display_name text)` でも同じ空白除去と長さ検証を行い、`auth.uid()` の行だけを更新します。所有者は `project_hub_owner`、`search_path` は空固定、実行は `authenticated` のみに許可します。プロフィールの直接更新権限は付与しません。

変更後の表示名は、再取得したメンバー一覧・担当者候補と今後の操作履歴に反映します。過去の `actor_display_name` とコメントの投稿者名は記録当時の値を保持します。初期値「デモメンバー」は維持し、メールアドレス由来の情報を表示名へ自動転記しません。

## 一覧の検索とページ送り

`limit` は既定25、1〜100です。`cursor` はAPIが返した値をそのまま渡します。未知・重複したクエリー、無効なenum・UUID・limit・cursorは400です。

| 一覧 | 検索条件（limit・cursor以外） | 並び順・既定値 |
|---|---|---|
| projects | `q, status` | created_at DESC、id DESC。qは名前の部分一致 |
| tasks | `status, priority, assignee` | position ASC、id ASC。statusは既定todo |
| issues | `q, status, priority, assignee` | created_at DESC、id DESC。statusは既定unresolved（open・investigating）、allで全状態 |
| comments | なし | created_at DESC、id DESC。親課題の範囲に限定 |
| members | `role` | user_id ASC。cursorもユーザーUUID |
| activity | `action, entity, project, actor, from, to` | created_at DESC、id DESC |

タスク・課題の `assignee` はユーザーUUIDまたは `unassigned`（未割当）です。課題のqは件名の部分一致です。

操作履歴のactionはINSERT / UPDATE / DELETE、entityはprojects / tasks / issues / memberships / issue_commentsです。project・actorはUUIDで指定でき、削除済み対象や所属解除済み操作者の記録も検索できます。from・toは日本時間の `YYYY-MM-DD` で、両端の日を含みます。片側指定・空欄は許可し、存在しない日付や開始日と終了日の逆転は400です。詳細は[期間検索仕様](../specs/012-activity-date-filter.md)を参照してください。

## 応答とエラー

一覧は `{ "data": [], "nextCursor": null }`、単一取得・作成・更新は `{ "data": {...} }` です。ダッシュボードは集計結果をdataに返します。204は本文を返しません。日時はUTCのISO 8601、期限は `YYYY-MM-DD` です。

| HTTP | 主な原因 |
|---|---|
| 400 | 入力・検索条件・送信キーが不正 |
| 401 | 未認証 |
| 403 | ロール不足、Origin不一致 |
| 404 | 無所属、対象不存在、登録されていないユーザーID |
| 409 | version競合、送信キーの本文違い、アーカイブ内変更、最後の管理者の変更・解除、既存所属への追加 |
| 413 / 415 | 本文サイズ超過 / JSON以外の変更要求 |
| 500 / 503 | 内部処理失敗 / 接続設定なし |

業務APIのエラー形式は次のとおりです。SQLや資格情報は応答へ含めません。

```json
{
  "error": {
    "code": "VERSION_CONFLICT",
    "message": "他の操作で更新されました。最新版を読み直してください。",
    "requestId": "..."
  }
}
```

## 更新競合と再送

編集・削除・タスク移動には取得時の `version` が必要です。不一致なら409となり、画面では入力を保持して最新版の取得を案内します。変更と操作履歴は同じDBトランザクションで確定します。タスク移動はプロジェクト行をロックし、列の順序とversionを更新します。

プロジェクト・タスク・課題・コメントの作成と所属追加には `Idempotency-Key` が必須です。1〜128文字の英数字・`_`・`-` を受け付けます。タスクのmove APIには不要です。

- キーはワークスペース・操作者・作成対象の種類で分離します。タスク・課題ではさらにプロジェクト、コメントではプロジェクト・課題で分離します。
- 24時間以内の同じキー・同じ本文は初回の成功応答を返します。異なる本文なら409です。
- 再送時も現在の権限を検査します。タスク・課題・コメントではアーカイブ状態も検査します。
- 保存後に対象を変更・削除しても、再送は当時の受付結果を返すだけで、データを復元・上書きしません。
- 期限切れの記録は、同じワークスペース・操作者が次にその種類の作成APIを呼んだときに削除します。

## 集計とメンバー管理

ダッシュボードの `read_dashboard` とメンバー一覧の `read_members` はSECURITY INVOKERで実行し、呼出者のSELECT権限とRLSを維持します。どちらもDB内で全件を集計し、取得行数の上限による切り捨てを防ぎます。

ダッシュボードはアーカイブを除外し、完了率・期限超過・未解決課題を集計します。自分の未完了タスクは本人だけが対象です。プロジェクト進捗・自分のタスク・最近の操作は各5件を表示しますが、集計値の件数制限ではありません。最近の操作にはアーカイブも含みます。

メンバー一覧の `task_count` はplanned / active内のtodo / doing / review、`issue_count` は同じ範囲のopen / investigatingです。詳細GETの応答に担当件数は含めません。[担当件数仕様](../specs/013-member-assignment-counts.md)を参照してください。

所属追加は既知の登録済みユーザーIDの直接指定です。プロフィール候補検索、ユーザー作成、メール送信は行いません。既存所属は409 `ALREADY_MEMBER` とし、ロールを上書きしません。所属変更・解除ではワークスペース行をロックし、最後の管理者を失う操作を409 `LAST_ADMIN` で拒否します。[所属追加仕様](../specs/014-add-workspace-member.md)と[メンバー管理仕様](../specs/007-connected-members.md)を参照してください。

## 認可・RLS

8つのpublic業務テーブルはすべてRLSを有効にしています。anonのアクセスとauthenticatedの直接書き込みを拒否し、変更は許可したRPCに限定します。UI上の非表示だけでは認可しません。

| テーブル | authenticatedのSELECT | 変更経路 |
|---|---|---|
| profiles | 自分、または共通ワークスペースの所属者 | Auth登録時のトリガー・管理用の初期設定。プロフィール編集APIはなし |
| workspaces | 所属先 | 初期作成RPC。通常画面に作成UIはなし |
| memberships | 所属先のメンバー | 管理者向けRPC |
| projects | 所属先 | 管理者向けRPC |
| tasks / issues | 所属先 | 管理者・メンバー向けRPC |
| issue_comments | 所属先の課題に属するコメント | 現在のadmin/memberの投稿、adminまたはmember本人の編集/削除RPC |
| activity_logs | 所属先 | 変更時のDBトリガーのみ |

`private.is_member`・`is_admin`・`can_read_profile` は、所属表のRLS再帰を避けるためのSECURITY DEFINER関数です。変更RPCもSECURITY DEFINERですが、操作者は `auth.uid()` から確定し、所属・ロール・親子関係・versionをDB内で再検査します。所有者はログイン不可の専用ロール、search_pathは空、参照先は完全修飾です。再送記録のprivateテーブルもRLSを有効にし、通常ユーザーの直接アクセスを許可しません。

操作履歴は当時の操作者名を保存し、本文・トークンを記録しません。APIはchangesから許可されたstatus・role・versionだけを取り出します。対象や操作者の現在の行との結合を必須にしないため、削除・所属解除後も記録を保持します。DB管理者による改変まで検知する仕組みではありません。

## 認証・公開設定と検証

ログインは `POST /auth/login`、ログアウトは `POST /auth/logout` です。事前登録済みアカウントのメール・パスワード認証を使用します。一般登録と招待は対象外です。

Vercel PreviewはDB未接続、本番の接続モードは正規HTTPSオリジンと公開用Supabaseキーを指定します。HTTPSのセッションCookieはSecureを付け、画面にnoindex / nofollow、nosniff、frame DENYなどを設定します。環境ごとの手順と実測したCookie属性は[公開・運用手順](../deployment.md)を参照してください。

DBテストではロール・所属・直接書き込み拒否・監査・同時再送・最後の管理者・アーカイブ・version競合を確認します。認証E2EではAPI境界、フォーム、検索とページ送り、失敗復旧、キーボード・モバイル操作を確認します。実行方法は[ローカル開発手順](../local-development.md)にまとめています。

## 課題コメント

本文は前後の空白を除いて1〜5,000文字。投稿者・表示名・親ID・日時・version初期値はDBで確定します。更新・削除時は取得済みversionを競合検査用に送ります。作成はcreate_comment_once、編集はedit_comment、削除はdelete_comment RPCがworkspace→project→issue→commentの順にロックして親子関係・ロール・投稿者・version・アーカイブを検査します。課題削除時はコメントも削除し、監査と再送結果は保持します。本文は監査changesに含めません。詳細は[仕様016](../specs/016-issue-comments.md)。
