# ローカル開発手順

Node.js 24 / pnpm 9.15.0を使用します。DB・認証を使う場合はDockerも起動してください。本手順はローカル環境専用です。

## DB接続なしで起動する

```sh
pnpm install --frozen-lockfile
APP_MODE=preview pnpm dev
```

[ダッシュボード](http://127.0.0.1:3000/dashboard)で固定のサンプル画面を確認できます。ログインや保存操作は利用できません。

## DB・認証を使って起動する

```sh
pnpm install --frozen-lockfile
pnpm db:start
pnpm db:seed
pnpm db:env
pnpm dev
```

[ログイン画面](http://127.0.0.1:3000/login)を開き、次のテストアカウントでログインしてください。

| メールアドレス | 表示名 | 所属・ロール |
|---|---|---|
| admin@example.invalid | デモメンバー01 | デモスペースA・管理者 |
| member@example.invalid | デモメンバー02 | デモスペースA・メンバー |
| viewer@example.invalid | デモメンバー03 | デモスペースA・閲覧者 |
| outside@example.invalid | デモメンバー04 | デモスペースB・管理者 |
| unassigned@example.invalid | デモメンバー05 | 所属なし |

共通パスワードは`Local-Demo-Only-2026!`です。ローカルのテスト専用で、本番では使用しません。

`db:seed`はSupabase CLIのローカル接続情報を使い、`127.0.0.1:54321`以外を拒否します。登録済みユーザーを再利用し、サンプルデータをupsertします。`db:env`は公開用接続鍵を`.env.local`へ書き込み、別設定の既存ファイルは上書きしません。管理鍵は含めません。

### 環境変数

| 変数 | ローカルDB接続時の設定 |
|---|---|
| APP_MODE | `connected` |
| APP_ORIGIN | `http://127.0.0.1:3000` |
| SUPABASE_URL | ローカルSupabaseのURL（通常は`http://127.0.0.1:54321`） |
| SUPABASE_PUBLISHABLE_KEY | CLIから取得したローカル公開用接続鍵 |

`APP_ORIGIN`はブラウザで開くURLのoriginと完全一致させます。ホストやポートを変更した場合は、この設定も変更してください。書込APIとログイン・ログアウトは指定したOriginだけを許可します。

## テスト

DB・認証テストの前にDockerとローカルSupabaseを起動し、seedと`.env.local`を準備します。

```sh
pnpm db:start
pnpm db:seed
pnpm db:env
pnpm lint
pnpm typecheck
pnpm build
pnpm exec playwright install chromium
pnpm test:release
pnpm test:db
pnpm test:e2e
pnpm test:auth
```

| コマンド | 確認内容 | 使用ポート |
|---|---|---|
| `pnpm lint` / `pnpm typecheck` | 静的解析・型の整合 | — |
| `pnpm build` | 本番用ビルド | — |
| `pnpm test:release` | 環境変数の検査・Cookie設定 | — |
| `pnpm test:db` | RLS、更新RPC、競合、再送、集計、監査ログ | Supabase 54321 |
| `pnpm test:e2e` | DB未接続の画面デモ | 3100 |
| `pnpm test:auth` | DB接続・認証を含む画面/API操作 | 3101 |
| `pnpm test:load` | 一覧APIのローカル性能 | 3104 |

Playwrightはビルド済みのアプリを起動します。各ポートの手動起動サーバーは先に停止してください。Windows/Linuxではブラウザの依存ライブラリが必要な場合があります。CIは`playwright install --with-deps chromium`を使用します。

DBテストと認証E2Eは**順番に実行**してください。検証中は共有seedのロール変更や、障害復旧を確認するための一時的な読取権限の変更を行います。同時実行すると相互に干渉します。負荷検証も他のDBテストと同時に実行しません。

### 一部のテストだけを実行する

```sh
node --test tests/database/member-add.test.mjs
pnpm test:auth tests/auth/member-add.spec.ts
```

機能ごとの対象は[機能別仕様](specs/README.md)を参照してください。APIの入出力やRPC一覧は[API・認可設計](architecture/api-rls.md)へ集約しています。

### 一覧APIの性能を測定する

```sh
pnpm build
pnpm test:load
```

ローカルのadminアカウントを使い、専用ワークスペースへ100プロジェクト・1,000タスクを作成します。通常ログインのCookieでプロジェクト一覧とタスク一覧を測定し、終了時に検証データを削除します。各条件5回のウォームアップ後に50回を直列で測定し、min/p50/p95/maxをJSON出力します。p95が1秒を超える条件があれば終了コード1です。

強制終了などでデータが残った場合は、ローカルDBで検証用ワークスペースを確認してください。現在の識別名は`一覧性能検証のテスト用ワークスペース`です。測定条件と限界は[仕様015](specs/015-list-api-load-check.md)、結果は[性能測定記録](performance.md)を参照してください。

## DBの再構築と終了

```sh
# ローカルDBを初期化し、サンプルデータを入れ直す
pnpm db:reset
pnpm db:seed
pnpm db:env

# ローカルSupabaseを停止する
pnpm db:stop
```

テストを強制終了し、ロールや権限が戻らなかった場合も再構築します。`db:reset`はローカルDBのデータを消すため、保持したい変更がある場合は先に退避してください。

一般登録は無効で、外部へのメール・SMS送信は行いません。`supabase/config.toml`はローカル専用です。本番設定は[デプロイ・運用手順](deployment.md)に従い、ローカルseed・共通パスワード・管理鍵を転用しないでください。
