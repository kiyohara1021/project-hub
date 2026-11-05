# 実装状況の確認と改善候補

確認日: 2026-11-03。対象は `main` の96fb7d7時点の実装と文書です。確認結果と、起票したIssueをまとめます。現在の対応範囲は[対応状況](roadmap.md)を参照してください。

## 確認方法と結果

| 項目                               | 結果                 | 備考                                                                                            |
| ---------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------- |
| `pnpm lint`                        | 成功                 | 警告なし                                                                                        |
| `pnpm typecheck`                   | 成功                 |                                                                                                 |
| `pnpm build`（`APP_MODE=preview`） | 成功                 |                                                                                                 |
| `pnpm test:release`                | 成功（4件）          | 公開設定の検査                                                                                  |
| `pnpm test:e2e`                    | 成功（7件、1件skip） | 画面デモ。desktop・360px幅                                                                      |
| `pnpm test:db` / `pnpm test:auth`  | 未実施               | 確認環境にDockerがなく、ローカルSupabaseを起動できないため。CIの`database-auth`ジョブで確認する |

仕様書（[基本仕様](specification.md)、[API・認可設計](architecture/api-rls.md)、[データモデル](architecture/data-model.md)）と実装を照合し、エンドポイント・入力検証・ページ送り・権限・再送制御の記載が実装と一致することを確認しました。通常ユーザーが利用する更新RPCは`search_path`を空に固定し、実行権限をauthenticatedに限定しています。内部トリガー関数などは、この利用者向けRPCとは区別します。

## 確認時に起票したIssue

確認時に見つけた不具合・改善はIssueに起票し、個別のPRで対応しています。マージ状況は各Issue・PRを参照してください。

| Issue                                                        | 区分   | 内容                                                                                                                                  |
| ------------------------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| [#51](https://github.com/kiyohara1021/project-hub/issues/51) | 不具合 | ログイン状況画面でプロジェクトの状態が英語の内部値（`active`など）で表示される。接続モードのカンバンでメニューのリンク末尾に`?`が付く |
| [#52](https://github.com/kiyohara1021/project-hub/issues/52) | 改善   | 所属追加に必要な自分のユーザーIDを確認する手段がない。ログイン状況画面に本人のIDを表示する                                            |
| [#53](https://github.com/kiyohara1021/project-hub/issues/53) | 運用   | エラー応答の`requestId`が記録されず、原因を追えない。5xxではrequestId・コード・原因をサーバーログへJSONで出力する                     |
| [#54](https://github.com/kiyohara1021/project-hub/issues/54) | 保守性 | `Idempotency-Key`検査、204応答、`created_at`/`id`カーソルの重複を共通関数へまとめる。挙動は変えない                                   |
| [#62](https://github.com/kiyohara1021/project-hub/issues/62) | 文書   | 本書の作成                                                                                                                            |

## 改善候補の対応状況

各候補はIssueに起票済みです。着手するときは[開発ルール](../CONTRIBUTING.md)に沿って、仕様と受け入れ条件をIssueまたは`docs/specs/`に書いてから実装してください。

| 優先度 | Issue                                                        | 項目                             | 対応状況・決める必要があること                                                 |
| ------ | ------------------------------------------------------------ | -------------------------------- | ------------------------------------------------------------------------------ |
| 高     | [#55](https://github.com/kiyohara1021/project-hub/issues/55) | コード整形の統一とCIでの検査     | 2026-11-05対応。Prettier・整形コマンド・CI検査を追加し、整形を別コミットに分離 |
| 高     | [#57](https://github.com/kiyohara1021/project-hub/issues/57) | ログイン試行の制限方針           | Supabase Authの設定値と、アプリ側で制限するかを決める                          |
| 中     | [#58](https://github.com/kiyohara1021/project-hub/issues/58) | Content-Security-Policyの追加    | 仕様を追加し、Report-Onlyで確認してから強制する                                |
| 中     | [#59](https://github.com/kiyohara1021/project-hub/issues/59) | 再送記録の期限切れ行の定期削除   | 削除方式（pg_cronなど）を決める                                                |
| 中     | [#60](https://github.com/kiyohara1021/project-hub/issues/60) | 操作履歴の保持期間               | 保持期間と期限後の扱いを決める                                                 |
| 中     | [#56](https://github.com/kiyohara1021/project-hub/issues/56) | 入力検証関数の配置と命名の整理   | 2026-11-05対応。validation.tsへ移し、コメント・表示名変更も含めて参照を更新    |
| 低     | [#61](https://github.com/kiyohara1021/project-hub/issues/61) | ログイン状況画面の取得件数の上限 | 2026-11-05対応。所属先ごとに最新5件を取得し、一覧へ案内                        |

確認時点で既に起票されていたIssue（[#41](https://github.com/kiyohara1021/project-hub/issues/41) 課題コメント、[#43](https://github.com/kiyohara1021/project-hub/issues/43) タスク移動、[#44](https://github.com/kiyohara1021/project-hub/issues/44) 表示名、[#45](https://github.com/kiyohara1021/project-hub/issues/45) `shadcn`の依存区分、[#46](https://github.com/kiyohara1021/project-hub/issues/46) ライセンス）は、PR #42 に含まれ、2026-11-04にマージ済みです。本書の2026-11-03時点の確認対象とは区別します。

## 検証の注意

ローカルでPlaywrightのバージョンとインストール済みブラウザが一致しない場合、`pnpm test:e2e`はブラウザ起動前に失敗します。`pnpm exec playwright install chromium`でブラウザを入れ直してください。

## 追加確認（2026-11-04）

PR #42 の統合後は、DBテスト13件・認証E2E34件とCIが成功しています。上表の「Dockerなしで未実施」は、2026-11-03の確認環境についての記録です。本番DBはmigration011まで適用し、コメントのRLS・更新RPCの所有者、固定search_path、実行権限を読戻し確認しました。アプリの本番確認範囲は[運用手順](deployment.md)に記録します。

Codex Security CLIはコミット`b56728d`の170ファイルをレビュー後、候補検証中に利用上限で停止しました。スキャンは未完了であり、脆弱性がないことを示す結果ではありません。#43〜#46の追加変更はこのスキャンの対象外です。
