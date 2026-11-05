# Content Security Policyの段階導入

Issue: [#58](https://github.com/kiyohara1021/project-hub/issues/58)

この文書はReport-Only導入時点の仕様です。強制モードへの移行は[仕様022](022-enforced-content-security-policy.md)、現在の反映状況は[対応状況](../roadmap.md)を参照してください。

## 目的・範囲

画面のスクリプト・スタイル・通信先を明示し、CSPを段階的に導入する。最初は`Content-Security-Policy-Report-Only`で配信し、通常操作への影響を確認する。違反レポートの収集サービス、第三者のスクリプト許可、CSPの強制モードへの切り替えは本変更の対象外とする。

## 契約

- Proxyで要求ごとに暗号学的乱数16バイトのnonceを生成する。クライアントが送ったnonce・CSPは引き継がず、内部リクエストの`x-nonce`と`Content-Security-Policy`を置き換える。Next.jsがこの内部CSPからnonceを取得してHTMLのスクリプトへ付与する。
- 応答には同じnonceを含むReport-Onlyヘッダーを設定する。強制用`Content-Security-Policy`は応答へ設定しない。nonce付きHTMLとヘッダーを共有キャッシュに保存しないよう`Cache-Control: private, no-store`を設定する。
- `/`・ログイン・ログイン状況・6画面・認証と業務APIの既存Proxy対象を、Preview/接続モード双方で扱う。認証Cookieを更新して応答を作り直した場合も、内部リクエストヘッダー・nonce・Report-Onlyを維持する。
- `script-src`は`'self' 'nonce-…' 'strict-dynamic'`とする。`'unsafe-eval'`は開発サーバーに限り許可し、通常ビルド・Preview・本番では許可しない。
- 通信・フォント・フォームは同一オリジンに限定する。オブジェクトとフレーム埋め込みは拒否する。画像は同一オリジン・data・blobに限定する。
- スタイル要素は同一オリジン・nonce付きだけを許可する。進捗幅、表の列幅、Radixの位置・スクロール制御が使うstyle属性は`style-src-attr 'unsafe-inline'`で許可する。この例外はscriptの許可範囲を広げない。
- Radixのダイアログ・Sheetが使う`react-style-singleton`へは、`get-nonce`の公開APIで現在のHTMLのnonceを渡す。クライアント側のlayout effectでDOM内のscriptの`nonce`プロパティを読み取り、style要素が挿入される前に設定する。RSC更新要求で発行される別nonceへは切り替えない。
- 違反通知先として`report-uri /api/csp-report`を指定する。受信口はPOSTに204を返し、本文の読取・保存・ログ出力を行わない。収集・分析基盤は導入しない。
- RootLayoutは既存の`force-dynamic`を維持する。nonce方式でHTMLをリクエストごとに生成するため、本変更を静的配信・ISR・PPR対応とは扱わない。

## 確認方法

- 公開設定テストでReport-Onlyヘッダー、開発限定のeval許可、通信先とstyle属性の例外、要求ごとのnonceの違いを確認する。
- Preview/接続モードの各画面・ログイン状況・ログインに対し、ヘッダーのnonceとHTMLスクリプトのnonceを照合し、フルロード・画面遷移・再取得を確認する。
- PC/360pxでメニューのSheet、作成/編集ダイアログ、課題コメントを開閉し、`securitypolicyviolation`イベントとCSP違反のconsoleエラーがないことを確認する。
- テスト専用のnonceなしinline scriptを使い、違反を検出するが実行を止めないReport-Onlyの動作も確認する。
- 本番では正規URLの応答ヘッダーと、実際に確認した画面・操作を運用手順に記録する。強制モードへの移行は、その確認範囲と残る違反を評価して別変更で行う。

## 参考

- [Next.js公式CSPガイド](https://nextjs.org/docs/app/guides/content-security-policy)：Proxyのnonce生成、内部CSPからの自動付与、動的レンダリング、開発時だけのunsafe-eval。
- 依存パッケージの実装：`react-style-singleton` 2.2.3のstyle作成時のgetNonce参照と、`get-nonce` 1.0.1のsetNonce公開APIを確認した。

- [W3C CSP Level 3 §5.5](https://www.w3.org/TR/CSP3/#report-violation)：違反通知の仕様。違反通知は内容を破棄する同一オリジンの受信口へ送り、イベントとconsoleで確認する。
