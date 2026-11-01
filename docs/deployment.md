# Vercel Hobby 公開・運用手順

2026-11-01確認。対象は個人非商用・架空データのみのProjectHub。現時点ではローカル検証のみで、Vercel/Supabaseのクラウドプロジェクトと公開URLは未作成。P5-1の完了は公開完了を意味しない。

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
- VercelのDeployment Protectionと公開範囲を確認。ログ・ソースはpublic:falseを維持。noindexは検索除外用でありログイン/公開範囲を制限しない。
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
| Vercelアカウント/Project | 未接続・未作成 |
| Supabaseプロジェクト/6件反映 | 未接続・未実施 |
| 正規URL/公開コミットSHA | 未設定 |
| 本番Auth・RLS・Origin・Cookie検証 | 未実施 |
| 公開先モバイル/キーボード・性能/Usage | 未実施 |

公式資料（確認日: 2026-11-01）: [Hobbyの個人非商用条件](https://vercel.com/docs/plans/hobby)、[Node.js対応バージョン](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions)、[Vercelプロジェクト設定](https://vercel.com/docs/project-configuration)、[環境変数のスコープ](https://vercel.com/docs/environment-variables)、[Supabase環境管理](https://supabase.com/docs/guides/deployment/managing-environments)。公開直前にも条件を確認する。
