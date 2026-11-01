# P2-1: 認証・DB・ワークスペース分離

関連: [Issue #3](https://github.com/kiyohara1021/project-hub/issues/3)。基本設計/API・RLS設計の最初の実装単位。

## 受け入れ条件

- AC1: ローカルSupabaseに7テーブルと制約を再作成できる。架空ユーザー5名を投入する。
- AC2: 全テーブルはRLSで所属workspaceに隔離され、anonと無所属ユーザーに業務データを返さない。プロフィールは自分と共通workspaceの所属者だけ。
- AC3: 認証済みユーザーはworkspaceを作成してadminになる。project作成/更新、所属ロール変更/解除はadminのみ。最後のadmin解除とversion競合を拒否し、履歴を同時記録する。
- AC4: authenticatedの直接テーブル書込と履歴偽造を拒否する。タスク・課題はP3/P4のRPC完成まで読み取り専用。
- AC5: 明示的に `APP_MODE=connected` を設定した場合だけDB接続画面 `/workspaces` を有効にする。未認証ならログインへ。ログイン/ログアウトは同一OriginのPOSTだけを受け付ける。
- AC6: `GET /api/v1/workspaces/:wid/projects` は検証済みユーザーJWTでDBへ接続する。401/404、UUID・limit不正、一覧のページ送りに対応。service_roleはアプリに配置しない。
- AC7: 架空のadmin/member/viewer、別workspace、無所属の実JWTで許可/拒否を検証し、認証画面のE2Eと既存プレビューのCIを通す。

## 実装範囲と差分

既存6画面は固定プレビューのまま。DB接続確認は別画面 `/workspaces` に集約する。通常モードはpreview、connectedモードで設定が不足した場合はプレビューにフォールバックせず利用不可にする。公開を想定したクラウド設定・全画面のDB化・タスク/課題RPC・所属追加・プロフィール変更・HTTP書込APIとIdempotency-Keyは後続Issue。今回のプロジェクト変更RPCはDB契約の検証用で、UIの変更操作は提供しない。

ローカル構築スクリプトはSupabase CLIのローカルstatusだけを使い、接続先が127.0.0.1でなければ拒否する。デモ認証情報はローカル専用。メール送信・一般登録は無効。

## 検証

P2-1の一覧APIはlimit/cursorのみを受け付け、id昇順のカーソルを採用する。基本設計のcreated_at複合ソートとq/statusはP3で追加する。ログイン/ログアウトのOrigin検証は明示設定したAPP_ORIGINに対して行い、Hostや転送ヘッダーを信頼しない。

実際のAuth/APIを使うNodeテストでRLS・RPC・履歴・制約・同時管理者変更を確認。Playwrightでログイン失敗/成功、DB一覧、ログアウト、外部Origin拒否を確認。CIもローカルSupabaseを起動して実行する。
