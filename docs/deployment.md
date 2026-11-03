# 公開・運用手順

ProjectHubをVercelとSupabaseで公開・運用するための手順です。開発環境の起動とテストは[ローカル開発手順](local-development.md)、機能の実装状況は[ロードマップ](roadmap.md)を参照してください。

## 現在の構成

2026年11月3日確認。公開アプリは登録済みアカウントで利用できます。

| 項目 | 設定・状態 |
|---|---|
| 公開URL | [project-hub-zeta-nine.vercel.app](https://project-hub-zeta-nine.vercel.app) |
| アプリ | Vercel / project-hub / Productionブランチはmain |
| 実行リージョン | Tokyo（hnd1） |
| データベース | 専用Supabase / project-hub / Tokyo（ap-northeast-1） |
| 本番モード | `APP_MODE=connected` |
| Preview | `APP_MODE=preview`。DBに接続せず固定データを表示 |
| マイグレーション | 001〜011を適用済み（2026-11-04） |
| 利用範囲 | 個人の学習・デモ用途。実在の顧客情報や業務データは登録しない |

Vercel Hobbyの利用条件と上限は公開・変更時に再確認します。無料枠の容量やバックアップを保証として扱わず、上限に近づいた場合は停止・縮小も含めて構成を見直します。

## 環境変数

開発と本番は別のDBを使用します。Previewには本番DBの接続情報を設定しません。

| 変数 | Preview | Production |
|---|---|---|
| `APP_MODE` | `preview` | `connected` |
| `APP_ORIGIN` | 不要 | 公開URLのHTTPSオリジン。末尾の`/`なし |
| `SUPABASE_URL` | 未設定 | `https://<project-ref>.supabase.co` |
| `SUPABASE_PUBLISHABLE_KEY` | 未設定 | 対象DBのpublishableキー、またはlegacy anonキー |

管理鍵・DBパスワード・SupabaseアクセストークンはVercelアプリに登録しません。`SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_SECRET_KEY`とそれらの`NEXT_PUBLIC`版は設定検査で拒否します。アプリ用のSupabase変数に`NEXT_PUBLIC`接頭辞は不要です。

`.env.local`やローカル検証用パスワードはアップロードせず、Previewへの環境変数の一括コピーも避けます。

| コマンド | 用途 |
|---|---|
| `pnpm check:deploy` | 実行プロセスの環境変数を検査 |
| `pnpm build:vercel` | 設定検査に成功した場合だけビルド |
| `pnpm build` | 通常のローカル・CIビルド |

設定検査は`.env`を自動で読み込みません。また、値の形式検査であり、DBへの接続やアクセス権限の確認は別途必要です。

## 初回セットアップ

### Supabase

1. ProjectHub専用プロジェクトを作成し、対象プロジェクト・所有者・リージョンを照合します。
2. アプリ用URLとpublishableキーを取得します。管理用の資格情報は別管理し、リポジトリに保存しません。
3. 以下の手順でマイグレーションを確認し、未適用分だけを順番に反映します。
4. Authで一般サインアップを無効化し、メール・パスワード認証を設定します。Site URLは`APP_ORIGIN`と一致させます。ローカルの`config.toml`が本番へ自動反映されるとはみなさず、管理画面で確認します。
5. `admin@example.invalid`などのテスト用アカウントを、メール送信なしで事前登録します。本番専用のパスワードを使用し、ローカルの共通パスワードは再利用しません。
6. Authトリガーで作られたprofileの表示名を設定し、最初のワークスペースと管理者を作成します。

初期所属を設定するSQLの例です。`AUTH_USER_UUID`を手順5のUIDへ置換し、対象プロジェクトと未登録であることを確認してから実行します。

```sql
begin;
update public.profiles set display_name='デモメンバー01'
where id='AUTH_USER_UUID'::uuid;
with space as (
  insert into public.workspaces(name) values('デモスペースA') returning id
)
insert into public.memberships(workspace_id,user_id,role)
select id,'AUTH_USER_UUID'::uuid,'admin' from space;
commit;
```

以後の所属追加はアプリの管理者画面で行えます。対象ユーザーのUUIDは事前に確認してください。ユーザー作成・候補検索・メール招待はアプリの対象外です。管理用SQLで設定した初期データの履歴は、ログインユーザーによる操作とは区別して表示されます。

### Vercel

リポジトリをImportし、Root Directoryをリポジトリのルート、Production Branchを`main`、Node.jsを24.xに設定します。Framework・Install/Build Commandは`vercel.json`を使用します。

Productionの環境変数を設定し、公開対象コミットとDBの適用状況を確認してデプロイします。Deployment Protectionとソース・ログの公開範囲も管理画面で確認します。`noindex`は検索除外用であり、アクセス制限の代わりにはなりません。

## 更新時の手順

1. PRのCIとレビューを完了し、対象コミットSHAを記録します。
2. DB変更がある場合は、対象プロジェクトと適用済みバージョンを照合し、未適用マイグレーションの内容と順序を確認します。
3. 対応するDB変更を先に適用し、RPC・RLS・実行権限を確認します。
4. PRをmainへマージし、VercelでReady・Production Current・正規URL割当・SourceのSHAを照合します。
5. 次節の公開後確認を実施し、日付・対象SHA・検証範囲・未検証事項を記録します。

CLIを使う場合の手順です。認証情報・パスワードは対話入力や秘密設定を使い、コマンド引数や履歴へ書きません。

```sh
pnpm exec supabase login
pnpm exec supabase link --project-ref <対象project-ref>
pnpm exec supabase migration list --linked
pnpm exec supabase db push --linked --dry-run
pnpm exec supabase db push --linked
pnpm exec supabase migration list --linked
```

SQL Editorで適用する場合も、リポジトリの原文と順序を守り、成功後のマイグレーション履歴を照合します。既存マイグレーションは書き換えず、変更は追記します。

`db reset --linked`と`--include-seed`は使用しません。`supabase/seed.sql`、`scripts/seed-local.mjs`、`tests/database`、`pnpm test:load`はローカル専用です。

## 公開後の確認

| 確認すること | 確認方法 |
|---|---|
| 未認証時の制御 | 6画面がログインへ誘導され、6種の読取APIが401 / no-storeとなる |
| 権限・所属境界 | admin/member/viewerの許可・拒否、別ワークスペースの404、直接書き込み拒否を確認 |
| 変更操作 | サンプルの作成・更新とダッシュボード・操作履歴への反映、最後の管理者保護を確認 |
| Origin・Cookie | 正規URLから操作でき、異なるOriginは拒否される。HTTPSのSecure属性とログアウト後401を確認 |
| 画面操作 | PCと360px幅、Tab/Shift+Tab/Escape、フォーカス復帰、横スクロールを確認 |
| エラー・利用量 | Functions/DBログ、Vercel/SupabaseのUsageを確認。資格情報を記録しない |
| 性能 | 測定条件と対象データ量を記録。ローカル実測と本番実測を区別する |

App Routerはログインへの誘導をHTTP 200のHTML内で返すことがあるため、画面の未認証制御はステータスだけで判定しません。画面デモモードでは、DB APIは503となります。

本番APIの拒否・Cookie確認には`python3 scripts/verify-production.py`を利用できます。引数は`--origin --workspace --other-workspace --project --output`です。パスワードは対話入力し保存しません。変更APIには必須項目を欠くJSONを送り、検証でデータを作成・更新しない構成です。

## 障害時の対応

- アプリの不具合は、Vercelで直前の検証済みDeploymentへ切り戻します。その時点の対象Deploymentと環境変数・`APP_ORIGIN`を確認してください。DBは自動で戻りません。
- DBの互換性を失う変更の前には、利用できるバックアップと復元手順を確認します。有料バックアップがあることを前提にしません。
- 公開停止にはVercelのアクセス保護・公開停止を使用します。`APP_MODE=preview`への変更は画面デモを表示するため、停止の代わりにはなりません。
- 鍵漏洩時はSupabaseで失効・再発行し、Vercelの設定を更新して再デプロイします。漏洩値をログやIssueへ貼り付けません。

## 本番反映・検証記録

<a id="公開記録p5-2で記入"></a>
<a id="p5後の仕様差分の本番反映2026-11-03"></a>

2026年11月3日、期間検索・メンバー担当件数・登録済みユーザーの所属追加を反映しました。詳細な作業ログと過去の公開履歴は[2026年11月の記録](history/deployment-2026-11.md)に保存しています。

| 項目 | 確認結果 |
|---|---|
| 対応PR | #31 → #35 → #36 → #37の順にマージ |
| アプリ基準SHA | `1d62e7100589dfdebe6fc9d88f437d127e439397` |
| Vercel Deployment | `7w5B6Jx8HfUijpYzWyVDY5YgdCb8` |
| 公開状態 | Ready / Production Current / 正規URL割当とSourceを照合 |
| DB | 007→008を先行適用し、履歴8件・RPC所有者・実行権限・固定search_path・再送記録のRLSを照合 |
| ローカル・CI | 各PRのverify/database-auth成功。統合時のDBテスト10件・認証E2E28件成功 |

今回の本番確認は、管理者の担当件数表示・メンバーAPI・所属追加の確認画面と重複拒否・Escape後のフォーカス復帰・期間検索とページ送りを対象としています。匿名の6種APIは401 / private,no-store、異なるOriginからの所属追加は403でした。

新規所属作成の成功操作、member/viewerの再ログイン、本番での360px幅確認と100プロジェクト・1,000タスクの負荷試験は、この追加確認では実施していません。既存の本番検証、ローカル・CIの検証結果と区別してください。性能の条件と結果は[性能計測記録](performance.md)を参照してください。

## 参考資料

以下は導入時に参照した公式資料です。利用条件・プラン上限・管理画面の仕様は変更されるため、公開・構成変更時には最新の内容を確認してください。

- [Vercel Hobby](https://vercel.com/docs/plans/hobby)
- [VercelのNode.js対応](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions)
- [Vercelプロジェクト設定](https://vercel.com/docs/project-configuration)
- [Vercel環境変数のスコープ](https://vercel.com/docs/environment-variables)
- [Supabaseの環境管理](https://supabase.com/docs/guides/deployment/managing-environments)
- [Vercel Functionsのリージョン](https://vercel.com/docs/functions/configuring-functions/region)
- [Vercel Instant Rollback](https://vercel.com/docs/instant-rollback)

## 課題コメントの更新手順

[課題コメント仕様](specs/016-issue-comments.md)の反映には`202611030009_issue_comments.sql`が必要です。適用済み008までの履歴を照合し、009をアプリより先に適用してください。追加RPCの所有者・固定search_path・EXECUTE、issue_commentsのRLS・SELECTだけの直接権限とprivate.comment_requestsへの直接アクセス拒否を確認します。課題削除時にコメントをCASCADE削除しますが、監査と再送記録は保持します。

ローカルでは投稿/編集/確認削除・32KiB入力制限・再送・競合・所属/投稿者/アーカイブ境界をDB/認証E2Eで検証します。本番では適用とデプロイのSHA・確認した操作を別に記録してください。


### コメント・表示名・タスク移動の追加反映（2026-11-04）

PR #42をマージし、コミット`c1ef8458dcd68fcf7b7258bed9d1f96823736b1f`のVercelデプロイ成功を確認しました。本番の正規URLで表示名フォームとコメント欄を表示しています。

- 本番DBの適用済み8件を先に確認し、リポジトリの009→010→011と履歴登録を単一トランザクションで適用。履歴11件・最新`202611030011`を読戻し確認。
- 追加コメントRPC・`move_task`・`update_my_profile`の計5関数はproject_hub_owner所有、SECURITY DEFINER、空のsearch_path。anonのEXECUTEは拒否し、authenticatedは許可。issue_commentsはRLS有効、authenticatedは直接SELECTのみ。private.comment_requestsの直接SELECT/INSERT/UPDATE/DELETEは拒否。
- 管理者の本番画面で、現在の表示名を維持した保存成功と、既存の解決済み課題へのコメント投稿・表示・編集成功を確認しました。確認コメントは記録として残しています。
- ローカルDB13件・認証E2E34件・公開設定4件、画面デモE2E7件成功（1件対象外skip）。CIのverify/database-authとVercel Previewも成功。
- 本番でのコメント削除、別ロールでの再ログイン、競合・再送・大量件数の検証は今回未実施です。これらはローカルDB/E2Eの検証と区別します。

Codex Security CLIは`b56728d`の170ファイルをレビュー後、候補検証中に利用上限で停止しました（scan ID: `67486714-f278-477b-a8e7-f16c2e380cab`）。未完了のため「脆弱性なし」とは扱いません。追加の#43〜#46は当該スキャンの対象外です。
