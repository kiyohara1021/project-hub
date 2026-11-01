# Vercel Hobby 公開・運用手順

2026-11-01確認。対象は個人非商用・架空データのみのProjectHub。正規URLは https://project-hub-zeta-nine.vercel.app 。2026-11-02にProductionをAPP_MODE=connectedへ切り替え、専用Hosted Supabaseへ接続済み。PreviewはDB未接続の画面デモを維持する。公開先の権限・性能確認は以下の公開記録を参照。

## 構成と環境変数

| 環境 | モード | DB |
|---|---|---|
| ローカル開発 | connected | ローカルSupabase専用 |
| Vercel Preview | preview | 接続しない。固定画面の動作確認 |
| Vercel Production（画面デモ公開） | preview | 接続しない |
| Vercel Production（ログイン付き） | connected | 専用Hosted Supabase。開発DBと共有しない |

Vercelの個人HobbyアカウントでGitHubのPrivateリポジトリをImportし、Root Directoryはリポジトリのルート、Production Branchはmain、Node.jsは24.xを使用する。Framework・Install/Build Commandはvercel.jsonを使用。自動デプロイで未検証のコミットを本番に出さないよう、公開開始前にProductionの自動反映設定と運用を確認する。

| 変数 | Preview | Production connected |
|---|---|---|
| APP_MODE | preview | connected |
| APP_ORIGIN | 不要 | 実際にアクセスする正規HTTPSオリジン。末尾/なし |
| SUPABASE_URL | 未設定 | `https://<project-ref>.supabase.co` |
| SUPABASE_PUBLISHABLE_KEY | 未設定 | 対象DBのpublishableキー、またはlegacy anonキー |

管理鍵・DBパスワード・SupabaseアクセストークンはVercelアプリに登録しない。`SUPABASE_SERVICE_ROLE_KEY`/`SUPABASE_SECRET_KEY`とそれらのNEXT_PUBLIC版を検査で拒否する。アプリのSupabase変数にNEXT_PUBLIC接頭辞は不要。.env.localやローカルユーザーの共通パスワードをアップロードしない。Vercel PreviewにProductionの接続設定を一括コピーしない。

初回に画面デモだけ公開する場合は、ProductionもAPP_MODE=preview、DB変数なしで開始できる。ログインやデータ保存は使えないと画面へ表示する。接続モード公開時に環境変数を設定し直して再デプロイする。

`pnpm check:deploy`は実行プロセスの環境変数を検査する（.envを自動読込しない）。`pnpm build:vercel`は検査に成功した場合だけビルドする。通常のローカル開発/CIは`pnpm build`を使う。検査は形式確認に限定し、DB接続やアクセス権限の保証はしない。

## Hosted Supabaseの準備

1. ProjectHub専用プロジェクトを作成し、所有者・リージョン・無料枠を確認する。有料機能/追加課金を自動的に有効化しない。
2. アプリ用にURLとpublishableキーを取得する。デプロイ・管理用の資格情報は別管理し、リポジトリに保存しない。
3. CLIで対象project-refを照合してからlinkし、migration listとdry-runで適用予定を確認する。ローカルと同じマイグレーション6件を順番に適用する。

```sh
pnpm exec supabase login
pnpm exec supabase link --project-ref <対象project-ref>
pnpm exec supabase migration list --linked
pnpm exec supabase db push --linked --dry-run
pnpm exec supabase db push --linked
pnpm exec supabase migration list --linked
```

`db reset --linked`と`--include-seed`は使わない。supabase/seed.sql、scripts/seed-local.mjs、tests/databaseはローカル専用。既存のschemaを持つ別アプリのDBへ適用しない。CLIの認証情報・パスワードは安全な対話入力/秘密設定を使用し、コマンド引数や履歴へ書かない。

4. DashboardのAuthで一般サインアップを無効化。メール/パスワード認証を有効にし、メール送信・招待・OAuth・パスワード再発行は今回提供しない。ローカルconfig.tomlがHosted側へ自動反映されるとはみなさず個別確認する。Site URLは正規APP_ORIGINと一致させ、ワイルドカードのリダイレクト許可を増やさない。
5. 管理画面から`admin@example.invalid`等の架空アドレスで、メール送信せず事前確認済みユーザーを作成。クラウド専用の強いパスワードを設定し、ローカル共通パスワードを再利用しない。ログイン情報は公開README・画面・Issueに書かない。
6. profilesはAuthトリガーで作成される。表示名を架空名にし、初期workspaceと最初のadmin所属を設定する。次はSQL Editor用のひな形。`AUTH_USER_UUID`を手順5のUIDに置換し、対象プロジェクトを照合して実行する。既存ユーザーへの二重所属作成に使わない。

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

