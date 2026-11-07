-- 専用プロジェクトの未使用publicationだけを変更する。他用途があれば無変更で停止。
do $publication_preflight$
begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime' and puballtables)
     or exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and (schemaname<>'public' or tablename<>'realtime_updates')) then
    raise exception 'Supabase Realtime publication is used by other tables; review before enabling ProjectHub realtime';
  end if;
end;
$publication_preflight$;

grant create on schema public to project_hub_owner;
create table public.realtime_updates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check(kind in ('data','access','notification')),
  created_at timestamptz not null default clock_timestamp()
);
alter table public.realtime_updates owner to project_hub_owner;
alter table public.realtime_updates enable row level security;
alter table public.realtime_updates replica identity default;
revoke all on public.realtime_updates from public,anon,authenticated;
grant select on public.realtime_updates to authenticated;
grant all on public.realtime_updates to service_role;
create policy own_read on public.realtime_updates for select to authenticated using(user_id=(select auth.uid()));
create index realtime_updates_user_idx on public.realtime_updates(user_id,created_at desc,id desc);
create index realtime_updates_expiry_idx on public.realtime_updates(created_at);

create function private.emit_realtime_update(wid uuid,pid uuid,extra_uid uuid default null,event_kind text default 'data') returns void
language plpgsql security definer set search_path='' as $$
begin
  insert into public.realtime_updates(user_id,kind)
  select recipients.user_id,event_kind from (
    select m.user_id from public.memberships m
      where m.workspace_id=wid and (pid is null or private.can_user_read_project(wid,pid,m.user_id))
    union
    select p.id from public.profiles p where p.id=extra_uid
  ) recipients;
end;
$$;

create function private.record_realtime_update() returns trigger
language plpgsql security definer set search_path='' as $$
declare r jsonb; before_row jsonb; after_row jsonb; wid uuid;
begin
  if tg_op<>'INSERT' then before_row:=to_jsonb(old); end if;
  if tg_op<>'DELETE' then after_row:=to_jsonb(new); end if;
  r:=coalesce(after_row,before_row);
  if tg_op='UPDATE' and before_row=after_row then return new; end if;
  if tg_table_name='tasks' and tg_op='UPDATE' and (before_row-'position')=(after_row-'position') then return new; end if;
  if tg_table_name='projects' then
    if tg_op='UPDATE' and before_row->>'visibility'<>after_row->>'visibility' then
      perform private.emit_realtime_update((r->>'workspace_id')::uuid,null,null,'access');
    else
      perform private.emit_realtime_update((r->>'workspace_id')::uuid,(r->>'id')::uuid);
    end if;
  elsif tg_table_name='memberships' then
    perform private.emit_realtime_update((r->>'workspace_id')::uuid,null,(r->>'user_id')::uuid,'access');
  elsif tg_table_name='project_members' then
    perform private.emit_realtime_update((r->>'workspace_id')::uuid,(r->>'project_id')::uuid,(r->>'user_id')::uuid,'access');
  elsif tg_table_name='user_notifications' then
    perform private.emit_realtime_update(null,null,(r->>'recipient_id')::uuid,'notification');
  elsif tg_table_name='profiles' then
    for wid in select workspace_id from public.memberships where user_id=(r->>'id')::uuid loop
      perform private.emit_realtime_update(wid,null);
    end loop;
    perform private.emit_realtime_update(null,null,(r->>'id')::uuid);
  elsif tg_table_name='workspaces' then
    perform private.emit_realtime_update((r->>'id')::uuid,null);
  elsif tg_table_name='attachments' then
    if r->>'state'='ready' then perform private.emit_realtime_update((r->>'workspace_id')::uuid,(r->>'project_id')::uuid); end if;
  else
    perform private.emit_realtime_update((r->>'workspace_id')::uuid,(r->>'project_id')::uuid);
  end if;
  return coalesce(new,old);
end;
$$;

