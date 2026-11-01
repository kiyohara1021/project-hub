# P2-2: プロジェクト一覧と作成・編集

関連: [Issue #5](https://github.com/kiyohara1021/project-hub/issues/5)

## 受け入れ条件

- AC1: connectedモードの `/projects` はログイン必須。所属workspaceを選び、DBのプロジェクトを表示する。未所属は空表示、他workspace指定は404。previewモードは従来の固定データを維持。
- AC2: 名前の部分一致・状態・ページ送りをURLに保持。検索は明示的な検索ボタンで適用し、workspaceや条件変更時はカーソルをリセットする。created_at DESC,id DESCの複合カーソル、既定25件・上限100件。
- AC3: adminのみ新規作成と編集ダイアログを使える。名前1〜120字、本文0〜5,000字、期限は実在するYYYY-MM-DDまたは未設定、状態はplanned/active/archived。member/viewerは閲覧のみ。削除はアーカイブで代替し、復元可能。
- AC4: POSTは必須Idempotency-Keyで24時間再送可能。同じworkspace・actor・キー・本文なら同じプロジェクトを返し、本文が違えば409。別workspaceや別actorのキーは独立。PATCHはversionで競合検出。変更と履歴は同時確定。
- AC5: 書込APIはOrigin、JWT、UUID、JSONサイズ/型、所属、ロールを検証。ブラウザのロール表示だけで許可しない。無所属/不存在は404、権限不足403、入力不正400、競合409。
- AC6: 保存中の二重送信防止、失敗時の入力保持、409で最新版を明示的に読み直す操作、キーボード・360px幅に対応。保存成功時に一覧を更新する。
- AC7: DBで再送・同時再送・権限・versionを検証。ブラウザ/APIで作成→編集→再読込、アーカイブ/復元、検索/ページング、viewer拒否、別workspace拒否、409・失敗からの復旧を確認。既存CIも成功。

## 範囲

詳細画面・タスク・課題・進捗集計・クラウド・デプロイは対象外。DBプロジェクトカードから未実装のカンバンへリンクしない。ダッシュボード等は固定プレビューであることを明示。アーカイブは子データを読み取り専用にする設計で、管理者によるプロジェクトのメタデータ編集・復元は許可する。

POST本文: name,description,due_date。PATCH本文: name,description,status,due_date,version（全項目必須）。不明なキーを拒否。JSON上限32KiB。APIカーソルは同workspace内のDBフィルター値として形式検証し、SQL式を含めることを許さない。

## 設計

一覧はServer ComponentでRLS付き読取を行い、編集だけClient Component。読取処理と入力検証をUI/APIで共用する。新しいRPCは専用の非公開テーブルにリクエスト本文と作成結果を保存し、workspace行ロックで同時再送を直列化する。期限切れは次回の同workspace/actorの作成時に削除。古いRPCの互換性は維持し、HTTP作成は必ず再送対応RPCを使う。
