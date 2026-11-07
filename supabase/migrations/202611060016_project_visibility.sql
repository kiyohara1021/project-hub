grant create on schema public to project_hub_owner;
alter table public.projects add column visibility text not null default 'workspace' check(visibility in ('workspace','private'));

create table public.project_members (
  workspace_id uuid not null,
  project_id uuid not null,
  user_id uuid not null,
  joined_at timestamptz not null default now(),
  primary key(workspace_id,project_id,user_id),
  foreign key(workspace_id,project_id) references public.projects(workspace_id,id) on delete cascade,
  foreign key(workspace_id,user_id) references public.memberships(workspace_id,user_id) on delete cascade
);
alter table public.project_members owner to project_hub_owner;
alter table public.project_members enable row level security;
revoke all on public.project_members from public,anon,authenticated;
grant select on public.project_members to authenticated;
create index project_members_user_idx on public.project_members(workspace_id,user_id,project_id);

-- 通常の削除APIは設けないが、管理用削除後の監査にも当時の閲覧範囲を維持する。
create table private.deleted_project_visibility (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null,
  visibility text not null check(visibility in ('workspace','private')),
  member_ids uuid[] not null default '{}',
  primary key(workspace_id,project_id)
);
alter table private.deleted_project_visibility owner to project_hub_owner;
alter table private.deleted_project_visibility enable row level security;
revoke all on private.deleted_project_visibility from public,anon,authenticated,service_role;
insert into private.deleted_project_visibility(workspace_id,project_id,visibility)
select distinct l.workspace_id,l.project_id,'workspace' from public.activity_logs l
where l.project_id is not null and not exists(select 1 from public.projects p where p.workspace_id=l.workspace_id and p.id=l.project_id);

