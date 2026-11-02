# ローカル認証・DB開発

Dockerを起動し、Node.js 24 / pnpm 9.15.0を使用する。クラウドSupabaseは不要。

```sh
pnpm install --frozen-lockfile
pnpm db:start
pnpm db:seed
pnpm db:env
pnpm dev
```

http://127.0.0.1:3000/dashboard を開くと未認証の場合はログインへ移動する。ログイン後はダッシュボードで所属先の集計を確認できる。プロジェクト一覧で名前を選ぶとカンバンへ、課題リンクを選ぶと課題一覧へ移動する。管理者はプロジェクト管理、管理者/メンバーはタスク・課題管理が可能。閲覧者とアーカイブ済みプロジェクトは読み取り専用。管理者はメンバーのロール変更・所属解除も可能。操作履歴は読み取り専用でDBの記録を表示。

## 架空のログイン情報

ローカル専用。共通パスワードは `Local-Demo-Only-2026!`。リモート・本番に使用しない。

| メール | 表示名 | 所属・権限 |
|---|---|---|
| admin@example.invalid | デモメンバー01 | デモスペースA・管理者 |
| member@example.invalid | デモメンバー02 | デモスペースA・メンバー |
| viewer@example.invalid | デモメンバー03 | デモスペースA・閲覧者 |
| outside@example.invalid | デモメンバー04 | デモスペースB・管理者 |
| unassigned@example.invalid | デモメンバー05 | 所属なし |

`db:seed` はCLIのローカル接続情報だけを使い、127.0.0.1:54321以外を拒否する。登録済みユーザーを再利用し、架空データをupsertする。`db:env` は管理鍵を含めず、無視対象の `.env.local` に公開用接続鍵だけを書く。別設定の既存ファイルは上書きしない。

APP_ORIGINはブラウザで開くURLのoriginと完全一致させる。初期値は http://127.0.0.1:3000 。ポートやホストを変更する場合はこの設定も変更する。ログイン/ログアウトと書込APIはこのOriginだけを許可する。Supabase URLは別のローカルAPI（54321）。

## 再構築・テスト

```sh
# このリポジトリのローカルDBを初期化する。クラウドには接続しない。
pnpm db:reset
pnpm db:seed
pnpm test:db
pnpm db:env
pnpm lint
pnpm typecheck
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
pnpm test:auth
```

DBテストは所属解除や同時降格まで実行し、検証用workspaceを追加する。初期状態へ戻すには `db:reset` と `db:seed` を実行する。認証テストは3101、プレビューのE2Eは3100を占有するため、そのポートの手動起動サーバーを先に停止する。認証テストはlocalhostを許可した固定Originへ自動設定する。

終了時は `pnpm db:stop`。ローカルデータはバックアップされる。一般登録は無効、メール/SMS送信は行わない。`.env.local` やCLIの接続鍵をコミットしない。クラウドへ移す際はこのseedを適用せず、別の設定とユーザー管理手順を用意する。

## 今回のDB契約

実装済みRPC: create_workspace / create_project / update_project / set_member_role / remove_member / create_project_once / edit_project / create_task_once / edit_task / delete_task / move_task / read_dashboard / create_issue_once / edit_issue / delete_issue / change_member。所属追加・プロフィール変更は後続段階。

一覧APIはq（名前部分一致）/status/limit(1〜100)/cursorを受け付け、created_at DESC,id DESCでページングする。cursorはAPIが返す不透明な文字列をそのまま渡す。未対応/重複パラメーターは400。APIはservice_roleを使わず、cookieのJWTを検証してRLS付きで読み取る。

POST `/api/v1/workspaces/:wid/projects` はIdempotency-Key必須。24時間は同じ本文・キーで再試行しても同じ作成結果を返す。本文を変えた再送は409。PATCH `.../projects/:pid` はversion必須で、古いversionは409。画面は失敗時の入力を保持し、競合時は「入力を破棄して最新版を読み直す」を明示的に選択できる。期限切れの再送記録は同じworkspace/actorが次に作成した時に削除するため、厳密な24時間後の物理削除ではない。

