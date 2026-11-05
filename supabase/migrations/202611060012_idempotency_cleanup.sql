-- 定期削除と、作成API内のworkspace/actor単位の期限切れ削除を索引で支える。
create index project_requests_expiry_cleanup_idx on private.project_requests(expires_at);
create index project_requests_actor_cleanup_idx on private.project_requests(workspace_id,actor_id,expires_at);
create index task_requests_expiry_cleanup_idx on private.task_requests(expires_at);
create index task_requests_actor_cleanup_idx on private.task_requests(workspace_id,actor_id,expires_at);
create index issue_requests_expiry_cleanup_idx on private.issue_requests(expires_at);
create index issue_requests_actor_cleanup_idx on private.issue_requests(workspace_id,actor_id,expires_at);
create index member_requests_expiry_cleanup_idx on private.member_requests(expires_at);
create index member_requests_actor_cleanup_idx on private.member_requests(workspace_id,actor_id,expires_at);
create index comment_requests_expiry_cleanup_idx on private.comment_requests(expires_at);
create index comment_requests_actor_cleanup_idx on private.comment_requests(workspace_id,actor_id,expires_at);

create function private.purge_expired_requests(p_limit integer default 1000) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='1s' as $$
declare
  cutoff timestamptz := statement_timestamp();
  target text;
  deleted bigint;
  counts jsonb := '{}'::jsonb;
begin
  if p_limit is null or p_limit not between 1 and 10000 then
    raise exception 'INVALID_INPUT' using errcode='22023';
  end if;
  if not pg_try_advisory_xact_lock(hashtextextended('project-hub:expired-requests',0)) then
    return jsonb_build_object('skipped',true,'deleted',counts);
  end if;
  foreach target in array array['project_requests','task_requests','issue_requests','member_requests','comment_requests'] loop
    execute format(
      'with expired as (select ctid from private.%I where expires_at<=$1 order by expires_at limit $2 for update skip locked) delete from private.%I as receipt using expired where receipt.ctid=expired.ctid',
      target,target
    ) using cutoff,p_limit;
    get diagnostics deleted = row_count;
    counts := counts || jsonb_build_object(target,deleted);
  end loop;
  return jsonb_build_object('skipped',false,'deleted',counts);
end;
$$;
alter function private.purge_expired_requests(integer) owner to project_hub_owner;
revoke all on function private.purge_expired_requests(integer) from public,anon,authenticated,service_role;
grant execute on function private.purge_expired_requests(integer) to postgres;

-- pg_cronを使えないローカル環境でも、関数の導入・テストは可能にする。
-- NOTICEの環境では定期実行は未導入。本番は拡張を有効にして以下を再実行し、実行履歴も照合する。
do $cron_install$
begin
  if not exists(select 1 from pg_extension where extname='pg_cron') then
    if exists(select 1 from pg_available_extensions where name='pg_cron')
       and 'pg_cron'=any(regexp_split_to_array(replace(replace(current_setting('shared_preload_libraries'),' ',''),'"',''),',')) then
      execute 'create extension pg_cron with schema pg_catalog';
    else
      raise notice 'pg_cron unavailable or not preloaded: ProjectHub cleanup jobs were not installed';
      return;
    end if;
  end if;
  if exists(select 1 from cron.job where jobname in ('project-hub-expired-requests','project-hub-cron-history') and username<>current_user) then
    raise exception 'Unexpected owner of ProjectHub cleanup job';
  end if;
  perform cron.schedule(
    'project-hub-expired-requests','17 * * * *',
    $job$set statement_timeout='30s'; set lock_timeout='1s'; select private.purge_expired_requests(1000);$job$
  );
  perform cron.schedule(
    'project-hub-cron-history','47 2 * * *',
    $job$set statement_timeout='30s'; set lock_timeout='1s'; delete from cron.job_run_details where runid in (select h.runid from cron.job_run_details h join cron.job j using(jobid) where j.jobname in ('project-hub-expired-requests','project-hub-cron-history') and j.username=current_user and h.end_time<statement_timestamp()-interval '7 days' order by h.runid limit 10000);$job$
  );
end;
$cron_install$;
