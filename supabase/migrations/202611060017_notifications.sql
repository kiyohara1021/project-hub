grant create on schema public to project_hub_owner;
create table public.user_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id),
  workspace_id uuid not null,
  project_id uuid not null,
  entity_type text not null check(entity_type in ('tasks','issues')),
  entity_id uuid not null,
  kind text not null check(kind in ('assigned_task','assigned_issue','issue_comment')),
  source_id uuid not null,
  source_version integer not null check(source_version>=1),
  comment_id uuid references public.issue_comments(id) on delete cascade,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  foreign key(workspace_id,project_id) references public.projects(workspace_id,id) on delete cascade,
  unique(recipient_id,kind,source_id,source_version),
  check((kind='assigned_task' and entity_type='tasks' and comment_id is null)
    or (kind='assigned_issue' and entity_type='issues' and comment_id is null)
    or (kind='issue_comment' and entity_type='issues' and comment_id is not null))
);
alter table public.user_notifications owner to project_hub_owner;
alter table public.user_notifications enable row level security;
revoke all on public.user_notifications from public,anon,authenticated;
grant select on public.user_notifications to authenticated;
grant all on public.user_notifications to service_role;
create index notifications_list_idx on public.user_notifications(recipient_id,created_at desc,id desc);
create index notifications_unread_idx on public.user_notifications(recipient_id) where read_at is null;
create index notifications_retention_idx on public.user_notifications(created_at);

