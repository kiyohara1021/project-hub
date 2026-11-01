# P4-3 操作履歴一覧（Issue #15）

## 目的・範囲

6画面の最後に残った操作履歴をDB接続する。所属workspaceの記録を読み取り専用で確認し、操作・対象・操作者を絞り込める。架空データのみを用い、招待・通知・エクスポート・履歴の編集削除・改ざん証明は対象外。

## 受け入れ条件

- `/activity?workspace=UUID`。未指定は最初の所属先。未認証はログインへ、無所属は空状態、別workspaceは404。
- admin/member/viewerとも所属先の履歴を閲覧できる。API・UIに変更操作は提供しない。DBの直接INSERT/UPDATE/DELETEも従来どおり拒否。
- created_at DESC,id DESC、limit既定25・最大100。複合カーソルで同一日時の記録も重複・欠落なく順に取得する。読取中に新規追加された記録は最初のページを再取得して確認する。
- 対象種別（projects/tasks/issues/memberships）、操作（INSERT/UPDATE/DELETE）を選択。各履歴のリンクからproject/actorで絞り込む。通常の条件変更・ページ送りは現在の絞り込みを維持し、所属先切替とリセットは条件を解除する。
- 解除済み操作者もactor_idで検索できる。現在のprofilesに結合せず、actor_display_nameの操作当時の値を表示する。actor_idがnullの初期データも一覧へ含め、操作者リンクは表示しない。
- 日時は日本時間。対象種別・操作・状態/ロール変更を日本語表示。本文、名称、担当の詳細値は元の監査対象外であり推測表示しない。変更値はstatus/role/versionを許可値で再抽出してAPI応答に含める。
- 削除済み/アーカイブの対象もログを保持。現在のプロジェクトへのリンクは存在しない場合404となり得る。識別用IDは折りたたんで確認できる。
- 未認証401、無所属404、クエリー不正400、取得失敗500。未知/重複キー、無効enum/UUID/limit/cursorを拒否。異なるworkspaceのproject/actor条件は情報を照合せず空一覧を返す。
- 空状態、条件不正からのリセット、読取失敗からの再試行、360pxでの横溢れなしを確認。
- ダッシュボードとサイドバーから所属先を維持して履歴に移動する。

## API・DB

`GET /api/v1/workspaces/:wid/activity` → `{data: Activity[],nextCursor: string|null}`。
条件は`action/entity/project/actor/limit/cursor`。project/actorはUUID、cursorはcreated_atとidを含むbase64url。応答はprivate,no-store、通常のユーザーJWTでRLSを適用しservice_roleを使わない。書込メソッドは405。

既存activity_logsと複合インデックスactivity_list_idxを利用。新テーブル・列・関数・マイグレーション追加は不要。権限制御と監査トリガーの変更なし。現在の名称を引いて操作当時の名称として表示しない。

## 検証

DBテストで削除後の保持、操作時の操作者名、所属解除後の権限喪失、失敗した変更が履歴を追加しないこと、直接改ざん拒否を確認。E2Eで実際の作成/状態移動/削除/アーカイブからの記録表示、同時刻カーソル、各絞り込みと解除、非公開値の除外、認証境界、障害復旧とモバイル導線を確認する。
