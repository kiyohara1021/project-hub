# ProjectHub

プロジェクト・タスク・課題をまとめて管理するWebアプリです。カンバン、ロール別の権限管理、操作履歴を備えています。

## 現在の状態

2026-11-02 本番接続版。接続モードのダッシュボード・プロジェクト一覧・カンバン・課題一覧・メンバー一覧・操作履歴はDBデータを表示します。管理者はプロジェクト管理、管理者/メンバーはタスク・課題管理ができます。管理者はメンバーのロール変更・所属解除も行えます。操作履歴は読み取り専用で、条件絞り込みとページ送りに対応しています。[公開アプリ](https://project-hub-zeta-nine.vercel.app)はVercelへデプロイ済みです。Productionは専用Supabaseに接続済みで、登録済みアカウントでログインできます。パスワードは所有者が管理し、公開しません。

想定構成: Next.js App Router / React / TypeScript、Tailwind CSS / shadcn/ui、Supabase Auth / PostgreSQL、Vercel。採用バージョンはpackage.jsonとlockfileを参照してください。

## 設計資料

- [基本設計・画面遷移](docs/specification.md)
- [ER図・データ辞書](docs/architecture/data-model.md)
- [API・RLS設計](docs/architecture/api-rls.md)
- [6画面の仕様・SVG](docs/design/screens.md)
- [ロードマップ](docs/roadmap.md)
- [Vercel公開・運用手順](docs/deployment.md)
- [ブラウザ性能の計測結果](docs/performance.md)
- [開発ルール](CONTRIBUTING.md)

## 起動・確認

Node.js 24 / pnpm 9.15.0を使用します。プレビューは環境変数不要です。認証とDB接続は[ローカル開発手順](docs/local-development.md)を参照してください。

```sh
pnpm install --frozen-lockfile
pnpm dev
```

ブラウザで http://127.0.0.1:3000 を開くとダッシュボードへ移動します。接続モードではプロジェクト一覧がログイン必須になります。

```sh
pnpm lint
pnpm typecheck
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
```

E2Eはビルド済みのアプリをポート3100で起動します。Windows/Linuxではブラウザ依存ライブラリの追加が必要な場合があります。CIは `playwright install --with-deps chromium` を実行します。

## 開発の進め方

仕様 → Issue → 実装・テスト → PR。P1/P2/P3は完了。現在の仕様は[公開準備](docs/specs/009-release-readiness.md)、タスクは[Issue #17](https://github.com/kiyohara1021/project-hub/issues/17)。P4の6画面DB接続が完了し、P5-1で設定検査・操作検証・公開手順を整備。P5-2でログイン付き本番を公開済み。[Issue #19](https://github.com/kiyohara1021/project-hub/issues/19)で認証・API拒否・Cookie属性・モバイル操作・API応答・利用量を確認しました。測定範囲は公開手順に記載しています。previewモードでは固定値を表示し、connectedモードでは所属workspaceの全件をDB内で集計します。

P4-2: [メンバー管理仕様](docs/specs/007-connected-members.md)に沿って一覧・ロール変更・所属解除をDB接続。招待・メール送信は対象外です。

P4-3: [操作履歴仕様](docs/specs/008-connected-activity.md)。読み取り専用の監査ログを日本時間で表示し、削除・所属解除後も操作当時の記録を保持します。

Vercel Previewは`APP_MODE=preview`でDB接続なし、本番接続は専用Supabaseを別途設定します。`pnpm test:release`で環境検査のテストを実行できます。実際のデプロイ状態は[公開記録](docs/deployment.md#公開記録p5-2で記入)を参照してください。

P5後の仕様差分: [期間検索仕様](docs/specs/012-activity-date-filter.md)（[Issue #30](https://github.com/kiyohara1021/project-hub/issues/30)）で操作履歴の開始日・終了日による絞り込みを追加。残る差分は[ロードマップの棚卸し](docs/roadmap.md#仕様差分の棚卸し2026-11-03)を参照してください。

メンバー一覧は[担当件数仕様](docs/specs/013-member-assignment-counts.md)（[Issue #32](https://github.com/kiyohara1021/project-hub/issues/32)）に沿って、計画中・進行中の未完了タスク数と未解決課題数を表示します。

登録済みユーザーの所属追加は[仕様014](docs/specs/014-add-workspace-member.md)（Issue #33）。管理者が事前確認したユーザーIDとロールを指定し、確認後に所属を追加できます。候補検索・ユーザー作成・メール送信は行いません。

一覧APIのローカル負荷検証は`pnpm build`後に`pnpm test:load`を実行。100プロジェクト・1,000タスクでprojects/tasks一覧を測定し、専用fixtureを削除します。[条件・測定結果](docs/performance.md#100プロジェクト1000タスクのローカル一覧api検証)を参照してください。
