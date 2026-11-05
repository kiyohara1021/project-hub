# Content Security Policyの強制モードへの移行

Issue: [#58](https://github.com/kiyohara1021/project-hub/issues/58)。[仕様019](019-content-security-policy.md)のReport-Only導入を引き継ぐ。

## 目的と移行条件

本番のReport-Onlyで通常の画面・メニュー・ダイアログにCSP違反がないことを確認したため、同じポリシーを強制モードへ移す。2026-11-06の確認範囲は[運用記録](../deployment.md#cspのreport-only導入と本番確認2026-11-06)に記載する。未許可のスクリプトなどをブラウザで遮断する変更であり、認可・入力検証・DB権限の代わりにはしない。

## 契約

- 応答ヘッダーを`Content-Security-Policy-Report-Only`から`Content-Security-Policy`へ変更し、Report-Onlyとの二重配信は行わない。Previewと接続モードで同じ方式を使用する。
- 要求ごとのnonce、内部リクエストへのCSP設定、Next.jsのscriptとRadixのstyleへのnonce付与、RSC要求後も初期HTMLのnonceを維持する方式は仕様019から変えない。
- 許可元・`strict-dynamic`・style属性の例外・開発サーバーだけの`unsafe-eval`も維持する。通常ビルドで`unsafe-eval`を追加しない。
- `Cache-Control: private, no-store`と動的レンダリングを維持し、nonce付きHTMLを共有キャッシュへ保存しない。認証Cookie更新時にもCSPを維持する。
- `report-uri /api/csp-report`を維持する。POSTは204を返し、本文を読み取らず破棄する。アプリによる本文の保存・ログ出力や収集・分析基盤は追加しない。
- DB・環境変数・認証制限・記録の保持方針は変更しない。

## 受け入れ条件と検証

- 公開設定テストで強制ヘッダーの名前、許可元、開発限定のeval許可、nonceの生成を確認する。
- Previewと接続モードで、通常画面の応答に強制CSPだけがあり、HTMLのscriptと必要な動的styleのnonceが一致することを確認する。
- PC/360pxの画面表示・メニュー・作成/編集・コメントの各ダイアログ、画面遷移、RSC再取得後の操作がCSP違反を起こさないことを確認する。既存の認証・更新操作のE2Eも回帰確認する。
- テスト専用にHTMLへnonceなしのinline scriptを挿入し、そのscriptが実行されず、違反イベントのdispositionが`enforce`であることを確認する。違反通知先の204も確認する。本番へ検証用scriptは追加しない。
- 本番の切り替え後は、正規URL・対象コミット・Deploymentを照合し、強制ヘッダー、nonce、PC/360pxで実際に確認した画面・操作と違反の有無を記録する。ローカルの確認を本番の実施結果として扱わない。

## 切り戻し

通常操作の遮断が発生した場合は、[運用手順](../deployment.md#cspの段階導入)に従ってReport-Onlyを配信する検証済みDeploymentへ切り戻す。`unsafe-inline`などでscriptの許可を広げて回避しない。原因と確認範囲を記録し、修正後にローカル・Previewと本番で再確認する。DBの変更・ロールバックは不要。
