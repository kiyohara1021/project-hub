# 公開・検証履歴（2026年11月）

2026年11月1日〜3日の公開作業と検証結果を保存した記録です。「未実施」「残作業」「継続」などの記述は、各時点での状態を示します。現在の構成と作業手順は[公開・運用手順](../deployment.md)を参照してください。

検証値・Deployment ID・コミットSHAは当時のものです。現在の性能・利用量・切り戻し対象を保証するものではありません。

## 公開記録（P5-2で記入）

| 項目                                  | 状態                                                                                                                                                                                                                       |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vercelアカウント/Project              | ProjectHub Personal（Hobby）/ project-hub 作成済み                                                                                                                                                                         |
| Supabaseプロジェクト/6件反映          | project-hub / Tokyo（ap-northeast-1）、6件反映済み。7テーブルのRLS・匿名読取不可・直接書込不可を確認                                                                                                                       |
| 正規URL/初回公開確認SHA               | https://project-hub-zeta-nine.vercel.app / cba33556e76fc4428815ecf1cc5c52c168b7bea8                                                                                                                                        |
| 本番Auth・RLS・Origin・Cookie検証     | 一般登録・匿名ログイン無効、Site URL設定済み。匿名の6 APIは401、変更APIの異なるOriginは403。管理者・メンバーの保存/更新と3ロールのログイン・画面権限を確認。実認証での禁止API・他workspace拒否・Cookie属性の追加確認を継続 |
| 公開先モバイル/キーボード・性能/Usage | 画面デモ6画面のPC/360px表示・横溢れなし・モバイルメニューEnter/Escapeとフォーカス復帰を確認。性能/Usageの詳細確認は未実施                                                                                                  |

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
- DBパスワードと3人のAuthユーザーのパスワードは所有者本人が画面で設定。テスト用メールアドレスのadmin/member/viewerをAuto confirmで作成し、初期workspaceの各ロールへ所属設定した。外部メール招待は行っていない。
- 管理者の実ログインでサンプルプロジェクト作成・進行中への更新、担当/優先度付きタスク作成と状態移動、課題作成と解決、監査ログ反映、ログアウトを確認。
- 匿名HTTPの6画面は/loginへ誘導する。App RouterはリダイレクトをHTTP200のHTML内meta refreshで返す場合があるため、ステータスだけを判定基準にしない。6 APIの未認証401/no-storeと異なるOriginの403も確認済み。
- VercelのStandard Protection（Require Log In）とProtected Sourcemapsは有効な既存設定を確認。保護を無効化したり、迂回トークンを作成していない。
- Supabase Data APIへ公開キーで匿名アクセスし、7テーブルとread_dashboard RPCが401/42501で拒否されることも確認。
- Vercel UsageのFast Data Transferは確認時点で6.51MB/100GB。課金機能の追加・プラン変更は行っていない。

メンバー・閲覧者の本番ログインと画面権限は下記の通り確認。実認証での禁止API・他workspace拒否・Cookie属性と性能の記録は継続する。過去の画面デモ公開の検証結果は、その時点の記録として上に残す。

### メンバー・閲覧者のProduction確認（2026-11-02）

所有者がそれぞれのパスワードを公開サイトで入力し、ログイン状況とメンバー一覧で本人とロールを照合した。パスワード・Cookie/JWTの値は取得していない。

| 確認対象         | メンバー（デモメンバー02）                             | 閲覧者（デモメンバー03）                                 |
| ---------------- | ------------------------------------------------------ | -------------------------------------------------------- |
| プロジェクト一覧 | 閲覧専用、作成/編集操作なし                            | 閲覧専用、作成/編集操作なし                              |
| カンバン         | サンプルタスクを進行中からレビューへ移動し、保存成功   | 同じタスクをレビュー列で閲覧。追加/編集/状態変更操作なし |
| 課題一覧         | サンプル課題の担当を未割当から自分へ更新し、一覧に反映 | 更新後の担当と解決済み状態を閲覧。追加/編集操作なし      |
| メンバー一覧     | 自分のメンバーロールを確認、読み取り専用               | 自分の閲覧者ロールを確認、読み取り専用                   |
| 操作履歴         | タスク/課題の更新が本人名義で記録                      | メンバーによる更新を閲覧                                 |
| ダッシュボード   | 進行中1件、全1タスク、自分のタスクがレビューで表示     | 同じ集計を表示、自分の未完了タスクはなし                 |

メンバー・閲覧者は確認後にログアウト済み。これらはUIの権限制御と許可された保存・読み取りの確認であり、禁止された変更APIへ実認証リクエストを送った検証ではない。Issue #19は、他workspace拒否・Cookie属性・公開先性能などの残作業を含むため完了扱いにしない。

### 追加検証と表記整理（2026-11-02）

