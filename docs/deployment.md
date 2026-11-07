# 公開・運用手順

ProjectHubをVercelとSupabaseで公開・運用するための手順です。開発環境の起動とテストは[ローカル開発手順](local-development.md)、機能の実装状況は[ロードマップ](roadmap.md)を参照してください。

## 現在の構成

2026年11月3日確認。公開アプリは登録済みアカウントで利用できます。

| 項目             | 設定・状態                                                                   |
| ---------------- | ---------------------------------------------------------------------------- |
| 公開URL          | [project-hub-zeta-nine.vercel.app](https://project-hub-zeta-nine.vercel.app) |
| アプリ           | Vercel / project-hub / Productionブランチはmain                              |
| 実行リージョン   | Tokyo（hnd1）                                                                |
| データベース     | 専用Supabase / project-hub / Tokyo（ap-northeast-1）                         |
| 本番モード       | `APP_MODE=connected`                                                         |
| Preview          | `APP_MODE=preview`。DBに接続せず固定データを表示                             |
| マイグレーション | 001〜012を適用済み（012は2026-11-06）                                        |
| 利用範囲         | 個人の学習・デモ用途。実在の顧客情報や業務データは登録しない                 |

Vercel Hobbyの利用条件と上限は公開・変更時に再確認します。無料枠の容量やバックアップを保証として扱わず、上限に近づいた場合は停止・縮小も含めて構成を見直します。

## 環境変数

開発と本番は別のDBを使用します。Previewには本番DBの接続情報を設定しません。

| 変数                       | Preview   | Production                                     |
| -------------------------- | --------- | ---------------------------------------------- |
| `APP_MODE`                 | `preview` | `connected`                                    |
| `APP_ORIGIN`               | 不要      | 公開URLのHTTPSオリジン。末尾の`/`なし          |
| `SUPABASE_URL`             | 未設定    | `https://<project-ref>.supabase.co`            |
| `SUPABASE_PUBLISHABLE_KEY` | 未設定    | 対象DBのpublishableキー、またはlegacy anonキー |

管理鍵・DBパスワード・SupabaseアクセストークンはVercelアプリに登録しません。`SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_SECRET_KEY`とそれらの`NEXT_PUBLIC`版は設定検査で拒否します。アプリ用のSupabase変数に`NEXT_PUBLIC`接頭辞は不要です。

`.env.local`やローカル検証用パスワードはアップロードせず、Previewへの環境変数の一括コピーも避けます。

| コマンド            | 用途                             |
| ------------------- | -------------------------------- |
| `pnpm check:deploy` | 実行プロセスの環境変数を検査     |
| `pnpm build:vercel` | 設定検査に成功した場合だけビルド |
| `pnpm build`        | 通常のローカル・CIビルド         |

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

以後の所属追加はアプリの管理者画面で行えます。対象ユーザーのUUIDは、本人がログイン状況画面（`/workspaces`）で確認して管理者へ伝えます。既存運用のユーザー作成は管理側で行います。メール招待は追加実装・検証中で、本番では無効です。管理用SQLで設定した初期データの履歴は、ログインユーザーによる操作とは区別して表示されます。

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

| 確認すること   | 確認方法                                                                                               |
| -------------- | ------------------------------------------------------------------------------------------------------ |
| 未認証時の制御 | 6画面がログインへ誘導され、6種の読取APIが401 / no-storeとなる                                          |
| 権限・所属境界 | admin/member/viewerの許可・拒否、別ワークスペースの404、直接書き込み拒否を確認                         |
| 変更操作       | サンプルの作成・更新とダッシュボード・操作履歴への反映、最後の管理者保護を確認                         |
| Origin・Cookie | 正規URLから操作でき、異なるOriginは拒否される。HTTPSのSecure属性とログアウト後401を確認                |
| 画面操作       | PCと360px幅、Tab/Shift+Tab/Escape、フォーカス復帰、横スクロールを確認                                  |
| エラー・利用量 | Functions/DBログ（5xxはrequestId付きのJSONで出力）、Vercel/SupabaseのUsageを確認。資格情報を記録しない |
| 性能           | 測定条件と対象データ量を記録。ローカル実測と本番実測を区別する                                         |

App Routerはログインへの誘導をHTTP 200のHTML内で返すことがあるため、画面の未認証制御はステータスだけで判定しません。画面デモモードでは、DB APIは503となります。

本番APIの拒否・Cookie確認には`python3 scripts/verify-production.py`を利用できます。引数は`--origin --workspace --other-workspace --project --output`です。パスワードは対話入力し保存しません。変更APIには必須項目を欠くJSONを送り、検証でデータを作成・更新しない構成です。

## 認証制限の運用

[認証制限の方針](specs/021-auth-and-log-operations.md)に従い、現在の登録済みアカウントによる学習・デモ用途ではSupabase Authの制限を利用します。アプリ独自のIP・メール単位の制限は追加しません。運用規模を広げる際は、共有IPによる影響と永続ストアを使う制限を再検討します。

本番管理画面で2026-11-04に確認した値と、2026-11-06にCLIのconfig pullで再確認した値を区別して記載します。ローカル設定や公式資料の既定値を、本番設定の確認結果として扱わないでください。

| 管理画面の項目        | 本番確認値   | 確認日・方法                       | 対象・注意                                                        |
| --------------------- | ------------ | ---------------------------------- | ----------------------------------------------------------------- |
| token refreshes       | 150件/5分/IP | 2026-11-04 管理画面                | `/auth/v1/token`。パスワード、refresh token、ID token、PKCEを含む |
| sign-ups and sign-ins | 30件/5分/IP  | 2026-11-06 CLI config pullで再確認 | パスワード認証のtoken endpointとは別の制限                        |
| token verifications   | 30件/5分/IP  | 2026-11-04 管理画面                | トークン検証                                                      |
| IP forwarding         | 無効         | 2026-11-04 管理画面                | publishable keyでは利用不可                                       |

Next.jsから認証サービスへ中継するため、制限の判定IPがVercel側で共有される可能性があります。IP転送のために管理鍵をアプリへ登録しません。設定変更・公開時にはSupabase AuthのRate Limits画面で設定値を読み戻し、日付・値・変更理由を記録します。管理用APIを使う場合も、応答全体に含まれ得る認証情報をログへ出力しません。

認証サービスが429を返した場合、アプリはログイン画面へ戻して待機後の再試行を案内します。本番へ大量のログイン要求を送り、制限到達を試験する運用は行いません。[Supabase Authの公式制限仕様](https://supabase.com/docs/guides/auth/rate-limits)を参照してください。

## 記録の保持と月次確認

| 記録                            | 保持方針         | 削除方法                             |
| ------------------------------- | ---------------- | ------------------------------------ |
| 操作履歴 `public.activity_logs` | 無期限           | 自動削除しない                       |
| 再送記録 `private.*_requests`   | 24時間の再送契約 | 期限切れだけを作成時と定期処理で削除 |
| 専用Cronジョブの実行履歴        | 終了後7日        | 専用ジョブ2件の履歴だけを定期削除    |

DB管理者は月次にSupabaseのDB Usageと、次のSQLの件数・表と索引の合計容量・最古日時を確認し、確認日と値を運用記録へ残します。件数の集計は全件を読むため、利用が少ない時間帯に実行します。通常のアプリ利用者にはこの管理操作を提供しません。

```sql
select count(*) as row_count,
       min(created_at) as oldest_created_at,
       pg_total_relation_size('public.activity_logs'::regclass) as total_bytes,
       pg_size_pretty(pg_total_relation_size('public.activity_logs'::regclass)) as total_size
from public.activity_logs;
```

容量上限に近づいた場合はデータ追加の抑制や運用規模の縮小を検討します。操作履歴を短縮する場合は別Issueで対象期間・移行・必要な保存方法と権限を定め、利用者への影響を確認してから実施します。無料枠やバックアップを無期限の保存保証とは扱いません。

## 期限切れ再送記録の定期削除

[再送記録の定期削除仕様](specs/020-idempotency-cleanup.md)に従ってmigration012を適用します。2026-11-06に本番へmigration012を適用しました。定期実行の成功を確認済みです。今後の環境への適用でも、適用済み履歴と対象プロジェクトを先に照合し、リポジトリの原文を適用して履歴を登録します。

pg_cronが利用できる場合は、毎時17分に期限切れ再送記録を各表最大1,000件削除する`project-hub-expired-requests`と、毎日02:47に専用2ジョブの終了済み履歴を7日保持する`project-hub-cron-history`を登録します。時刻は`cron.timezone`を確認し、UTC以外であれば実行時刻を記録してください。アプリの管理鍵や追加の公開RPCは不要です。

適用後は仕様020の確認SQLで、関数の所有者・固定search_path・一般ロールの実行拒否・索引、2ジョブが各1件でpostgres所有・activeであることを照合します。さらに`cron.job_run_details`で実際のスケジュール実行が成功したことを確認し、日付・実行時刻・結果を記録します。手動実行の成功だけで定期実行の完了とはしません。失敗時は実行履歴とDBログを確認し、記録の増加や毎回の上限到達があれば頻度・上限を見直します。

拡張が利用できずジョブ未登録のNOTICEが出た場合は、関数が導入されていても定期削除は未稼働です。pg_cronを有効化して仕様020の登録ブロックを再実行するか、信頼できる管理用の定期実行環境から同じ関数を毎時実行します。管理用資格情報をリポジトリやアプリに保存しません。

停止時は対象2ジョブだけをinactiveにし、他のジョブや拡張を削除しません。再開後は登録状態に加え、スケジュール実行の成功を再確認してください。

## CSPの段階導入

[仕様019](specs/019-content-security-policy.md)のReport-Onlyを本番で確認し、[仕様022](specs/022-enforced-content-security-policy.md)で強制モードへ切り替えます。強制モードへの変更と公開結果は[PR #74](https://github.com/kiyohara1021/project-hub/pull/74)で追跡し、本番で確認したコミット・Deployment・画面操作の結果を同PRに記録します。nonceと許可範囲は維持し、応答ヘッダーを`Content-Security-Policy`へ変更します。

切り替え後は正規URLと対象コミット・Deploymentを照合し、強制ヘッダーがあり、Report-Onlyヘッダーがないこと、HTMLのscriptとヘッダーのnonceが一致することを確認します。PC/360pxで各画面・メニュー・ダイアログを操作し、consoleと`securitypolicyviolation`イベントで違反がないことを確認して、その範囲を記録してください。違反通知先の`/api/csp-report`は受信内容を読み取らず204で破棄し、アプリで保存・本文のログ出力をしません。

通常操作がCSPに遮断された場合は、Report-Onlyの動作を確認したPR #73のDeployment `12ctAVqpT1jjLFEvGmEAzJ9nxkK7`（コミット`46f1bf3bbc07bcb543f5da8751c7dcdea378bd3d`）へVercelで切り戻します。切り戻し先の環境変数と正規URL割当を照合し、Report-Onlyのヘッダーと通常操作を再確認してください。DBは変更せず、定期削除と記録の保持方針も維持します。違反した操作・directive・対象コミットを記録し、許可範囲を安易に広げず原因を修正して再検証します。

## 障害時の対応

- アプリの不具合は、Vercelで直前の検証済みDeploymentへ切り戻します。その時点の対象Deploymentと環境変数・`APP_ORIGIN`を確認してください。DBは自動で戻りません。
- DBの互換性を失う変更の前には、利用できるバックアップと復元手順を確認します。有料バックアップがあることを前提にしません。
- 公開停止にはVercelのアクセス保護・公開停止を使用します。`APP_MODE=preview`への変更は画面デモを表示するため、停止の代わりにはなりません。
- 鍵漏洩時はSupabaseで失効・再発行し、Vercelの設定を更新して再デプロイします。漏洩値をログやIssueへ貼り付けません。

## 本番反映・検証記録

<a id="公開記録p5-2で記入"></a>
<a id="p5後の仕様差分の本番反映2026-11-03"></a>

2026年11月3日、期間検索・メンバー担当件数・登録済みユーザーの所属追加を反映しました。詳細な作業ログと過去の公開履歴は[2026年11月の記録](history/deployment-2026-11.md)に保存しています。

| 項目              | 確認結果                                                                                |
| ----------------- | --------------------------------------------------------------------------------------- |
| 対応PR            | #31 → #35 → #36 → #37の順にマージ                                                       |
| アプリ基準SHA     | `1d62e7100589dfdebe6fc9d88f437d127e439397`                                              |
| Vercel Deployment | `7w5B6Jx8HfUijpYzWyVDY5YgdCb8`                                                          |
| 公開状態          | Ready / Production Current / 正規URL割当とSourceを照合                                  |
| DB                | 007→008を先行適用し、履歴8件・RPC所有者・実行権限・固定search_path・再送記録のRLSを照合 |
| ローカル・CI      | 各PRのverify/database-auth成功。統合時のDBテスト10件・認証E2E28件成功                   |

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

### 定期削除の本番確認（2026-11-06）

migration012を履歴登録と同一トランザクションで適用し、履歴12件・最新`202611060012`、索引10件、関数の所有者・固定search_pathを確認しました。anon/authenticated/service_roleの実行権限はありません。

検証時だけ各ジョブを毎分実行に変更し、期限切れ削除は01:33 JST、実行履歴削除は01:34 JSTのスケジュール実行が`succeeded`になりました。検証後に前者を`17 * * * *`、後者を`47 2 * * *`へ戻し、postgres所有・activeを読戻し確認しました。実行時刻はcronのtimezoneに従います。操作履歴の削除は追加していません。

### CSPのReport-Only導入と本番確認（2026-11-06）

[PR #73](https://github.com/kiyohara1021/project-hub/pull/73)をmainへマージし、コミット`46f1bf3bbc07bcb543f5da8751c7dcdea378bd3d`のVercel Deployment `12ctAVqpT1jjLFEvGmEAzJ9nxkK7`がReadyになったことを確認しました。これはReport-Onlyの反映記録です。強制モードの本番反映完了を示すものではありません。

- ローカルDBテスト14件・認証E2E38件・画面デモE2E11件（1件skip）・公開設定テスト6件が成功し、PRのCIもすべて成功しました。
- 本番の管理者ログインを維持した状態で、PC（1280px）と360px幅のログイン状況・ダッシュボード・プロジェクト・カンバン・課題・メンバー・操作履歴の全7画面を確認し、モバイルでは7画面のメニューも開閉しました。consoleのCSP違反はありませんでした。
- 両幅でプロジェクトの作成・編集、タスク追加、課題追加、コメント閲覧、メンバー追加のダイアログを開閉し、consoleのCSP違反がないことを確認しました。本番データの作成・更新は行っていません。
- 別ロールでの再ログイン、本番でのデータ更新成功、すべてのブラウザ環境の検証は今回の確認範囲に含めません。強制モードへ切り替えた後の再確認結果は[PR #74](https://github.com/kiyohara1021/project-hub/pull/74)に記録します。

## 追加機能の本番導入と確認

2026-11-08、適用済み001〜012とRealtimeの既存配信表が空であることを照合し、リポジトリ原文の013〜020と履歴登録を単一トランザクションで本番DBへ適用しました。読戻しで履歴20件・最新`202611060020`を確認しています。アプリの反映と画面確認の進行状況は[PR #83](https://github.com/kiyohara1021/project-hub/pull/83)〜[PR #89](https://github.com/kiyohara1021/project-hub/pull/89)で追跡します。DB適用を全機能の本番画面検証完了とは扱いません。

- 非公開Storageバケットの3MiB上限、新規4表のRLS、本人メール照合用関数の引数なし・固定search_path・限定実行権限を確認しました。
- Realtimeの公開表は`realtime_updates`だけで、INSERT配信のみです。通知・Realtime・招待の削除ジョブは登録・有効化を確認しました。新規ジョブの定期実行成功は、この時点では未確認です。
- ローカルではDBテスト23件、認証画面テスト56件の各ケースを検証しました。全体実行の54件と、通知の追加によるセレクター修正・フォーカス再確認を含む関連5件の再実行が通過しています。各PRのCI結果も参照してください。
- 送信元ドメインとFromが未決定のため、一般登録と招待メールの本番有効化、外部宛ての到着確認は未実施です。

### ResendをSupabase AuthのSMTPに設定する

送信元ドメインとFromは未決定です。本番の`SELF_SERVICE_AUTH_ENABLED=false`を維持し、Supabaseの一般signupも有効にしません。登録・招待・再設定の送信は、以下の準備と確認が完了してから有効化します。Previewには接続情報も送信機能も設定しません。

[Resend公式のSupabase SMTP手順](https://resend.com/docs/send-with-supabase-smtp)に従い、Resendでドメインを検証し、送信用APIキーを用意します。SupabaseのAuthentication → NotificationsのEmail → SMTP SettingsでCustom SMTPを有効にし、確認したSender emailとSender nameを設定します。

| SMTP項目 | 値                |
| -------- | ----------------- |
| Host     | `smtp.resend.com` |
| Port     | `465`             |
| Username | `resend`          |
| Password | ResendのAPIキー   |

このAPIキーはSupabaseのSMTP資格情報としてだけ保存し、Vercel・アプリ・リポジトリへ追加しません。招待もSupabase Auth経由で送り、アプリからResend APIを直接呼びません。

1. 送信元ドメインの検証とFromを確定し、SupabaseのSite URL・許可リダイレクトを正規HTTPSオリジンへ限定します。
2. 確認・再設定・招待メールのテンプレートを実装の`/confirm`・token_hash・許可するtype/nextと照合します。リンクGETは認証を消費せず、画面POSTで確認します。ローカルテンプレートの設定はHostedへ自動反映されません。
3. Supabaseのsignup許可とメール確認必須（confirmations=true）、SMTP、送信制限を確認します。公開登録を許可する時点まではアプリのフラグをfalseに保ちます。
4. 承認済みの検証宛先で確認メール・再設定・招待を検証し、確認前拒否、別ブラウザ、GET未消費、トークン再使用拒否、招待先の現在の確認済みメール照合、明示承諾まで所属しないことを確認します。ローカルのexample.invalid宛て試験は外部送信しません。
5. 条件が整った後だけProductionの`SELF_SERVICE_AUTH_ENABLED=true`を設定して再デプロイし、日付・対象SHA・設定と確認範囲を記録します。送信受付を到着・開封の確認と混同しません。失敗時はフラグをfalseへ戻します。

### Storage・通知・Realtime

- 添付は非公開`project-attachments`とポリシー、3MiB/20件の制約、非公開プロジェクトの失効を確認します。物理削除は台帳とStorage APIを使い、月次と消去失敗時に管理用CLIで回収対象を確認します。アプリへ管理鍵を追加しません。
- 回収はCLI認証と対象プロジェクトを照合し、`node scripts/cleanup-attachments.mjs --project-ref <対象project-ref>`で最大100件の対象を確認してから、同じ引数に`--execute`を付けます。未完了台帳が残れば確認・再実行します。storage.objectsをSQLで直接削除しません。
- 通知は本人と現在の閲覧権限、90日保持、既読の本人境界を確認します。pg_cronの登録と実行成功を別途確認します。業務データ・操作履歴の保持は変えません。
- Realtimeは既存publicationの用途を確認します。migration019は全表publicationや他の公開表がある場合にロールバックする契約です。専用プロジェクトでrealtime_updatesだけのINSERT配信、RLS、本人宛て分離、失効・再接続・入力保持を確認します。業務表を追加しません。
- Realtimeの1日超イベント削除と通知の定期削除は、ジョブの登録・成功記録を確認してから導入済みとします。pg_cronのない環境では管理用の代替実行を決め、定期実行未導入と記録します。CSPのconnect-srcは対象SupabaseのHTTPS/WSSだけに限定します。
