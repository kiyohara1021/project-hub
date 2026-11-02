# メンバーの担当件数

## 目的・範囲

基本画面仕様にある担当件数を接続モードのメンバー一覧に追加する。仕様007で保留した集計範囲を定義し、作業が残る担当を確認できるようにする。

## 受け入れ条件

- 各メンバーの未完了タスク数（todo / doing / review）と未解決課題数（open / investigating）を別々に表示する。0件も明示する。
- 所属workspace内のplanned / activeプロジェクトだけを対象とする。doneタスク、resolved / closed課題、archivedプロジェクト、未割当、他workspaceは除外する。
- 集計はDB内で行い、一覧の25件/最大100件やSupabaseの行取得上限による切り捨てを起こさない。同じ応答の所属・担当件数は単一SQLスナップショットで読む。
- GET `/api/v1/workspaces/:wid/members` の各data要素へ `task_count` / `issue_count`（0以上の整数）を追加する。詳細GET `/members/:uid` とロール変更の契約は維持する。
- 既存のroleフィルター、user_id ASC、UUIDカーソル、limit既定25・最大100を維持する。不正パラメーターは400。
- admin / member / viewerは同じworkspaceの件数を閲覧できる。通常JWTとSECURITY INVOKERでRLS・SELECT権限を維持し、匿名・無所属・他workspaceは拒否する。service_roleは使わない。
- 件数の対象を画面に説明し、360pxで横溢れしない。既存のロール変更・所属解除を妨げない。

## API・DB

`read_members(p_workspace_id,p_role,p_cursor,p_limit)` RPCを追記する。応答は既存の `{data,nextCursor}` に一覧の件数を追加。業務テーブル・カラム・ER・書込権限・監査トリガーは変更しない。authenticatedだけに実行を許可する。

## 検証

DBテストで状態・プロジェクト状態・未割当・他workspace・全閲覧ロール・0件・1,000件超・ページングを確認する。認証E2EでAPI件数、フィルター、ページ送り、360pxの表示と既存の所属管理を確認する。

## 対象外

完了済みの累計、グラフ、作業時間、プロフィール編集、メール招待、固定プレビューの動的集計。

## 実装・検証記録（2026-11-03、Issue #32）

lint / typecheck / build成功。担当件数DBテスト1件成功（1,003タスク・1,002課題、状態・アーカイブ・所属・権限・ページング・SELECT権限維持）。既存の所属管理DBテスト1件成功。members認証E2E3件成功（既存のロール変更・競合・最後の管理者・ページング・API権限に加え、担当件数の全ロール表示と360px）。本番DB適用・デプロイは未実施。
