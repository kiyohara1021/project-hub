# 課題コメント

## 目的・範囲

課題の説明とは別に、調査経緯や対応内容をコメントとして残す。課題一覧の「コメント」からダイアログを開き、読取・投稿・編集・削除を行う。通知、添付、返信ツリー、Markdown、プレビュー表示への追加は対象外。

## 受け入れ条件

- 所属者は所属ワークスペースの課題コメントを閲覧できる。最新順（created_at DESC,id DESC）、初期25・上限100、複合カーソルでページ送りする。画面は「さらに読み込む」で追加する。
- admin/memberは投稿可能。編集・削除は現在のadmin、または現在memberかつ投稿者本人のみ。viewerは自分の過去投稿も閲覧のみ。所属解除後は閲覧・変更不可。
- アーカイブ済みプロジェクトは全ロール閲覧のみ。解決済み・終了した課題にもコメントできる。課題・プロジェクト・workspaceの対応をAPIとDBで検証する。
- 本文は前後の空白を除いて1〜5,000文字、プレーンテキスト。改行は保持し、HTMLとして解釈しない。NUL文字は保存できない入力として400で拒否する。投稿者ID・表示名・所属先・日時・versionの初期値をクライアントから指定させない。更新・削除時は取得済みversionだけを競合検査用に送る。
- 投稿者名は投稿時の表示名を保存し、所属解除・改名後も保持。編集時も投稿者と作成日時を維持し、更新日時・versionを更新して「編集済み」と表示する。
- 投稿はIdempotency-Key必須、workspace/project/issue/actor/keyで24時間分離。同じ本文の再送は元の受付結果、本文違い409。再送でも現在の権限・親課題・アーカイブを確認する。削除後の再送で復活させない。
- PATCH/DELETEはversion必須、競合409で入力を保持し明示的な最新版取得を案内する。削除は確認後に実行。送信中の二重操作・ダイアログ終了を防ぐ。
- 読取失敗の再試行、空表示、入力エラー、通信失敗時の再送、360px、キーボード・Escape・フォーカス復帰を確認する。投稿・変更後は最初のページを再取得する。失敗時は表示済みのコメントや未送信本文を消さない。
- 投稿・編集・削除の履歴をissue_commentsとして既存監査へ追加し、本文・投稿者名の詳細をchangesへ含めない。操作履歴とダッシュボードで日本語の対象名を表示する。
- 課題の削除時はコメントも削除し、監査記録は保持。再送記録は課題の削除で消さず、再送の24時間経過後に同workspace/actorの次のコメント投稿時に削除する。通常APIでの直接テーブル書込は拒否する。

## API

接頭辞 `/api/v1/workspaces/:wid/projects/:pid/issues/:iid`。

| メソッド・パス        | 入力                       | 応答                               |
| --------------------- | -------------------------- | ---------------------------------- |
| GET /comments         | limit/cursorのみ           | 200 `{data:Comment[],nextCursor}`  |
| POST /comments        | `{body}` とIdempotency-Key | 201 `{data:Comment}`               |
| GET /comments/:cid    | なし                       | 200 `{data:Comment}`（競合復旧用） |
| PATCH /comments/:cid  | `{body,version}`           | 200 `{data:Comment}`               |
| DELETE /comments/:cid | `{version}`                | 204                                |

Commentはid/workspace_id/project_id/issue_id/author_id/author_display_name/body/version/created_at/updated_at。エラーは既存形式。未認証401、ロール不足403、無所属/親子不一致/不存在404、入力不正400、競合/アーカイブ409。Origin・JSON32KiB・未知/欠落キー・UUID・日付カーソルを検査。応答はprivate,no-store、通常JWTでRLSを適用。

## DB契約

追記migration009。public.issue_commentsに親課題との複合FK・RLS・一覧索引、private.comment_requestsに非公開再送記録を追加。作成/編集/削除RPCは `create_comment_once(p_workspace_id,p_project_id,p_issue_id,p_body,p_key)`、`edit_comment(p_workspace_id,p_project_id,p_issue_id,p_comment_id,p_body,p_version)`、`delete_comment(p_workspace_id,p_project_id,p_issue_id,p_comment_id,p_version)`。既存workspace→projectロック順とprivate.assert_task_writerを共用し、親課題→コメントの順にロック。auth.uid()で投稿者/権限を確定、専用所有者・固定search_path・authenticatedだけEXECUTE。

## 検証

DBで全ロール・自己/他者・所属解除/降格・別workspace/issue・直接書込/匿名拒否・5000文字境界・同時再送・同時version・アーカイブ・削除cascade・履歴保持/本文非記録・投稿者スナップショットを確認。認証E2EでAPI契約と入力拒否、画面投稿/編集/確認削除、viewerとアーカイブ、競合復旧、ページ送り、XSS文字列、360px、通信再試行を確認する。既存課題・操作履歴の回帰も実施。

## ローカル検証記録（2026-11-03 / Issue #41）

lint・typecheck・build・環境設定テスト4件、全DBテスト11件、全認証E2E32件が成功。本文境界・投稿者/ロール/所属・親子関係・再送・競合・監査・cascadeと、360px/プレーンテキスト/失敗復旧を確認した。本番での検証とは区別する。
