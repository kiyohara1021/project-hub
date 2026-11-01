# P3-1: タスクCRUDとカンバン

関連: [Issue #7](https://github.com/kiyohara1021/project-hub/issues/7)

## 受け入れ条件

- AC1: 接続モードでDBプロジェクトからカンバンへ移動できる。選択workspaceをURLに保持し、別workspace/プロジェクトのID指定は404。previewモードは従来の固定画面を維持。
- AC2: admin/memberはタスクを作成・編集・削除・移動でき、viewerは閲覧のみ。アーカイブ内は全員読み取り専用。APIとDB RPCの両方で検査する。
- AC3: タイトル1〜120字、本文0〜5,000字、優先度low/medium/high、担当は同workspace所属者または未割当、期限は実在する日付または未設定。作成時はtodo列末尾。編集は状態を変えず、状態移動は専用操作で行う。
- AC4: 作成は必須Idempotency-Keyで24時間の再送・同時再送を重複排除。編集/削除/移動はversion必須。所属解除・アーカイブ・並替の競合をworkspace/project行ロックで直列化し、変更と履歴を同時確定する。
- AC5: PCはドラッグで別列末尾/カードの前へ移動可能。状態メニューと「上へ」で同じ操作をキーボード/モバイルから利用可能。失敗時は配置を戻し、409時は再読込を案内。フィルター中/追加読込途中の順序でもDBの全列に対して移動する。
- AC6: 各列25件ずつ取得、追加読込で続きへ進む。担当/優先度フィルターはURLに保持。360pxでは状態を選んで1列表示する。削除は明示確認、失敗時の入力を保持し、409は入力を破棄する明示操作で最新版を取得する。
- AC7: DB/API/ブラウザで権限、別workspace/プロジェクト、担当すり替え、アーカイブ拒否、同時再送、version、並替、削除履歴、ページ送り、失敗復旧を検証しCI成功。

## API契約

接頭辞 `/api/v1/workspaces/:wid/projects/:pid/tasks`。

| メソッド | 用途・本文 |
|---|---|
| GET / | status（既定todo）/assignee/priority/limit/cursor。position ASC,id ASC |
| POST / | title,description,priority,assignee_id,due_date。Idempotency-Key必須 |
| GET /:tid | 単一タスク |
| PATCH /:tid | 作成と同じ5項目 + version |
| DELETE /:tid | version、成功204 |
| POST /:tid/move | status,before_id（nullは末尾）,version。versionで重複移動を防止 |

JSON上限32KiB、全項目必須・不明キー拒否。Origin/JWT/所属/ロールを検査。401未認証、403権限、404無所属/不存在、400入力、409競合/アーカイブ。assigneeはuuidまたはunassigned、cursorはAPI発行の不透明値。作成の再送記録は同workspace/actorの次回作成時に期限切れを削除する。

## 範囲・判断

楽観的移動後にサーバーから列を再取得する。操作中は追加の変更を無効にする。並替は対象列のpositionを1024刻みに再採番し、位置の変わった行のversionも更新する。リストはライブスナップショットでなく、他ユーザーの並替後は再読込が必要。課題・ダッシュボード・操作履歴画面のDB化、外部通知、添付、リアルタイム同期、デプロイは対象外。