- UI共通部と入力ダイアログの開発向け説明を整理。利用条件・データ方針は本資料/CONTRIBUTINGで管理する。
- 本番APIの拒否/Origin/Cookieを検証する`python3 scripts/verify-production.py`を追加。引数は`--origin --workspace --other-workspace --project --output`。パスワードは対話入力し保存しない。Cookie値も出力しない。変更APIには必須項目を欠く空JSONだけを送り、権限チェックが後退してもデータを作成/更新できない入力とする。ローカルseed/共通パスワードを本番へ送らない。
- 他workspaceの検証用に、誰も所属しない空の「権限確認用スペースB」を専用DBへ作成し、SQLで所属0件を確認。既存アカウントへ権限を追加していない。
- [リポジトリの公開前確認](../publication-review.md)を記録。Public化は実行していない。

- Usage確認時点: Supabaseのproject-hub単体はDB 26.01MB（上限0.5GB）、MAU 3、Egress/Storage表示0GB。組織全体もFree枠内。Vercelのproject-hubはFast Data Transfer 9.65MB/100GB、Fast Origin Transfer 3.25MB/10GB、Fluid Provisioned Memory 0.11GB-Hrs/360GB-Hrs。Vercel表示期間はOct 2–Nov 1、SupabaseはOct 10–Nov 10。表示の丸め・更新遅延を含むスナップショットであり、継続的な上限保証ではない。

### 認証済みAPI・Cookieの本番検証（2026-11-02）

所有者が対話入力したメンバー/閲覧者の実セッションで46項目すべて成功。各ロールの6読取APIは200/no-store。両ロールのプロジェクト作成とメンバー管理、閲覧者のタスク/課題作成は403/FORBIDDEN。異なるOrigin・null・Origin未指定は403/INVALID_ORIGIN。実在し所属0件の別workspaceに対する6読取APIは404/NOT_FOUND。ログアウト後は401へ戻る。

実際のログイン応答のCookieはSecure、SameSite=Lax、Path=/、host-only。HttpOnlyはSupabase SSRの現行設定ではfalseであり、HttpOnlyを確認したという扱いにはしない。Cookie値・パスワードは記録していない。初回のPython CA未設定はmacOSの信頼済みCAを使用して解消し、入力前にHTTPS事前確認を行う。

読取API12回の単発実測は1,380–3,535ms、中央値1,702ms。負荷試験・Core Web Vitalsではない。レスポンスのx-vercel-idで実行拠点iad1を確認し、Supabase Tokyoとの距離を減らすためvercel.jsonに単一リージョンhnd1を設定。Hobbyの1リージョン範囲内で、反映後の応答確認を行う。

切り戻し基準は変更前のReady Production（Deployment GAuCwh3r3s5xnGNyQPnY4CTKkL35、SHA e95487b61b1787490122034d80ba1aac9ebf58ad）。今回DB変更なし。HobbyのInstant Rollbackは直前のProductionのみで、過去ビルド時の環境変数へ戻り、DBデータは戻らない。必要なら基準コミットへのrevert PRと現在の環境設定での再ビルドを使う。切り戻し自体は未実行。

