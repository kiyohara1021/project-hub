# ER図・データ辞書

P2-1でSQLマイグレーションを作成。IDはuuid、日時はtimestamptz。操作APIの提供範囲は[認証・DB基盤仕様](../specs/002-auth-database.md)を参照。

```mermaid
erDiagram
 AUTH_USERS ||--|| PROFILES : has
 WORKSPACES ||--o{ MEMBERSHIPS : includes
 PROFILES ||--o{ MEMBERSHIPS : joins
 WORKSPACES ||--o{ PROJECTS : owns
 PROJECTS ||--o{ TASKS : contains
 PROJECTS ||--o{ ISSUES : tracks
 MEMBERSHIPS ||--o{ TASKS : assigned
 MEMBERSHIPS ||--o{ ISSUES : assigned
 WORKSPACES ||--o{ ACTIVITY_LOGS : records
 WORKSPACES ||--o{ PROJECT_REQUESTS : deduplicates
 PROFILES ||--o{ PROJECT_REQUESTS : requests
 PROJECTS ||--o{ TASK_REQUESTS : deduplicates
 PROFILES ||--o{ TASK_REQUESTS : requests
 PROJECTS ||--o{ ISSUE_REQUESTS : deduplicates
 PROFILES ||--o{ ISSUE_REQUESTS : requests
```

| テーブル | 列・制約 |
|---|---|
| profiles | id PK/FK auth.users.id、display_name（架空名） |
| workspaces | id PK、name、created_at |
| memberships | workspace_id + user_id 複合PK、user_id FK profiles、role(admin/member/viewer)、joined_at、version |
| projects | id PK、workspace_id FK、name、description、status、due_date、version、created_at、updated_at、UNIQUE(workspace_id,id) |
| tasks | id PK、workspace_id、project_id、title、description、status、priority、assignee_id nullable、due_date、position bigint、version、created_at、updated_at |
| issues | id PK、workspace_id、project_id、title、description、status、priority、assignee_id nullable、due_date、version、created_at、updated_at |
| activity_logs | id PK、workspace_id FK、project_id nullable、actor_id nullable、actor_display_name、entity_type、entity_id、action、changes jsonb、created_at |
| private.project_requests | workspace_id + actor_id + request_key 複合PK、workspace/profile FK、payload/result jsonb、expires_at。API非公開、直接アクセス不可。作成の同時再送を防ぐ |
| private.task_requests | workspace_id + project_id + actor_id + request_key 複合PK、project複合FK/profile FK、payload/result jsonb、expires_at。API非公開。タスク作成の同時再送を防ぐ |
| private.issue_requests | workspace_id + project_id + actor_id + request_key 複合PK、project複合FK/profile FK、payload/result jsonb、expires_at。API非公開。課題作成の同時再送を防ぐ |

tasks/issuesの(workspace_id,project_id)はprojects(workspace_id,id)を参照し、(workspace_id,assignee_id)はmemberships(workspace_id,user_id)を参照する。別スペースへの担当すり替えをDB制約でも拒否。所属解除RPCは担当解除後に所属を削除する。ユーザー削除も同じ順序で行う。workspace削除は初期対象外。

タイトル長・状態・優先度・version>=1をCHECKで制約。workspace_id/project_idは更新不可。FKは原則RESTRICT。タスク・課題の削除後も履歴を保持するため履歴entity_idにFKを張らない。

索引: memberships(user_id,workspace_id)、projects(workspace_id,status,id)、tasks(workspace_id,project_id,status,position,id)、issues(workspace_id,project_id,status,id)、activity_logs(workspace_id,created_at DESC,id DESC)、tasks/issues(workspace_id,assignee_id)。

サンプルは「デモスペース」「架空プロジェクトA〜C」「デモメンバー01〜05」。データはすべて架空で、previewの数値は固定、connectedの数値はDBから計算する。

接続モードのダッシュボードはread_dashboard RPCでRLS付きの集計を行い、集計テーブルや公開ビューは追加しない。日付はprivate.dashboard_dayでAsia/Tokyoへ変換。previewモードだけが固定値を使用する。

課題のページ送り用にissues(workspace_id,project_id,created_at DESC,id DESC)の索引を追加。課題削除後もactivity_logsと再送結果は保持し、同じキーの再送で課題を復活させない。

P4-2: membershipsにversion（integer、初期1）を追加。更新トリガーが既存RPCを含む全UPDATEで増加し、`change_member` RPCが期待versionを検査する。新規エンティティ・リレーションの変更はなし。

P4-3: 操作履歴一覧は既存activity_logsとactivity_list_idx(workspace_id,created_at DESC,id DESC)を使用。ER・列の追加なし。actor_id/project_id/entity_idは履歴の識別用に保持し、現在の行との存在確認・結合を必須にしない。表示名はactor_display_nameスナップショットを参照。

メンバー担当数はread_members RPCで既存のmemberships・profiles・projects・tasks・issuesを読み取る。集計テーブル・列・ER・トリガーの変更はない。既存tasks/issues(workspace_id,assignee_id)索引を使用する。
