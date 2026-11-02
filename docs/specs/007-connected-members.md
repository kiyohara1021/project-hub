# P4-2 メンバー管理（Issue #13）

## 目的と対象

所属ワークスペースの一覧をDB接続し、管理者が確認画面を経てロール変更・所属解除できる。架空データだけを用いる。招待、ユーザー検索・登録、メール送信、プロフィール編集、担当件数の集計は本段階の対象外（後続の[仕様013](013-member-assignment-counts.md)で追加）。

## 受け入れ条件

- `/members?workspace=UUID`。未指定は最初の所属先、未所属は空表示、他スペースは404、未認証はログインへ移動する。
- 表示名・ロール・参加日（日本時間）・自分の表示。メールや全ユーザー一覧は取得しない。
- admin/member/viewer全員が所属一覧を閲覧。adminだけが変更可能。
- ロール絞り込みとuser_id昇順のカーソルページ送り。limitは既定25、最大100。未知・重複条件、無効UUIDを400で拒否。
- PATCH/DELETEはOrigin・JSON・32KiB制限・UUID・version検証。更新・所属解除は確認後に実行し、通信中は連打を防ぐ。
- version不一致は409。入力は保持し、明示的な最新版取得で変更を破棄する。通信結果不明時も再取得を案内。
- 最後のadminは降格・所属解除不可（409 LAST_ADMIN）。自分の変更は権限喪失の可能性を表示する。
- 所属解除時はアーカイブを含む同スペースのタスク・課題の担当をnullにし、versionを増加。所属解除と担当解除・監査履歴は同一トランザクション。
- workspace行ロックで他の所属変更・タスク/課題更新と直列化。RLSとDB内のadmin検査を併用する。
- モバイル360pxで横溢れなく確認・変更でき、一般メンバーには管理ボタンを出さない。

## APIとDB

`GET /api/v1/workspaces/:wid/members` → `{data: Member[],nextCursor: UUID|null}`。条件: role、cursor、limit。
`GET /api/v1/workspaces/:wid/members/:uid` → `{data: Member}`。
`PATCH`同パス → `{role,version}`、`DELETE` → `{version}`、成功204。キーは全て必須、未知キー拒否。

memberships.versionを追加し、全UPDATEでトリガーが増加。専用`change_member` RPCはversionと権限を検証して既存set_member_role/remove_memberを呼ぶ。既存RPCは互換性のため保持し、最後のadmin保護・監査・担当解除を共有する。直接テーブル更新は引き続き禁止。

## 検証

DBで権限・同時更新・最後のadmin・担当解除・監査を確認。E2Eでモバイル変更・確認・競合からの復旧・ページ送り・絞り込み・API拒否・未認証を確認する。
