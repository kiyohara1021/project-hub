# ProjectHub

個人非商用のReact学習用プロジェクト管理アプリ。実在の案件・顧客・会社・人物・機密情報は使わず、架空データだけを使用します。技術製品名は採用技術として記載します。

## 現在の状態

2026-11-01 P1基盤版。Next.jsで6画面をプレビューできます。表示は固定の架空データで、認証・DB保存・データ更新・デプロイは未実施です。

想定構成: Next.js App Router / React / TypeScript、Tailwind CSS / shadcn/ui、Supabase Auth / PostgreSQL、Vercel Hobby（個人非商用）。バージョンは実装開始時に互換性を確認して固定します。

## 設計資料

- [基本設計・画面遷移](docs/specification.md)
- [ER図・データ辞書](docs/architecture/data-model.md)
- [API・RLS設計](docs/architecture/api-rls.md)
- [6画面の仕様・SVG](docs/design/screens.md)
- [ロードマップ](docs/roadmap.md)
- [開発ルール](CONTRIBUTING.md)

## 起動・確認

Node.js 24 / pnpm 9.15.0を使用します。環境変数は不要です。

```sh
pnpm install --frozen-lockfile
pnpm dev
```

ブラウザで http://localhost:3000 を開くとダッシュボードへ移動します。

```sh
pnpm lint
pnpm typecheck
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
```

E2Eはビルド済みのアプリをポート3100で起動します。Windows/Linuxではブラウザ依存ライブラリの追加が必要な場合があります。CIは `playwright install --with-deps chromium` を実行します。

## 開発の進め方

仕様 → Issue → 実装・テスト → PR。現在の作業仕様は[基盤構築](docs/specs/001-app-foundation.md)、タスクは[Issue #1](https://github.com/kiyohara1021/project-hub/issues/1)。次はP2の認証・DB・RLS設計の実装です。現在の表示は完成画面のプレビューで、集計は固定値です。
