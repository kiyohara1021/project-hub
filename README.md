# ProjectHub

プロジェクト・タスク・課題をまとめて管理するWebアプリです。ダッシュボード、カンバン、メンバー管理、操作履歴を備えています。

[公開アプリ](https://project-hub-zeta-nine.vercel.app) · [利用ガイド](docs/user-guide.md) · [ドキュメント一覧](docs/README.md)

## 主な機能

| 機能 | できること |
|---|---|
| ダッシュボード | 進捗、期限超過、未解決課題、自分のタスクを確認 |
| プロジェクト | 作成・編集・検索・アーカイブ・復元 |
| カンバン | タスクの追加・編集・削除、状態変更、並べ替え |
| 課題 | 担当・優先度・期限の管理、解決・再開、検索 |
| メンバー | 登録済みユーザーの所属追加、ロール変更、所属解除、担当件数の確認 |
| 操作履歴 | 期間・操作者・対象・操作による絞り込み、日本時間での表示 |

2026-11-03時点で上記を本番反映済みです。公開アプリは登録済みアカウントでログインできます。機能ごとの権限は[基本仕様](docs/specification.md)、公開後の確認範囲は[運用・公開記録](docs/deployment.md)を参照してください。

個人開発の学習用アプリとして、サンプルデータで運用しています。データの扱いは[開発ルール](CONTRIBUTING.md#データと認証情報の扱い)に記載しています。

## ローカルで起動する

Node.js 24 / pnpm 9.15.0を使用します。まずはDB接続なしの画面デモを起動できます。

```sh
pnpm install --frozen-lockfile
APP_MODE=preview pnpm dev
```

[ローカルのダッシュボード](http://127.0.0.1:3000/dashboard)を開いてください。画面デモでは固定のサンプルを表示します。ログインや保存操作を試す場合は、Dockerを使う[ローカル開発手順](docs/local-development.md)へ進んでください。

## 技術構成

Next.js App Router / React / TypeScript、Tailwind CSS / shadcn/ui、Supabase Auth / PostgreSQL、Vercelを使用しています。バージョンは[package.json](package.json)と[pnpm-lock.yaml](pnpm-lock.yaml)を参照してください。

## 開発・検証

```sh
pnpm lint
pnpm typecheck
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
```

DB・認証テストと負荷検証の準備は[ローカル開発手順](docs/local-development.md#テスト)にまとめています。変更は仕様 → Issue → 実装・テスト → PRの順に進めます。詳しくは[CONTRIBUTING.md](CONTRIBUTING.md)を参照してください。
