# 画面のリアルタイム更新

Issue: [#82](https://github.com/kiyohara1021/project-hub/issues/82)。実装中。

## 目的・範囲

同じデータを開いている別のブラウザの変更を反映する。ポーリングや業務データそのものの配信は行わず、Supabase RealtimeのINSERT通知を受けた画面が通常の読取処理で再取得する。公開デモ・未認証ページでは接続しない。

## 通知するデータと認可

- 配信表`public.realtime_updates`はランダムなid、宛先user_id、種類（data/access/notification）、作成日時だけを持つ。プロジェクトID・ワークスペースID・名前・本文・担当者などを載せない。
- データ変更のDBトリガーが、その時点で閲覧できるユーザーだけを`private.can_user_read_project(workspace_id,project_id,user_id)`で選ぶ。ワークスペース共通の変更は現在の所属者、所属・プロジェクト参加の失効は影響本人にもaccess通知を作る。
- RLSは本人宛ての行のSELECTだけを許可し、匿名・他人の行・通常ユーザーの直接INSERT/UPDATE/DELETEを拒否する。参加失効後も本人宛ての汎用通知は届くが、再取得する業務データはAPI/RLSで非表示になる。
- 業務表のPostgres Changesは公開しない。`supabase_realtime`が全表対象でなく、既存公開表がrealtime_updates以外にないことを適用前に確認する。条件外は例外でロールバックし、管理者が用途を確認する。条件を満たす専用プロジェクトだけでpublicationを`publish='insert'`にし、realtime_updatesだけを追加する。DELETE・UPDATE・TRUNCATEは配信しない。
- イベントは1日を超えたものを毎時最大10,000行ずつ削除する。所有者だけが実行でき、通常の業務データや操作履歴は削除しない。pg_cronが使えない環境では定期実行未導入と記録し、管理用の代替手順を使う。

## ブラウザと入力の維持

- サーバーから渡す接続情報は検査済みの公開URL・publishable/anon keyと本人IDだけ。管理鍵はシリアライズしない。createBrowserClientのCookieセッションを使い、トークン更新をRealtimeへ反映する。
- INSERT通知は短い待機でまとめ、通常画面はrouter.refreshで再取得する。初回購読確立時はサーバー描画開始後の本人宛てイベントを確認し、描画と購読の間の変更も拾う。通信断・再接続・画面復帰後も必要に応じて再取得する。
- formのinput/changeを記録し、DOMに残る編集済みフォーム、開いているダイアログ、ドラッグ中、処理中がある間は自動で再取得しない。「更新があります」の案内を出し、入力を維持する。保存済みと判定できないフォームも保守的に扱う。
- 更新案内と再読込ボタンは、ダイアログが開いているときはその内部、それ以外はページ上部の通常フローに表示する。保存ボタンや入力欄に重ねず、ダイアログ内からも明示的に入力を破棄して再読込できる。
- 所属・公開範囲の変更も入力を突然破棄しない。編集していなければ直ちに再取得し、編集中は権限変更の案内から明示的に入力を破棄して再読込する。保存操作は既にAPI/RLSで最新権限を検査しているため、失効後の書込は拒否する。
- フォームがDOMから消えた後は保留中の更新を反映できる。明示的な「入力を破棄して再読込」はページを読み直し、Client Component内の下書き状態も破棄する。
- ログアウト操作、セッション終了、別のユーザーへの切替、アンマウントで購読を解除する。通信断時は案内と手動の再読込を用意し、定期ポーリングは追加しない。

## CSPと運用

接続モードだけで、設定したHosted SupabaseのHTTPSとWSSオリジンをconnect-srcへ追加する。ローカルは127.0.0.1:54321のHTTP/WSだけを許可する。Previewはselfのままとし、ワイルドカード・任意の送信先・script許可範囲の追加は行わない。

本番ではSupabase Realtimeを有効にし、専用publication、RLS、宛先分離、再接続、Cronの実行を確認する。既存publicationを他用途で使っている場合は、無断で設定を変えず構成を調整する。

## 受け入れ条件

- DBでpublic/privateプロジェクトの配信先、失効本人への汎用通知、他人SELECT・直接書込拒否、イベントの列に業務情報がないこと、publicationのINSERT限定、期限切れだけの削除を確認する。
- 2つのブラウザでタスクなどの変更が自動反映され、編集中のフォームやダイアログは入力を失わず更新案内を表示する。
- 非公開プロジェクトの非参加者へイベントを配信しない。参加解除後は編集していない画面から対象が消える。
- 通信断・再接続・ログアウトで接続と表示が適切に変わる。公開デモではWebSocket通信しない。
- CSPと公開設定テストで、接続先の限定、Preview分離、公開鍵だけの受渡しを確認する。

## 根拠

[SupabaseのSSRクライアント](https://supabase.com/docs/guides/auth/server-side/creating-a-client)、[Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes)、[Realtimeの認証更新](https://supabase.com/docs/reference/javascript/setauth)を参照した。DELETEでのRLS制約に依存せず、INSERTだけの専用publicationで通知する。