create trigger realtime_project_change after insert or update on public.projects for each row execute function private.record_realtime_update();
-- 削除前なら現在の参加者を確認でき、操作失敗時は通知INSERTもロールバックされる。
create trigger realtime_project_delete before delete on public.projects for each row execute function private.record_realtime_update();
create trigger realtime_change after insert or update or delete on public.tasks for each row execute function private.record_realtime_update();
create trigger realtime_change after insert or update or delete on public.issues for each row execute function private.record_realtime_update();
create trigger realtime_change after insert or update or delete on public.issue_comments for each row execute function private.record_realtime_update();
create trigger realtime_change after insert or update or delete on public.memberships for each row execute function private.record_realtime_update();
create trigger realtime_change after insert or delete on public.project_members for each row execute function private.record_realtime_update();
create trigger realtime_change after insert or update on public.profiles for each row execute function private.record_realtime_update();
create trigger realtime_change after update or delete on public.workspaces for each row execute function private.record_realtime_update();
do $optional_triggers$
begin
  if to_regclass('public.user_notifications') is not null then
    execute 'create trigger realtime_change after insert or update or delete on public.user_notifications for each row execute function private.record_realtime_update()';
  end if;
  if to_regclass('public.attachments') is not null then
    execute 'create trigger realtime_change after insert or update or delete on public.attachments for each row execute function private.record_realtime_update()';
  end if;
end;
$optional_triggers$;

create function private.purge_realtime_updates(p_limit integer default 10000) returns integer
language plpgsql security definer set search_path='' set lock_timeout='1s' as $$
declare affected integer;
begin
  if p_limit is null or p_limit not between 1 and 10000 then raise exception 'INVALID_INPUT' using errcode='22023'; end if;
  if not pg_try_advisory_xact_lock(hashtextextended('project-hub:realtime-updates',0)) then return 0; end if;
  with expired as (
    select ctid from public.realtime_updates where created_at<statement_timestamp()-interval '1 day'
    order by created_at,id limit p_limit for update skip locked
  ) delete from public.realtime_updates u using expired where u.ctid=expired.ctid;
  get diagnostics affected=row_count;
  return affected;
end;
$$;

grant create on schema public to project_hub_owner;
alter function private.emit_realtime_update(uuid,uuid,uuid,text) owner to project_hub_owner;
alter function private.record_realtime_update() owner to project_hub_owner;
alter function private.purge_realtime_updates(integer) owner to project_hub_owner;
revoke create on schema public from project_hub_owner;
revoke all on function private.emit_realtime_update(uuid,uuid,uuid,text),private.record_realtime_update(),private.purge_realtime_updates(integer) from public,anon,authenticated,service_role;
grant execute on function private.purge_realtime_updates(integer) to postgres;

do $publication_install$
begin
  if not exists(select 1 from pg_publication where pubname='supabase_realtime') then
    create publication supabase_realtime with(publish='insert');
  else
    alter publication supabase_realtime set(publish='insert');
  end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='realtime_updates') then
    alter publication supabase_realtime add table public.realtime_updates;
  end if;
end;
$publication_install$;

do $cron_install$
begin
  if not exists(select 1 from pg_extension where extname='pg_cron') then
    if exists(select 1 from pg_available_extensions where name='pg_cron')
       and 'pg_cron'=any(regexp_split_to_array(replace(replace(current_setting('shared_preload_libraries'),' ',''),'"',''),',')) then
      execute 'create extension pg_cron with schema pg_catalog';
    else
      raise notice 'pg_cron unavailable or not preloaded: ProjectHub realtime cleanup job was not installed';
      return;
    end if;
  end if;
  if exists(select 1 from cron.job where jobname='project-hub-realtime-updates' and username<>current_user) then
    raise exception 'Unexpected owner of ProjectHub realtime cleanup job';
  end if;
  perform cron.schedule('project-hub-realtime-updates','37 * * * *',
    $job$set statement_timeout='30s'; set lock_timeout='1s'; select private.purge_realtime_updates(10000); delete from cron.job_run_details where runid in (select h.runid from cron.job_run_details h join cron.job j using(jobid) where j.jobname='project-hub-realtime-updates' and j.username=current_user and h.end_time<statement_timestamp()-interval '7 days' order by h.runid limit 10000);$job$
  );
end;
$cron_install$;