以降のプロジェクト・タスク・課題はログインしたアプリで架空内容を作成する。member/viewer検証用ユーザーも架空アドレスで事前作成し、Dashboardで対象workspaceの所属だけを設定する。一般招待UIは未実装。管理用SQLの履歴actorが初期データ扱いとなる点を確認する。

## デプロイ前後の確認

- PRのCIが成功し、mainにマージされたコミットSHAを記録。Productionの公開対象がそのSHAか照合する。
- VercelのDeployment Protectionと公開範囲を確認。ログ・ソースのアクセス制御はVercel管理画面で確認する。vercel.jsonへpublicキーは追加しない（実デプロイのスキーマで拒否される）。noindexは検索除外用でありログイン/公開範囲を制限しない。
- 初回DB反映→環境変数→デプロイの順。APP_ORIGINは実際の正規URLと一致させる。別エイリアスURLからの変更操作はOrigin検査で拒否されるため、利用URLを一本化する。
- 未ログインで6画面がログインへ移動し、6種のGET APIが401を返す。画面デモの場合は認証フォームを出さず、DB APIは503となる。
- admin/member/viewerで閲覧と変更許可を確認し、他workspaceのUUIDで404、viewerによる変更403を確認。通常ユーザーのJWTでactivity_logs直接書込が拒否されることも確認する。管理鍵のリクエストをブラウザに渡さない。
- 架空プロジェクトとタスク/課題を作成・更新・削除し、ダッシュボードと履歴に反映されることを確認。最後のadmin保護、ログアウト後API401、CookieにSecureが付くことと、同じ正規オリジンで継続利用できることを確認。
- スマートフォン幅360pxとPC、Tab/Shift+Tab/Escape、スクロール、正規URLでのOrigin検査を確認。公開先で読み込み性能を計測し、ローカルの速度を本番の保証として扱わない。
- Functionsログに例外・資格情報が出ていないか、DBログに権限エラーがないかを確認する。実データを使った検証は行わない。

## 障害時・切り戻し

- フロントエンドの不具合: Vercelで直前の検証済みDeploymentへ切り戻し、そのデプロイの環境変数とAPP_ORIGINを確認。DBは自動では戻らない。
- DB変更は追記マイグレーションを基本とし、既存6件を書換えない。互換性がない変更の前はバックアップと復元手順を確認。無料枠で利用できる保護の範囲を確認し、有料バックアップがあると仮定しない。
- 公開停止が必要ならVercelのアクセス保護/公開停止を使う。APP_MODE=previewは固定画面が表示されるためアクセス停止の代替ではない。
- 鍵漏洩時はSupabaseで失効/再発行し、Vercel変数を更新して再デプロイ。ログやIssueへ漏洩値を貼らない。
- 初回と変更後はVercel/SupabaseのUsageを確認。非商用の前提が変わったらプラン適合を再確認する。

## 公開記録（P5-2で記入）

| 項目 | 状態 |
|---|---|
| Vercelアカウント/Project | ProjectHub Personal（Hobby）/ project-hub 作成済み |
| Supabaseプロジェクト/6件反映 | project-hub / Tokyo（ap-northeast-1）、6件反映済み。7テーブルのRLS・匿名読取不可・直接書込不可を確認 |
| 正規URL/初回公開確認SHA | https://project-hub-zeta-nine.vercel.app / cba33556e76fc4428815ecf1cc5c52c168b7bea8 |
| 本番Auth・RLS・Origin・Cookie検証 | 一般登録・匿名ログイン無効、Site URL設定済み。匿名の6 APIは401、変更APIの異なるOriginは403。管理者・メンバーの保存/更新と3ロールのログイン・画面権限を確認。実認証での禁止API・他workspace拒否・Cookie属性の追加確認を継続 |
| 公開先モバイル/キーボード・性能/Usage | 画面デモ6画面のPC/360px表示・横溢れなし・モバイルメニューEnter/Escapeとフォーカス復帰を確認。性能/Usageの詳細確認は未実施 |

