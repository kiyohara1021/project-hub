# ローカル認証・DB開発

Dockerを起動し、Node.js 24 / pnpm 9.15.0を使用する。クラウドSupabaseは不要。

```sh
pnpm install --frozen-lockfile
pnpm db:start
pnpm db:seed
pnpm db:env
pnpm dev
```

http://127.0.0.1:3000/projects を開くと未認証の場合はログインへ移動する。ログイン後はプロジェクト一覧へ進み、名前を選ぶとカンバンへ移動する。管理者はプロジェクト管理、管理者/メンバーはタスク管理が可能。閲覧者とアーカイブ済みプロジェクトは読み取り専用。その他の業務画面は固定プレビュー。

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

実装済みRPC: create_workspace / create_project / update_project / set_member_role / remove_member / create_project_once / edit_project / create_task_once / edit_task / delete_task / move_task。課題の変更、所属追加、プロフィール変更は後続段階。

一覧APIはq（名前部分一致）/status/limit(1〜100)/cursorを受け付け、created_at DESC,id DESCでページングする。cursorはAPIが返す不透明な文字列をそのまま渡す。未対応/重複パラメーターは400。APIはservice_roleを使わず、cookieのJWTを検証してRLS付きで読み取る。

POST `/api/v1/workspaces/:wid/projects` はIdempotency-Key必須。24時間は同じ本文・キーで再試行しても同じ作成結果を返す。本文を変えた再送は409。PATCH `.../projects/:pid` はversion必須で、古いversionは409。画面は失敗時の入力を保持し、競合時は「入力を破棄して最新版を読み直す」を明示的に選択できる。期限切れの再送記録は同じworkspace/actorが次に作成した時に削除するため、厳密な24時間後の物理削除ではない。

参考（2026-11-01確認）: [Supabase SSR](https://supabase.com/docs/guides/auth/server-side/creating-a-client?framework=nextjs&queryGroups=framework)、[ローカル開発](https://supabase.com/docs/guides/local-development/cli/getting-started)。

## カンバン操作

プロジェクト一覧から名前を選び、列ごとに25件ずつ表示する。「さらに読み込む」で続きへ進む。担当者/優先度を選択して絞り込み、リセットで解除する。スマートフォンは表示状態を選んで1列ずつ操作する。

管理者/メンバーはタスクを追加し、編集から担当・優先度・期限を変更できる。削除には確認が必要。PCではカードを別列の余白へドラッグすると列末尾へ、カード上へ落とすとその前へ移動する。状態メニューと「上へ」ボタンはキーボード/モバイル向けの代替操作。

移動後は列を再取得するため、追加読込済みでも最初の25件に戻る。他ユーザーの並び替えがあった場合も、再読み込みで整合させる。作成の再送時にも権限とアーカイブ状態を検査する。DBテストは共通の架空データを変更するためファイルを直列実行し、所属解除テスト後は初期メンバーを復元する。

supabase/config.tomlはローカル専用で、反復テスト用のログイン枠を設定している。本番の認証設定はこのファイルをそのまま使わず別途検討する。
