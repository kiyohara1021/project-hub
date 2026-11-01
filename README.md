# ProjectHub

個人非商用のReact学習用プロジェクト管理アプリ。実在の案件・顧客・会社・人物・機密情報は使わず、架空データだけを使用します。技術製品名は採用技術として記載します。

## 現在の状態

2026-11-01 設計開始版。アプリ実装、DB構築、認証設定、デプロイは未実施です。

想定構成: Next.js App Router / React / TypeScript、Tailwind CSS / shadcn/ui、Supabase Auth / PostgreSQL、Vercel Hobby（個人非商用）。バージョンは実装開始時に互換性を確認して固定します。

## 設計資料

- [基本設計・画面遷移](docs/specification.md)
- [ER図・データ辞書](docs/architecture/data-model.md)
- [API・RLS設計](docs/architecture/api-rls.md)
- [6画面の仕様・SVG](docs/design/screens.md)
- [ロードマップ](docs/roadmap.md)
- [開発ルール](CONTRIBUTING.md)

まずロードマップのP1から着手してください。現在は起動可能なアプリやDBマイグレーションを含みません。
