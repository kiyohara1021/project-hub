# P4-1: 課題管理

> 実装時の仕様（対応済み）です。「対象外」はこの段階の作業範囲を示します。現在の動作は[基本仕様](../specification.md)、追加・変更の関係は[仕様一覧](README.md)を参照してください。

関連: [Issue #11](https://github.com/kiyohara1021/project-hub/issues/11)

## 受け入れ条件

- AC1: 接続モードでプロジェクトから課題一覧へ移動できる。workspace/projectをURLに保持し、未認証はログイン、所属外/別projectのIDは404。previewモードは従来の固定表示を維持。
- AC2: admin/memberは作成・編集・解決・再開・削除、viewerは閲覧のみ。アーカイブ済みプロジェクトは全員読み取り専用。担当は同じworkspaceの所属者または未割当。
- AC3: タイトル1〜120字、本文0〜5,000字、優先度low/medium/high、期限は実在日付または未設定。状態はopen/investigating/resolved/closed。作成時open、編集で状態を変更可能。状態変更と削除は明示確認を挟む。
- AC4: 作成はIdempotency-Key必須、同workspace/project/actor/キー/本文の24時間以内の再送は同じ結果、本文違いは409。編集/削除はversion必須で競合409。親のアーカイブと所属解除を含めworkspace/projectロックで直列化し、履歴を同時確定。
- AC5: 件名・状態・優先度・担当者をURLで絞り込み、created_at DESC,id DESCでページ送り。既定は未解決（open/investigating）、25件・上限100件。担当unassignedは未割当。0件と失敗を明示し、保存失敗時は入力保持、409は明示操作で最新版を読み直す。
- AC6: 360pxで操作可能。長い本文は詳細表示で確認できる。ダッシュボードの未解決件数に作成/解決/再開/削除が反映される。
- AC7: DB/API/画面で権限・所属・担当すり替え・アーカイブ・同時再送・version・削除履歴・フィルター/ページ送り・失敗復旧を検証し既存CIも成功。

## API

接頭辞 `/api/v1/workspaces/:wid/projects/:pid/issues`。GET一覧はq/status/priority/assignee/limit/cursor。statusはunresolved（既定）/all/open/investigating/resolved/closed。未知/重複クエリーは400。

POST本文はtitle/description/priority/assignee_id/due_date。PATCH `/:iid` は同じ5項目 + status/version。GET `/:iid` は単一読取。DELETE `/:iid` はversion。全項目必須、不明キー拒否、JSON上限32KiB。Origin/JWT/UUID/所属/ロールを検証し、APIで管理鍵を使用しない。

## 範囲と判断

課題の親プロジェクト/権限/アーカイブ判定はタスクと同じガードを共用する。解決後も編集・再開可能。削除は物理削除し履歴を残す。再送の期限切れ記録は同workspace/actorの次回作成時に削除。再送にも現在の権限・アーカイブ検査を適用する。コメント、通知、メンバー管理、操作履歴一覧、クラウド・デプロイは対象外。