参考: [Functionsのリージョン](https://vercel.com/docs/functions/configuring-functions/region)、[Instant Rollback](https://vercel.com/docs/instant-rollback)。

### 表記整理・Tokyo配置の公開後確認（2026-11-02）

- PR #25のSHA `aba80eb885435ca38ef5ea146e66297e751eb31f`をProduction Deployment `8pMhXGiuvU3KPxE9DGDaRGkQ3tku`へ反映しReadyと正規URLを確認。HTTP応答のx-vercel-idでhnd1を確認。
- 本番のDB接続モード6画面を360px/1280pxで表示し、全画面で横溢れなし。常設の開発向け注記・固定ユーザー表示がないことを確認。サンプルプロジェクト説明に残った非商用表記も、対象IDと旧本文を限定して通常の説明へ更新した。
- 本文スキップ、メニューのEnter/Tab/Shift+Tab/Escape、タスク/課題追加ダイアログのフォーカス保持と閉じた後の起点復帰を本番で確認。これらの検証ではレコード作成・削除は実行しない。
- 同一ブラウザ/同一メンバーセッションで6読取APIを1回ずつ測定。変更前は1,069–2,083ms（中央値1,715ms）、Tokyo配置後は399–2,270ms（中央値536ms）。すべてデータを取得。後者の初回dashboardは2,270msで、残る5件は399–660ms。
- 計測値はブラウザ操作ツールの往復を含む単発のGET完了時間。ネットワーク・ウォーム状態を制御したベンチマークや負荷試験、Core Web Vitalsではない。詳細な描画指標はChrome DevTools MCP未接続のため未計測であり、上記API計測と区別する。
- Usageと切り戻し基準は前節の通り。新たなDBマイグレーションはなし。最新デプロイからの即時切り戻し対象は、その時点でVercelが提示する直前Productionを確認して選択する。

Issue #19の本番公開確認は、認証/ロール・API拒否・所属境界・Origin/Cookie・監査ログ・DB接続後の表示/キーボード・API応答/Usage・切り戻し基準の記録をもって完了。Core Web Vitals・負荷試験・DB復元訓練を実施したという意味ではない。

### 追加の詳細ブラウザ計測（2026-11-02 / Issue #27）

Chrome DevTools公式CLIで描画/操作の計測を追加した。[条件・集計・制約](../performance.md)を参照。22回の読み込みでLCP最大1,008ms、CLS最大0.08。別のモバイル操作トレースのINPは142ms。実ユーザーp75の評価や負荷試験ではない。公開前記録の「詳細描画指標は未計測」はその時点の状態であり、この追加計測をもって更新する。

ユーザーがPublic化によるコード・Git履歴・Actionsログの公開を了承し、GitHubリポジトリをPublicへ変更済み。認証なしのGitHub APIでも確認した。アプリのログイン制限やDB権限は変更していない。

## P5後の仕様差分の反映順序

2026-11-03に期間検索・メンバー担当件数・登録済みユーザーの所属追加を本番反映済み（結果は次節）。ローカル負荷検証スクリプトもmainへ反映した。適用時の依存順序は PR #31 → #35 → #36 → #37。PRを順次レビュー・マージし、メンバー担当件数の`202611030007_member_assignments.sql`、所属追加の`202611030008_add_member.sql`をこの順にProduction Supabaseへ適用する。DBスキーマ・RPC・実行権限が追加されるため、Productionの適用結果と権限を確認してから対応するアプリを反映する。マイグレーション名はリポジトリの実ファイルを正とし、先行する適用済みファイルを書き換えない。

`pnpm test:load`は専用fixtureを使うローカル回帰確認で、本番性能検証ではない。本番に向けて実行せず、測定条件と限界は[性能記録](../performance.md#100プロジェクト1000タスクのローカル一覧api検証)を参照する。

### P5後の仕様差分の本番反映（2026-11-03）

PR #31 → #35 → #36 → #37をmerge commitで順次mainへ反映。アプリ基準SHAは`1d62e7100589dfdebe6fc9d88f437d127e439397`、Vercel Deploymentは`7w5B6Jx8HfUijpYzWyVDY5YgdCb8`。Production Ready・Currentと正規URL割当、Source main/1d62e71をVercel管理画面で照合した。各PRのverify/database-authとVercel Previewは成功済み。統合時のローカルDBテスト10件・認証E2E28件も成功している。

- 対象は既存のproject-hub専用Hosted Supabase（Tokyo）であることと、適用済み6バージョン・追加RPC未存在を照合。SQL Editorでリポジトリの007→008を原文のまま、事前条件・履歴登録・schema reloadを含む単一トランザクションで適用し、8バージョンを確認してから対応アプリをマージした。ローカルseedと負荷fixtureは本番へ送っていない。
- `read_members`はSECURITY INVOKER、`add_member_once`はSECURITY DEFINER、双方の所有者はproject_hub_owner、search_pathは空。authenticatedのEXECUTEは許可、anonは拒否。private.member_requestsはRLS有効、authenticatedのSELECT/INSERTとanonのSELECTは拒否を照合した。
- 所有者がブラウザで管理者ログインし、デモスペースAの3名・既存ロール・未完了タスク件数（メンバー1件、他0件）・未解決課題0件を確認。管理者条件のメンバーAPIも件数とnextCursorを返した。
- 所属追加は初期ロール閲覧者、UUIDと全プロジェクト閲覧の確認、Esc後の起点へのフォーカス復帰を確認。既存管理者IDへの追加要求は「既に所属」のエラーとなり、所属3名と管理者ロールを維持。新規所属の成功・ロール変更・削除は今回の本番スモークでは行っていない。成功経路・通信再送・admin/member/viewerの権限境界はローカルDB/E2EとCIで確認済み。
- 操作履歴で2026-11-02の同日指定・limit=1による検索と次ページを確認。開始日/終了日を保持し、絞り込み再送信でcursorが解除され先頭へ戻ることを確認した。
- 匿名HTTPのdashboard/projects/tasks/issues/members/activityはすべて401 UNAUTHENTICATED / private,no-store。異なるOriginからの所属追加は403 INVALID_ORIGIN。パスワード・Cookie・JWTを抽出/保存/ログ出力していない。

この追加確認は管理者の本番画面・読取・安全な重複拒否と匿名/Originの境界が対象。今回の本番スマートフォン幅検証、member/viewerの再ログイン、新規所属作成、本番の100プロジェクト/1,000タスク負荷試験を実施したという意味ではない。既存のローカル・CIの結果と区別する。