公式資料（確認日: 2026-11-01）: [Hobbyの個人非商用条件](https://vercel.com/docs/plans/hobby)、[Node.js対応バージョン](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions)、[Vercelプロジェクト設定](https://vercel.com/docs/project-configuration)、[環境変数のスコープ](https://vercel.com/docs/environment-variables)、[Supabase環境管理](https://supabase.com/docs/guides/deployment/managing-environments)。公開直前にも条件を確認する。

### 初回画面デモ公開の検証

2026-11-01、Production Deployment `A9jo26fjHaLFgRBsQXv1fv7t1gUn`がReady。mainのアプリコードを公開し、DB接続変数は設定していない。画面デモの公開はログイン付き本番の完了条件とは別に扱う。

- 匿名HTTPで6画面と/loginが200。nosniff、frame DENY、noindex/nofollowを確認。
- /loginに認証フォームなし。プロジェクトGET APIは503かつno-store。
- 公開ブラウザで6画面遷移と360pxの横溢れなしを確認。メニューのキーボード操作も確認。
- 初回は非対応のvercel.json publicキーで失敗し、PR #21で削除後に成功。公式JSONスキーマでキーと型も照合。
- ソース/ログの匿名取得可否は、ダッシュボードURLへのHTTP 200だけで判断しない。Vercel管理画面の保護設定確認は継続する。

残作業はIssue #19。専用DB作成、マイグレーション・Auth・初期所属設定、Productionだけconnectedへ変更、実ユーザーJWTでのRLS/Origin/Cookie検証と公開先性能/Usage記録を行う。ローカル用の共通パスワードやseedは転用しない。

### ログイン付きProduction接続（2026-11-02）

- Production Deployment `FiF56xztdxNYnbGaFTdAQBxPY9JU`がReady。アプリSHAは`bb8b796876bb085592359f8ec8049a64151c7e6c`。正規URLへ割当済み。
- ProductionだけAPP_MODE=connected、APP_ORIGINとHosted Supabase URL/公開用publishableキーを設定。管理鍵・DBパスワードはVercelへ渡していない。PreviewはAPP_MODE=previewだけ。
- 空の専用DBを照合してから、SQL Editorで既存6マイグレーションを単一トランザクションとして適用。成功後にsupabase_migrations.schema_migrationsへ6バージョンを記録。既存マイグレーション本文は改変していない。ローカルseed/共通パスワードは未使用。
- DBパスワードと3人のAuthユーザーのパスワードは所有者本人が画面で設定。架空アドレスのadmin/member/viewerをAuto confirmで作成し、初期workspaceの各ロールへ所属設定した。外部メール招待は行っていない。
- 管理者の実ログインで架空プロジェクト作成・進行中への更新、担当/優先度付きタスク作成と状態移動、課題作成と解決、監査ログ反映、ログアウトを確認。
- 匿名HTTPの6画面は/loginへ誘導する。App RouterはリダイレクトをHTTP200のHTML内meta refreshで返す場合があるため、ステータスだけを判定基準にしない。6 APIの未認証401/no-storeと異なるOriginの403も確認済み。
- VercelのStandard Protection（Require Log In）とProtected Sourcemapsは有効な既存設定を確認。保護を無効化したり、迂回トークンを作成していない。
- Supabase Data APIへ公開キーで匿名アクセスし、7テーブルとread_dashboard RPCが401/42501で拒否されることも確認。
- Vercel UsageのFast Data Transferは確認時点で6.51MB/100GB。課金機能の追加・プラン変更は行っていない。

メンバー・閲覧者の本番ログインと画面権限は下記の通り確認。実認証での禁止API・他workspace拒否・Cookie属性と性能の記録は継続する。過去の画面デモ公開の検証結果は、その時点の記録として上に残す。

### メンバー・閲覧者のProduction確認（2026-11-02）

所有者がそれぞれのパスワードを公開サイトで入力し、ログイン状況とメンバー一覧で本人とロールを照合した。パスワード・Cookie/JWTの値は取得していない。

| 確認対象 | メンバー（デモメンバー02） | 閲覧者（デモメンバー03） |
|---|---|---|
| プロジェクト一覧 | 閲覧専用、作成/編集操作なし | 閲覧専用、作成/編集操作なし |
| カンバン | 架空タスクを進行中からレビューへ移動し、保存成功 | 同じタスクをレビュー列で閲覧。追加/編集/状態変更操作なし |
| 課題一覧 | 架空課題の担当を未割当から自分へ更新し、一覧に反映 | 更新後の担当と解決済み状態を閲覧。追加/編集操作なし |
| メンバー一覧 | 自分のメンバーロールを確認、読み取り専用 | 自分の閲覧者ロールを確認、読み取り専用 |
| 操作履歴 | タスク/課題の更新が本人名義で記録 | メンバーによる更新を閲覧 |
| ダッシュボード | 進行中1件、全1タスク、自分のタスクがレビューで表示 | 同じ集計を表示、自分の未完了タスクはなし |

メンバー・閲覧者は確認後にログアウト済み。これらはUIの権限制御と許可された保存・読み取りの確認であり、禁止された変更APIへ実認証リクエストを送った検証ではない。Issue #19は、他workspace拒否・Cookie属性・公開先性能などの残作業を含むため完了扱いにしない。
