# リポジトリ公開前の確認

確認日: 2026-11-02。公開範囲はPrivateのまま。以下は公開判断の材料であり、公開設定の変更記録ではない。

- Gitの全ブランチ/履歴をGitleaks 8.30.1で走査し、検出0件。
- 取得可能なActionsログ27件すべて、Issue/PR本文・Issueコメント・レビューコメントを走査し、検出0件。Actionsの保存アーティファクトは0件。
- 履歴内の環境変数ファイルは`.env.example`のみ。ローカル環境ファイルは追跡していない。Gitの作者メールはGitHub noreply。
- データ例は作成したサンプルであり、実在の案件・顧客・会社情報は追加していない。
- GitHub説明文とREADMEはアプリの機能を中心に記載。画面にホスティングの利用条件を常設しない。

秘密情報スキャンは検出漏れをゼロと保証するものではない。公開するとコード・履歴に加えてActions履歴/ログも閲覧可能となる。外部で作成されたコピーはPrivateへ戻しても回収できない。公開の可否と、コード再利用を許可するライセンスの選択は別に判断する。

Vercel Hobbyの個人・非商用という利用条件は、リポジトリのPublic/Privateとは別の条件として運用する。

参考: [GitHubの公開範囲変更](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/setting-repository-visibility)、[Vercel Hobby](https://vercel.com/docs/plans/hobby)。
