# リポジトリ公開前の確認

確認日: 2026-11-02。ユーザーがコード・Git履歴・Actionsログの公開を了承したため、GitHubをPublicへ変更。認証なしのGitHub APIでもprivate=false / visibility=publicを確認した。以下は変更前に実施した確認の記録。

- Gitの全ブランチ/履歴をGitleaks 8.30.1で走査し、検出0件。
- 取得可能なActionsログ27件すべて、Issue/PR本文・Issueコメント・レビューコメントを走査し、検出0件。Actionsの保存アーティファクトは0件。
- 履歴内の環境変数ファイルは`.env.example`のみ。ローカル環境ファイルは追跡していない。Gitの作者メールはGitHub noreply。
- データ例は作成したサンプルであり、実在の案件・顧客・会社情報は追加していない。
- GitHub説明文とREADMEはアプリの機能を中心に記載。画面にホスティングの利用条件を常設しない。

秘密情報スキャンは検出漏れをゼロと保証するものではない。公開するとコード・履歴に加えてActions履歴/ログも閲覧可能となる。外部で作成されたコピーはPrivateへ戻しても回収できない。公開の可否と、コード再利用を許可するライセンスの選択は別に判断する。

Vercel Hobbyの個人・非商用という利用条件は、リポジトリのPublic/Privateとは別の条件として運用する。

参考: [GitHubの公開範囲変更](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/setting-repository-visibility)、[Vercel Hobby](https://vercel.com/docs/plans/hobby)。

## 公開説明の見直し（2026-11-03 / Issue #39）

GitHubのAbout欄、公開URL、READMEと関連ドキュメントを見直しました。

- About欄は「プロジェクト・タスク・課題をまとめて管理するWebアプリ。Next.js / React / TypeScript / Supabase。」と機能・技術を簡潔に示しており、変更不要と判断しました。
- Websiteは公開アプリの正規URLを指しています。公開範囲はPublicを維持し、ライセンスやアクセス権限の変更は行っていません。
- READMEを機能概要・起動方法・資料への入口に整理し、完了済みIssueを現在のタスクとして扱う記述を削除しました。
- 現行仕様と過去の公開履歴を分け、機能別仕様には後続の変更との関係を記載しました。データ例の表現も、文脈に応じてサンプル・デモ・テスト用へ統一しました。

この確認は公開説明と資料構成が対象です。2026-11-02の秘密情報スキャンを再実行したという意味ではありません。
