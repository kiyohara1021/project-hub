# データモデル

PostgreSQLのテーブル・制約・集計の関係をまとめています。IDはUUID、日時は `timestamptz`、期限は `date` です。変更履歴は[マイグレーション](../../supabase/migrations/)、アクセス制御は[APIとアクセス制御](api-rls.md)を参照してください。

## 業務データの関係

```mermaid
erDiagram
 AUTH_USERS ||--|| PROFILES : has
 WORKSPACES ||--o{ MEMBERSHIPS : includes
 PROFILES ||--o{ MEMBERSHIPS : joins
 WORKSPACES ||--o{ PROJECTS : owns
 PROJECTS ||--o{ TASKS : contains
 PROJECTS ||--o{ ISSUES : tracks
 MEMBERSHIPS o|--o{ TASKS : assigned
 MEMBERSHIPS o|--o{ ISSUES : assigned
 WORKSPACES ||--o{ ACTIVITY_LOGS : records
```

タスク・課題の担当は任意です。操作履歴のproject_id・actor_id・entity_idは識別情報として保持し、現在の対象行への外部キーを設定しません。対象の削除や所属解除後も履歴を読めるようにするためです。

## publicテーブル

すべての業務テーブルにRLSを適用します。本文の長さ、状態、優先度、versionの正数制約はDBでも検査します。

| テーブル | 主な列・制約 | 役割 |
|---|---|---|
| profiles | `id` PK・FK auth.users.id、`display_name` 1〜80文字 | Authユーザーに対応する表示名。Auth登録時に作成 |
| workspaces | `id` PK、`name` 1〜120文字、`created_at` | データと権限の分離単位 |
| memberships | `workspace_id, user_id` 複合PK、各workspace / profile FK、`role, joined_at, version` | ユーザーの所属とadmin / member / viewerの権限 |
| projects | `id` PK、`workspace_id` FK、`name, description, status, due_date, version, created_at, updated_at`、UNIQUE(workspace_id,id) | プロジェクト情報。削除の代わりにアーカイブを使用 |
| tasks | `id` PK、`workspace_id, project_id, title, description, status, priority, assignee_id, due_date, position, version, created_at, updated_at` | カンバンのタスク。positionはbigint |
| issues | `id` PK、`workspace_id, project_id, title, description, status, priority, assignee_id, due_date, version, created_at, updated_at` | 課題情報 |
| activity_logs | `id` PK、`workspace_id` FK、`project_id, actor_id` nullable、`actor_display_name, entity_type, entity_id, action, changes, created_at` | 読み取り専用の操作履歴。changesはjsonb |

| 項目 | 許可値・ルール |
|---|---|
| projects.status | planned / active / archived |
| tasks.status | todo / doing / review / done |
| issues.status | open / investigating / resolved / closed |
| tasks / issues.priority | low / medium / high |
| assignee_id / due_date | 未割当・未設定はNULL |
| name / title | 前後の空白を除いて1〜120文字 |
| description | 0〜5,000文字 |
| version | 初期1、1以上の整数。更新時に増加し、競合検出に使用 |
| activity_logs.action | INSERT / UPDATE / DELETE |

### ワークスペースの整合性

tasks / issuesの `(workspace_id, project_id)` はprojectsの `(workspace_id, id)`、`(workspace_id, assignee_id)` はmembershipsの `(workspace_id, user_id)` を参照します。別ワークスペースのプロジェクトや担当者を指定する操作は、APIに加えてDB制約でも拒否します。

通常の更新APIはworkspace_id・project_idを入力として受け付けません。所属解除RPCはタスク・課題の担当を未割当にしてversionを更新した後、所属を削除します。ユーザー削除・ワークスペース削除の画面/APIは提供していません。外部キーの削除動作は原則NO ACTION / RESTRICTで、自動的に業務データを連鎖削除しません。

### 操作履歴

プロジェクト・タスク・課題・所属の変更時にDBトリガーが記録を追加します。操作者は `auth.uid()` から取得し、表示名は `actor_display_name` にスナップショットを保存します。未認証の管理用初期設定は、初期データの操作者名として記録されます。

changesには変更前後のstatus・role・versionを保存し、本文や資格情報は含めません。更新と監査記録は同じトランザクションで確定します。履歴から現在の対象へ移動する場合、対象がすでに削除されていれば404になります。

## 再送記録のprivateテーブル

作成APIの再送でデータが重複しないように、入力と初回の成功応答を24時間保持します。これらのテーブルはAPI非公開で、RLS有効・通常ロールの直接権限なしです。

| テーブル | 複合主キー | 保存内容・参照 |
|---|---|---|
| private.project_requests | `workspace_id, actor_id, request_key` | workspace / profile FK、`payload, result, expires_at` |
| private.task_requests | `workspace_id, project_id, actor_id, request_key` | project複合FK / profile FK、`payload, result, expires_at` |
| private.issue_requests | `workspace_id, project_id, actor_id, request_key` | project複合FK / profile FK、`payload, result, expires_at` |
| private.member_requests | `workspace_id, actor_id, request_key` | workspace / profile FK、`payload, response, expires_at` |

payloadとresult / responseはjsonbです。監査ログと異なり、再送に必要な作成入力と受付結果を保管します。所属追加の記録にはユーザーID・ロール・初回所属情報を保存します。パスワードやトークンは保存しません。

同じキーで本文が変わった場合は409です。作成後に対象が変更・削除されても、再送による復元や上書きは行いません。期限切れ記録は、同じワークスペース・操作者の次の作成要求で削除します。テスト用ワークスペースを後片付けする場合は、参照する再送記録を先に削除します。詳細は[APIの再送ルール](api-rls.md#更新競合と再送)を参照してください。

## 集計と主要インデックス

`read_dashboard` と `read_members` は既存テーブルを読むSECURITY INVOKERのRPCです。集計用テーブルや公開ビューを追加せず、呼出者のSELECT権限とRLSを維持します。

- ダッシュボードはアーカイブを除外して全件集計します。完了率は完了タスク数÷全タスク数、0件は0%です。期限超過の基準日は `private.dashboard_day` でAsia/Tokyoへ変換します。
- メンバー担当数はplanned / active内の未完了タスク・未解決課題を全件集計します。メンバー一覧のページサイズとは独立しており、取得上限による件数の欠落を防ぎます。
- previewモードは固定サンプル値を表示します。connectedモードの値はDBから取得・集計します。

| 用途 | インデックスの主な列 |
|---|---|
| ユーザーの所属先 | memberships(user_id, workspace_id) |
| プロジェクト一覧 | projects(workspace_id, created_at DESC, id DESC) |
| カンバン | tasks(workspace_id, project_id, status, position, id) |
| 課題の状態別取得 | issues(workspace_id, project_id, status, id) |
| 課題のページ送り | issues(workspace_id, project_id, created_at DESC, id DESC) |
| 担当別集計 | tasks / issues(workspace_id, assignee_id) |
| 操作履歴 | activity_logs(workspace_id, created_at DESC, id DESC) |

サンプルデータと検証用アカウントの扱いは[開発ルール](../../CONTRIBUTING.md)にまとめています。
