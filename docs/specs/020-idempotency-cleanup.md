# 再送記録の定期削除

Issue: #59。2026-11-06。

## 目的と対象

作成APIを再び利用しない操作者の期限切れ記録も削除し、再送記録の増加を抑える。`private.project_requests`、`task_requests`、`issue_requests`、`member_requests`、`comment_requests`の5種類が対象。24時間の再送契約と、同じワークスペース・操作者の次回作成時に削除する既存処理は維持する。操作履歴、対象データ、期限内の再送記録は削除しない。

## DB契約

追記migration012で、各表に`expires_at`と`(workspace_id,actor_id,expires_at)`の索引を追加する。前者は定期削除、後者は既存の作成API内の削除に使用する。

`private.purge_expired_requests(p_limit integer default 1000)`は、呼び出し開始時の`statement_timestamp()`以下が期限の行だけを削除する。上限は各表につき1〜10,000件（既定1,000件、5表合計最大5,000件）。期限順に行を選び、`FOR UPDATE SKIP LOCKED`で他の処理が使用中の行を飛ばす。残った期限切れ記録は次回に処理する。単一のトランザクションで実行し、失敗時はその呼び出しの削除を取り消す。

関数は`project_hub_owner`所有、SECURITY DEFINER、空の`search_path`、ロック待ちは1秒。一般ロール（PUBLIC/anon/authenticated/service_role）からの実行を拒否し、管理者postgresにのみ実行を許可する。ワークスペース管理者にも提供せず、公開RPC・アプリ用管理鍵は追加しない。同時実行はトランザクション単位のアドバイザリロックで抑制し、先行処理があれば`skipped: true`を返す。

## スケジュール

Hosted Supabaseの`pg_cron`を使用する。拡張が有効、またはインストール可能かつ`shared_preload_libraries`に登録されている環境では、migrationで拡張を有効化して次の2ジョブを登録する。

| ジョブ名                       | UTCのスケジュール                        | 処理                                                          |
| ------------------------------ | ---------------------------------------- | ------------------------------------------------------------- |
| `project-hub-expired-requests` | `17 * * * *`（毎時17分）                 | 各表最大1,000件の期限切れ再送記録を削除                       |
| `project-hub-cron-history`     | `47 2 * * *`（毎日02:47 UTC、11:47 JST） | この2ジョブの終了済み実行記録だけ7日保持、1回最大10,000件削除 |

cron時刻は既定のGMT/UTCを前提とします。運用時に`current_setting('cron.timezone',true)`を照合し、異なる設定の場合は実際のタイムゾーンと実行時刻を運用記録へ明記します。ほかのジョブへ影響するグローバル設定は自動で変更しません。

ジョブのコマンドは`statement_timeout=30s`、`lock_timeout=1s`を設定してから実行する。cron履歴の終了日時がNULLの記録、他のジョブの履歴は触らない。同じ名前・同じ所有者の再登録は既存ジョブの更新となる。別の所有者の同名ジョブがあれば、自動で削除せず適用を失敗させる。

拡張が利用できない環境では関数と索引だけを導入し、NOTICEでジョブが未登録であることを明示する。これは定期実行を確認した状態ではない。本番では`pg_cron`を有効にし、下記の登録SQLをpostgresで実行してから稼働を確認する。利用できない場合の代替は、DB管理者が信頼できる定期実行環境から同じ管理関数を毎時実行する方式とする。管理者用接続情報をアプリ・リポジトリへ保存しない。代替も実行履歴を7日保持し、成功の監視が必要。

## 管理者の登録・確認

migrationの末尾にある登録ブロックは再実行可能。拡張を後から有効にした場合も、そのブロックを原文のままpostgresで実行する。

```sql
-- 権限・定義・索引の確認
select pg_get_userbyid(proowner) as owner, prosecdef, proconfig,
       has_function_privilege('anon', oid, 'execute') as anon_execute,
       has_function_privilege('authenticated', oid, 'execute') as authenticated_execute,
       has_function_privilege('service_role', oid, 'execute') as service_role_execute
from pg_proc where oid='private.purge_expired_requests(integer)'::regprocedure;
select indexname,indexdef from pg_indexes
where schemaname='private' and indexname like '%requests%cleanup%';

-- ジョブの所有者・定義・稼働と実行結果の確認
select jobid,jobname,schedule,username,active,command from cron.job
where jobname in ('project-hub-expired-requests','project-hub-cron-history');
select j.jobname,h.status,h.start_time,h.end_time,h.return_message
from cron.job_run_details h join cron.job j using(jobid)
where j.jobname in ('project-hub-expired-requests','project-hub-cron-history')
order by h.start_time desc limit 20;
```

本番反映の完了には、対象プロジェクト、migration012の履歴、関数権限、2ジョブが各1件でpostgres所有・activeであることに加え、実際のスケジュール実行の成功記録を確認する。関数の手動実行だけで定期実行の成功とみなさない。停止する場合はこの2ジョブだけをinactiveにし、他のCronジョブや拡張を削除しない。

## 検証

DBテストで5種類それぞれの期限切れ削除・期限内保持・削除上限・境界時刻・入力検査・専用所有者/固定search_path・一般ロール実行拒否を確認する。対象データ・監査・再送RPCの既存回帰テストも通す。pg_cronがある環境はジョブの重複・スケジュール・所有者・commandを照合し、ない環境は未導入であることを区別する。

## 一次資料

- [Supabase Cronの導入](https://supabase.com/docs/guides/cron/install)
- [ジョブ登録と履歴の削除](https://supabase.com/docs/guides/cron/quickstart)