create function private.can_user_read_project(wid uuid,pid uuid,uid uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select uid is not null and exists(
    select 1 from public.projects p join public.memberships m on m.workspace_id=p.workspace_id and m.user_id=uid
    where p.workspace_id=wid and p.id=pid and (p.visibility='workspace' or m.role='admin' or exists(
      select 1 from public.project_members pm where pm.workspace_id=wid and pm.project_id=pid and pm.user_id=uid
    ))
  );
$$;
create function private.can_read_project(wid uuid,pid uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select private.can_user_read_project(wid,pid,auth.uid());
$$;
create function private.can_manage_project(wid uuid,pid uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select private.is_admin(wid) and exists(select 1 from public.projects where workspace_id=wid and id=pid);
$$;
create function private.can_read_project_activity(wid uuid,pid uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select private.is_member(wid) and (
    pid is null or private.can_read_project(wid,pid) or (
      not exists(select 1 from public.projects where workspace_id=wid and id=pid) and exists(
        select 1 from private.deleted_project_visibility d where d.workspace_id=wid and d.project_id=pid
          and (d.visibility='workspace' or private.is_admin(wid) or auth.uid()=any(d.member_ids))
      )
    )
  );
$$;

create function private.remember_deleted_project() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  insert into private.deleted_project_visibility(workspace_id,project_id,visibility,member_ids)
  values(old.workspace_id,old.id,old.visibility,coalesce((select array_agg(user_id order by user_id) from public.project_members where workspace_id=old.workspace_id and project_id=old.id),'{}'::uuid[]))
  on conflict(workspace_id,project_id) do update set visibility=excluded.visibility,member_ids=excluded.member_ids;
  return old;
end;
$$;
create trigger remember_project_visibility before delete on public.projects for each row execute function private.remember_deleted_project();

-- RPC以外の管理用書込でも、閲覧できない担当者を保存させない。
create function private.check_project_assignee() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.assignee_id is not null and not private.can_user_read_project(new.workspace_id,new.project_id,new.assignee_id) then
    raise exception 'INVALID_ASSIGNEE' using errcode='23503';
  end if;
  return new;
end;
$$;
create trigger project_assignee before insert or update of workspace_id,project_id,assignee_id on public.tasks for each row execute function private.check_project_assignee();
create trigger project_assignee before insert or update of workspace_id,project_id,assignee_id on public.issues for each row execute function private.check_project_assignee();

create function private.clear_inaccessible_assignments(wid uuid,pid uuid,uid uuid default null) returns void
language plpgsql security definer set search_path='' as $$
begin
  update public.tasks t set assignee_id=null,version=version+1,updated_at=now()
  where t.workspace_id=wid and (pid is null or t.project_id=pid) and t.assignee_id is not null
    and (uid is null or t.assignee_id=uid) and not private.can_user_read_project(t.workspace_id,t.project_id,t.assignee_id);
  update public.issues i set assignee_id=null,version=version+1,updated_at=now()
  where i.workspace_id=wid and (pid is null or i.project_id=pid) and i.assignee_id is not null
    and (uid is null or i.assignee_id=uid) and not private.can_user_read_project(i.workspace_id,i.project_id,i.assignee_id);
end;
$$;
create function private.project_access_changed() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_table_name='projects' then
    if old.visibility<>new.visibility then perform private.clear_inaccessible_assignments(new.workspace_id,new.id); end if;
    return new;
  elsif tg_table_name='project_members' then
    -- 親削除のCASCADEは履歴用の参加情報を消さず、既に削除したタスクも更新しない。
    if exists(select 1 from public.projects where workspace_id=old.workspace_id and id=old.project_id) then
      perform private.clear_inaccessible_assignments(old.workspace_id,old.project_id,old.user_id);
    end if;
    return old;
  elsif tg_op='DELETE' then
    update private.deleted_project_visibility set member_ids=array_remove(member_ids,old.user_id)
      where workspace_id=old.workspace_id and old.user_id=any(member_ids);
    perform private.clear_inaccessible_assignments(old.workspace_id,null,old.user_id);
    return old;
  else
    if old.role<>new.role then perform private.clear_inaccessible_assignments(new.workspace_id,null,new.user_id); end if;
    return new;
  end if;
end;
$$;
create function private.project_membership_departing() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  -- CASCADEで参加者が消える場合も、開いている公開範囲フォームを競合させる。
  update public.projects p set version=version+1,updated_at=now()
  where p.workspace_id=old.workspace_id and exists(
    select 1 from public.project_members pm where pm.workspace_id=old.workspace_id and pm.project_id=p.id and pm.user_id=old.user_id
  );
  return old;
end;
$$;
create trigger project_membership_departing before delete on public.memberships for each row execute function private.project_membership_departing();
create trigger project_visibility_changed after update of visibility on public.projects for each row execute function private.project_access_changed();
create trigger project_member_removed after delete on public.project_members for each row execute function private.project_access_changed();
create trigger project_workspace_member_removed after delete on public.memberships for each row execute function private.project_access_changed();
create trigger project_workspace_role_changed after update of role on public.memberships for each row execute function private.project_access_changed();
create trigger log_change after insert or delete on public.project_members for each row execute function private.record_activity();

create or replace function private.assert_task_writer(wid uuid,pid uuid) returns void
language plpgsql security definer set search_path='' as $$
declare project_status text;
begin
  perform 1 from public.workspaces where id=wid for update;
  if auth.uid() is null or not private.is_member(wid) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  select status into project_status from public.projects where workspace_id=wid and id=pid and private.can_read_project(wid,pid) for update;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  if not exists(select 1 from public.memberships where workspace_id=wid and user_id=auth.uid() and role in ('admin','member')) then
    raise exception 'FORBIDDEN' using errcode='42501';
  end if;
  if project_status='archived' then raise exception 'PROJECT_ARCHIVED' using errcode='55000'; end if;
end;
$$;

-- 適用前に受け付けた再送記録は、省略されたvisibilityをworkspaceとして比較する。
drop function public.create_project_once(uuid,text,text,date,text);
create function public.create_project_once(p_workspace_id uuid,p_name text,p_description text,p_due_date date,p_key text,p_visibility text default 'workspace') returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.projects; payload jsonb; previous private.project_requests;
begin
  perform 1 from public.workspaces where id=p_workspace_id for update;
  if not private.is_admin(p_workspace_id) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if p_key is null or char_length(p_key) not between 1 and 128 then raise exception 'INVALID_KEY' using errcode='22023'; end if;
  if p_visibility is null or p_visibility not in ('workspace','private') then raise exception 'INVALID_INPUT' using errcode='22023'; end if;
  payload:=jsonb_build_object('name',btrim(p_name),'description',p_description,'due_date',p_due_date,'visibility',p_visibility);
  delete from private.project_requests where workspace_id=p_workspace_id and actor_id=auth.uid() and expires_at<=clock_timestamp();
  select * into previous from private.project_requests where workspace_id=p_workspace_id and actor_id=auth.uid() and request_key=p_key;
  if found then
    if ('{"visibility":"workspace"}'::jsonb||previous.payload)<>payload then raise exception 'IDEMPOTENCY_CONFLICT' using errcode='40001'; end if;
    return jsonb_build_object('visibility','workspace')||previous.result;
  end if;
  insert into public.projects(workspace_id,name,description,due_date,visibility) values(p_workspace_id,btrim(p_name),p_description,p_due_date,p_visibility) returning * into r;
  insert into private.project_requests values(p_workspace_id,auth.uid(),p_key,payload,to_jsonb(r),clock_timestamp()+interval '24 hours');
  return to_jsonb(r);
end;
$$;

create function public.read_project_assignees(p_workspace_id uuid,p_project_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if not private.can_read_project(p_workspace_id,p_project_id) then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',m.user_id,'name',p.display_name) order by p.display_name,m.user_id),'[]'::jsonb) into result
  from public.memberships m join public.profiles p on p.id=m.user_id
  where m.workspace_id=p_workspace_id and private.can_user_read_project(p_workspace_id,p_project_id,m.user_id);
  return result;
end;
$$;
create function public.read_project_access(p_workspace_id uuid,p_project_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare r public.projects;
begin
  if not private.can_manage_project(p_workspace_id,p_project_id) then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  select * into r from public.projects where workspace_id=p_workspace_id and id=p_project_id;
  return jsonb_build_object('visibility',r.visibility,'version',r.version,
    'member_ids',coalesce((select jsonb_agg(user_id order by user_id) from public.project_members where workspace_id=p_workspace_id and project_id=p_project_id),'[]'::jsonb),
    'candidates',coalesce((select jsonb_agg(jsonb_build_object('id',m.user_id,'name',p.display_name,'role',m.role) order by p.display_name,m.user_id) from public.memberships m join public.profiles p on p.id=m.user_id where m.workspace_id=p_workspace_id),'[]'::jsonb));
end;
$$;
create function public.set_project_access(p_workspace_id uuid,p_project_id uuid,p_visibility text,p_member_ids uuid[],p_version integer) returns public.projects
language plpgsql security definer set search_path='' as $$
declare r public.projects;
begin
  perform 1 from public.workspaces where id=p_workspace_id for update;
  if not private.can_manage_project(p_workspace_id,p_project_id) then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  select * into r from public.projects where workspace_id=p_workspace_id and id=p_project_id for update;
  if p_version is null or r.version<>p_version then raise exception 'VERSION_CONFLICT' using errcode='40001'; end if;
  if p_visibility is null or p_visibility not in ('workspace','private') or p_member_ids is null or cardinality(p_member_ids)>100
     or array_position(p_member_ids,null) is not null or cardinality(p_member_ids)<>(select count(distinct x) from unnest(p_member_ids) x)
     or exists(select 1 from unnest(p_member_ids) x where not exists(select 1 from public.memberships where workspace_id=p_workspace_id and user_id=x)) then
    raise exception 'INVALID_INPUT' using errcode='22023';
  end if;
  -- 公開へ戻す場合は、参加者を外す前に範囲を広げて不要な担当解除を避ける。
  if p_visibility='workspace' then
    update public.projects set visibility=p_visibility,version=version+1,updated_at=now() where id=p_project_id returning * into r;
  end if;
  insert into public.project_members(workspace_id,project_id,user_id)
    select p_workspace_id,p_project_id,x from unnest(p_member_ids) x on conflict do nothing;
  delete from public.project_members where workspace_id=p_workspace_id and project_id=p_project_id and not(user_id=any(p_member_ids));
  if p_visibility='private' then
    update public.projects set visibility=p_visibility,version=version+1,updated_at=now() where id=p_project_id returning * into r;
  end if;
  return r;
end;
$$;

create or replace function private.record_activity() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  r jsonb; before_row jsonb; after_row jsonb; wid uuid; eid uuid;
begin
  if tg_op <> 'INSERT' then before_row := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then after_row := to_jsonb(new); end if;
  -- Position-only maintenance has no user-visible content or version change.
  if tg_table_name='tasks' and tg_op='UPDATE'
     and (before_row-'position')=(after_row-'position') then return new; end if;
  r := coalesce(after_row,before_row);
  wid := (r->>'workspace_id')::uuid;
  eid := coalesce((r->>'id')::uuid,(r->>'user_id')::uuid);
  insert into public.activity_logs(workspace_id,project_id,actor_id,actor_display_name,entity_type,entity_id,action,changes)
  values(wid,case when tg_table_name='projects' then eid else (r->>'project_id')::uuid end,
    auth.uid(),coalesce((select display_name from public.profiles where id=auth.uid()),'ローカル初期データ'),
    tg_table_name,eid,tg_op,
    jsonb_build_object('before',jsonb_strip_nulls(jsonb_build_object('status',before_row->'status','role',before_row->'role','version',before_row->'version','visibility',before_row->'visibility')),
                       'after',jsonb_strip_nulls(jsonb_build_object('status',after_row->'status','role',after_row->'role','version',after_row->'version','visibility',after_row->'visibility'))));
  return coalesce(new,old);
end;
$$;

-- 既存のSECURITY INVOKER集計はRLSのまま、新しい閲覧範囲に自動で従う。
drop policy member_read on public.projects;
create policy member_read on public.projects for select to authenticated using(private.can_read_project(workspace_id,id));
drop policy member_read on public.tasks;
create policy member_read on public.tasks for select to authenticated using(private.can_read_project(workspace_id,project_id));
drop policy member_read on public.issues;
create policy member_read on public.issues for select to authenticated using(private.can_read_project(workspace_id,project_id));
drop policy member_read on public.issue_comments;
create policy member_read on public.issue_comments for select to authenticated using(private.can_read_project(workspace_id,project_id));
drop policy member_read on public.activity_logs;
create policy member_read on public.activity_logs for select to authenticated using(private.can_read_project_activity(workspace_id,project_id));
create policy admin_read on public.project_members for select to authenticated using(private.can_manage_project(workspace_id,project_id));

grant create on schema public to project_hub_owner;
do $permissions$
declare f record;
begin
  for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where (n.nspname='private' and p.proname in ('can_user_read_project','can_read_project','can_manage_project','can_read_project_activity','remember_deleted_project','check_project_assignee','clear_inaccessible_assignments','project_access_changed','project_membership_departing'))
       or (n.nspname='public' and p.proname in ('create_project_once','read_project_assignees','read_project_access','set_project_access')) loop
    execute format('alter function %s owner to project_hub_owner',f.signature);
    execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  end loop;
end;
$permissions$;
revoke create on schema public from project_hub_owner;
grant execute on function private.can_read_project(uuid,uuid),private.can_manage_project(uuid,uuid),private.can_read_project_activity(uuid,uuid) to authenticated;
grant execute on function public.create_project_once(uuid,text,text,date,text,text),public.read_project_assignees(uuid,uuid),public.read_project_access(uuid,uuid),public.set_project_access(uuid,uuid,text,uuid[],integer) to authenticated;