create function private.notification_target_visible(wid uuid,pid uuid,etype text,eid uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select private.can_user_read_project(wid,pid,auth.uid()) and (
    (etype='tasks' and exists(select 1 from public.tasks where workspace_id=wid and project_id=pid and id=eid))
    or (etype='issues' and exists(select 1 from public.issues where workspace_id=wid and project_id=pid and id=eid))
  );
$$;
alter function private.notification_target_visible(uuid,uuid,text,uuid) owner to project_hub_owner;
revoke all on function private.notification_target_visible(uuid,uuid,text,uuid) from public,anon,authenticated,service_role;
grant execute on function private.notification_target_visible(uuid,uuid,text,uuid) to authenticated;
create policy own_visible_notifications on public.user_notifications for select to authenticated using (
  recipient_id=auth.uid() and created_at>statement_timestamp()-interval '90 days'
  and private.notification_target_visible(workspace_id,project_id,entity_type,entity_id)
);

create function private.notify_assignment() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or new.assignee_id is null or new.assignee_id=auth.uid() then return new; end if;
  if tg_op='UPDATE' and old.assignee_id is not distinct from new.assignee_id then return new; end if;
  if not private.can_user_read_project(new.workspace_id,new.project_id,new.assignee_id) then return new; end if;
  insert into public.user_notifications(recipient_id,workspace_id,project_id,entity_type,entity_id,kind,source_id,source_version)
  values(new.assignee_id,new.workspace_id,new.project_id,tg_table_name,new.id,
    case tg_table_name when 'tasks' then 'assigned_task' else 'assigned_issue' end,new.id,new.version)
  on conflict(recipient_id,kind,source_id,source_version) do nothing;
  return new;
end;
$$;
alter function private.notify_assignment() owner to project_hub_owner;
revoke all on function private.notify_assignment() from public,anon,authenticated,service_role;
create trigger notify_assignment after insert or update of assignee_id on public.tasks for each row execute function private.notify_assignment();
create trigger notify_assignment after insert or update of assignee_id on public.issues for each row execute function private.notify_assignment();

create function private.notify_issue_comment() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then return new; end if;
  insert into public.user_notifications(recipient_id,workspace_id,project_id,entity_type,entity_id,kind,source_id,source_version,comment_id)
  select recipient,new.workspace_id,new.project_id,'issues',new.issue_id,'issue_comment',new.id,new.version,new.id
  from (
    select assignee_id as recipient from public.issues where workspace_id=new.workspace_id and project_id=new.project_id and id=new.issue_id
    union
    select author_id from public.issue_comments where workspace_id=new.workspace_id and project_id=new.project_id and issue_id=new.issue_id
  ) recipients
  where recipient is not null and recipient<>auth.uid()
    and private.can_user_read_project(new.workspace_id,new.project_id,recipient)
  on conflict(recipient_id,kind,source_id,source_version) do nothing;
  return new;
end;
$$;
alter function private.notify_issue_comment() owner to project_hub_owner;
revoke all on function private.notify_issue_comment() from public,anon,authenticated,service_role;
create trigger notify_issue_comment after insert on public.issue_comments for each row execute function private.notify_issue_comment();

create function public.mark_notification_read(p_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode='42501'; end if;
  update public.user_notifications n set read_at=coalesce(read_at,statement_timestamp())
  where id=p_id and recipient_id=auth.uid() and created_at>statement_timestamp()-interval '90 days'
    and private.notification_target_visible(workspace_id,project_id,entity_type,entity_id)
  returning id into result;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  return result;
end;
$$;
create function public.mark_all_notifications_read() returns integer
language plpgsql security definer set search_path='' as $$
declare affected integer;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode='42501'; end if;
  update public.user_notifications n set read_at=statement_timestamp()
  where recipient_id=auth.uid() and read_at is null and created_at>statement_timestamp()-interval '90 days'
    and private.notification_target_visible(workspace_id,project_id,entity_type,entity_id);
  get diagnostics affected = row_count;
  return affected;
end;
$$;
alter function public.mark_notification_read(uuid) owner to project_hub_owner;
alter function public.mark_all_notifications_read() owner to project_hub_owner;
revoke all on function public.mark_notification_read(uuid),public.mark_all_notifications_read() from public,anon,authenticated,service_role;
grant execute on function public.mark_notification_read(uuid),public.mark_all_notifications_read() to authenticated;

create function private.purge_old_notifications(p_limit integer default 1000) returns integer
language plpgsql security definer set search_path='' set lock_timeout='1s' as $$
declare affected integer;
begin
  if p_limit is null or p_limit not between 1 and 10000 then raise exception 'INVALID_INPUT' using errcode='22023'; end if;
  if not pg_try_advisory_xact_lock(hashtextextended('project-hub:old-notifications',0)) then return 0; end if;
  with expired as (
    select id from public.user_notifications where created_at<=statement_timestamp()-interval '90 days'
    order by created_at,id limit p_limit for update skip locked
  ) delete from public.user_notifications n using expired where n.id=expired.id;
  get diagnostics affected = row_count;
  return affected;
end;
$$;
alter function private.purge_old_notifications(integer) owner to project_hub_owner;
revoke all on function private.purge_old_notifications(integer) from public,anon,authenticated,service_role;
grant execute on function private.purge_old_notifications(integer) to postgres;
revoke create on schema public from project_hub_owner;

do $cron_install$
begin
  if not exists(select 1 from pg_extension where extname='pg_cron') then
    if exists(select 1 from pg_available_extensions where name='pg_cron')
       and 'pg_cron'=any(regexp_split_to_array(replace(replace(current_setting('shared_preload_libraries'),' ',''),'"',''),',')) then
      execute 'create extension pg_cron with schema pg_catalog';
    else
      raise notice 'pg_cron unavailable or not preloaded: ProjectHub notifications cleanup job was not installed';
      return;
    end if;
  end if;
  if exists(select 1 from cron.job where jobname='project-hub-notifications' and username<>current_user) then
    raise exception 'Unexpected owner of ProjectHub notifications job';
  end if;
  perform cron.schedule('project-hub-notifications','27 3 * * *',
    $job$set statement_timeout='30s'; set lock_timeout='1s'; select private.purge_old_notifications(1000); delete from cron.job_run_details where runid in (select h.runid from cron.job_run_details h join cron.job j using(jobid) where j.jobname='project-hub-notifications' and j.username=current_user and h.end_time<statement_timestamp()-interval '7 days' order by h.runid limit 10000);$job$
  );
end;
$cron_install$;
