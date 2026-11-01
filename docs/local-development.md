# ローカル認証・DB開発

Dockerを起動し、Node.js 24 / pnpm 9.15.0を使用する。クラウドSupabaseは不要。

```sh
pnpm install --frozen-lockfile
pnpm db:start
pnpm db:seed
pnpm db:env
pnpm dev
```

http://127.0.0.1:3000/workspaces を開くと未認証の場合はログインへ移動する。従来6画面は固定プレビューのまま。

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

APP_ORIGINはブラウザで開くURLのoriginと完全一致させる。初期値は http://127.0.0.1:3000 。ポートやホストを変更する場合はこの設定も変更する。ログイン/ログアウトはこのOriginからのPOSTだけ許可する。Supabase URLは別のローカルAPI（54321）。

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

実装済みRPC: create_workspace / create_project / update_project / set_member_role / remove_member。タスク・課題の変更RPC、所属追加、プロフィール変更、HTTPの変更APIは後続段階。

一覧APIのパラメーターはlimit(1〜100)/cursor(uuid)だけ。未対応のパラメーターは400。P2-1はid昇順で安定ページングする。基本設計のcreated_at複合カーソル、名前/状態検索はP3で実装する。APIはservice_roleを使わず、cookieのJWTを検証してRLS付きで読み取る。

参考（2026-11-01確認）: [Supabase SSR](https://supabase.com/docs/guides/auth/server-side/creating-a-client?framework=nextjs&queryGroups=framework)、[ローカル開発](https://supabase.com/docs/guides/local-development/cli/getting-started)。