参考（2026-11-01確認）: [Supabase SSR](https://supabase.com/docs/guides/auth/server-side/creating-a-client?framework=nextjs&queryGroups=framework)、[ローカル開発](https://supabase.com/docs/guides/local-development/cli/getting-started)。

## カンバン操作

プロジェクト一覧から名前を選び、列ごとに25件ずつ表示する。「さらに読み込む」で続きへ進む。担当者/優先度を選択して絞り込み、リセットで解除する。スマートフォンは表示状態を選んで1列ずつ操作する。

管理者/メンバーはタスクを追加し、編集から担当・優先度・期限を変更できる。削除には確認が必要。PCではカードを別列の余白へドラッグすると列末尾へ、カード上へ落とすとその前へ移動する。状態メニューと「上へ」ボタンはキーボード/モバイル向けの代替操作。

移動後は列を再取得するため、追加読込済みでも最初の25件に戻る。他ユーザーの並び替えがあった場合も、再読み込みで整合させる。作成の再送時にも権限とアーカイブ状態を検査する。DBテストは共通の架空データを変更するためファイルを直列実行し、所属解除テスト後は初期メンバーを復元する。

supabase/config.tomlはローカル専用で、反復テスト用のログイン枠を設定している。本番の認証設定はこのファイルをそのまま使わず別途検討する。

## ダッシュボード

ワークスペースを選び「最新の状況を取得」で更新する。完了率はアーカイブ以外の全タスクに対する完了数の割合（0件は0%）で、プロジェクト別の率を平均しない。期限超過は日本時間で今日より前の未完了タスク。未解決課題はopen/investigatingで、課題一覧の作成・解決・再開・削除も次の取得時に反映される。

プロジェクト進捗・自分の未完了タスク・最近の操作はそれぞれ最大5件。最近の操作だけはアーカイブも含むworkspace全体から取得し、本文や変更内容ペイロードを返さない。自分のタスクのリンクは担当者と `column` をカンバンへ引き継ぐ。

集計RPCはSECURITY INVOKERでRLSを維持し、1,001件のテストでもHTTPの行数上限で切り捨てないことを検証している。日付境界とSECURITY INVOKERの検証は `scripts/local-sql.mjs` からローカルDockerコンテナだけに固定SQLを実行する。認証画面テストは専用fixtureと一時的な関数実行権限の剥奪で障害復旧も確認し、finallyで権限を復元するため、テストの強制終了時は `pnpm db:reset` で再構築する。

## 課題管理

プロジェクト一覧またはカンバンから課題一覧へ進む。既定は未解決・調査中だけを表示し、「すべて」「解決済み」「終了」も選べる。件名、状態、優先度、担当者を組み合わせて検索でき、25件ずつページを送る。PCは表、スマートフォン/タブレットはカード表示で、「説明を見る」から本文を確認する。

admin/memberは課題追加・編集・削除が可能。状態変更は編集ダイアログで選択し、確認して保存する。解決後は既定の一覧から消えるため、解決済みで検索して再開する。削除も確認が必要。409は入力を保持し、明示操作で最新版を読み直す。作成の再送は24時間、同じ本文とキーなら同じ作成結果を返し、再送時にも現在の権限・アーカイブ状態を検証する。

## メンバー管理

`/members?workspace=11111111-1111-4111-8111-111111111111`で架空メンバーを表示。adminで権限管理、member/viewerで読取専用を確認。最後の管理者の所属解除は拒否される。新規招待・外部メール送信は未対応。DB/E2Eに所属解除の副作用・競合・最後の管理者保護を追加。

## 操作履歴

`/activity?workspace=11111111-1111-4111-8111-111111111111`で所属先の記録を表示。操作・対象種別を選択し、各履歴のリンクから操作者・プロジェクトで絞り込む。条件変更/ページ送りは条件を保持、所属先切替でリセット。ログは日本時間と当時の操作者名を表示し、現在の氏名や本文を補完しない。既存のactivity_logs/RLS/インデックスを使用し、新規マイグレーションは不要。[仕様](specs/008-connected-activity.md)。

## 公開準備の検証

`pnpm test:release`はクラウド設定検査のテスト。`pnpm build:vercel`は環境変数の形式確認後にビルドします（.env自動読込なし）。ローカル用URLのまま本番接続を許可しません。通常ローカルビルドは`pnpm build`。実際の公開は[公開手順](deployment.md)を参照。ローカル専用のseed/DBテストをリモートに向けないでください。

## 登録済みユーザーの所属追加

[仕様014](specs/014-add-workspace-member.md)。追記マイグレーション適用後、管理者のメンバー画面に「メンバーを追加」が表示される。登録済み架空ユーザーのUUIDとロールを確認して追加する。UUIDは管理用のローカルAuth管理画面で事前確認し、候補検索やメール送信は行わない。再送は24時間同じ受付結果となり、後から解除した所属を戻す場合は新しい入力として送信する。

`node --test tests/database/member-add.test.mjs` と `pnpm test:auth tests/auth/member-add.spec.ts` でDB/API/UIを検証する。
