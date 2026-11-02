# P5-1 公開準備（Issue #17）

> 実装時の仕様（対応済み）です。「対象外」はこの段階の作業範囲を示します。現在の動作は[基本仕様](../specification.md)、追加・変更の関係は[仕様一覧](README.md)を参照してください。

## 目的と範囲

Vercel Hobbyの個人非商用デモとして公開できる設定と手順を整える。実在情報を含めず、PreviewはDBなしの画面デモ、本番だけ別途設定したSupabaseに接続する。クラウドアカウントの接続・実際のプロジェクト作成・本番DB反映・公開URLでの確認はP5-2で実施する。

## 受け入れ条件

- vercel.jsonでNext.js、pnpm frozen install、専用build:vercelを設定。package.jsonのNode.js範囲は24系を維持。ログ・ソースの公開範囲はVercel管理画面で確認する。vercel.jsonにpublicキーは含めない。
- APP_MODEを明示。previewではDB接続変数を拒否、Vercel Previewでconnectedを拒否。本番でも画面デモだけを公開する場合はpreviewを使用できる。
- connectedではAPP_ORIGINがHTTPSオリジン、SUPABASE_URLがHosted SupabaseのHTTPSプロジェクトURL、キーがpublishableまたはrole=anon形式であることを検査。既知の管理鍵変数・service_roleキーは拒否し、値をログ出力しない。
- 検査は設定形式だけを保証する。鍵の実在性・署名・DB到達性・RLS・Auth設定は公開先の別確認が必要。
- アプリは全ページでnoindex/nofollow、nosniff、frame DENY、strict-origin-when-cross-origin、カメラ/マイク/位置情報無効のヘッダーを返す。検索除外はアクセス制御の代替ではない。
- 認証Cookieは正規APP_ORIGINがHTTPSの場合Secureを付与し、ローカルHTTPでは付与しない。Server/Proxyで共通設定を使う。
- 360px/PC幅の接続モード6画面で本文スキップ・横溢れ・表示を検証。モバイルメニューと主要4ダイアログでTab/Shift+Tabのフォーカス保持、Escapeと起点への復帰を検証。ログインからログアウトまでキーボードで動作。
- 接続状態画面とログイン画面は公開後も使える説明に更新。スマートフォンの履歴所属先選択は全幅表示する。
- デプロイ・初期所属設定・RLS確認・切り戻し・停止・利用量確認の手順を記録。既存ローカルseed/権限テストをリモートDBへ転用しない。

## 検証と制約

設定検査の正常/異常・秘密値を出さないCLIを自動テストしCIに追加。接続モード/プレビューモードのE2Eと通常チェックを通す。セキュリティヘッダーはブラウザの実応答で確認。

本工程ではVercel/Supabaseの接続が未確認であり、公開完了とはしない。公開URLの到達性、実際の認証cookie/Origin、Hosted DBのRLSとマイグレーション適用、利用量・性能の実測はP5-2の記録を残す。
