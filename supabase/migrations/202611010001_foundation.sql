-- ユーザーからの書込は明示的に許可したRPCだけ。所有者はログイン不可。
create role project_hub_owner nologin noinherit;
grant project_hub_owner to postgres;
-- authスキーマの所有者はSupabase管理ロール。authenticatedのUSAGEを継承する。
grant authenticated to project_hub_owner with inherit true;
create schema private authorization project_hub_owner;
grant usage, create on schema public to project_hub_owner;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete restrict,
  display_name text not null check (char_length(display_name) between 1 and 80)
);
create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  created_at timestamptz not null default now()
);
create table public.memberships (
  workspace_id uuid not null references public.workspaces(id),
  user_id uuid not null references public.profiles(id),
  role text not null check (role in ('admin','member','viewer')),
  joined_at timestamptz not null default now(),
  primary key (workspace_id,user_id)
);
create index memberships_user_idx on public.memberships(user_id,workspace_id);
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  description text not null default '' check (char_length(description) <= 5000),
  status text not null default 'planned' check (status in ('planned','active','archived')),
  due_date date,
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id,id)
);
create index projects_list_idx on public.projects(workspace_id,created_at desc,id desc);
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  project_id uuid not null,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  description text not null default '' check (char_length(description) <= 5000),
  status text not null default 'todo' check (status in ('todo','doing','review','done')),
  priority text not null default 'medium' check (priority in ('low','medium','high')),
  assignee_id uuid,
  due_date date,
  position bigint not null default 0,
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (workspace_id,project_id) references public.projects(workspace_id,id),
  foreign key (workspace_id,assignee_id) references public.memberships(workspace_id,user_id)
);
create index tasks_board_idx on public.tasks(workspace_id,project_id,status,position,id);
create index tasks_assignee_idx on public.tasks(workspace_id,assignee_id);
create table public.issues (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  project_id uuid not null,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  description text not null default '' check (char_length(description) <= 5000),
  status text not null default 'open' check (status in ('open','investigating','resolved','closed')),
  priority text not null default 'medium' check (priority in ('low','medium','high')),
  assignee_id uuid,
  due_date date,
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (workspace_id,project_id) references public.projects(workspace_id,id),
  foreign key (workspace_id,assignee_id) references public.memberships(workspace_id,user_id)
);
create index issues_list_idx on public.issues(workspace_id,project_id,status,id);
create index issues_assignee_idx on public.issues(workspace_id,assignee_id);
create table public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  project_id uuid,
  actor_id uuid,
  actor_display_name text not null,
  entity_type text not null,
  entity_id uuid not null,
  action text not null check (action in ('INSERT','UPDATE','DELETE')),
  changes jsonb not null,
  created_at timestamptz not null default now()
);
create index activity_list_idx on public.activity_logs(workspace_id,created_at desc,id desc);

-- 所有者はRLSの再帰なしで所属を検査する。利用者IDはauth.uid()だけから取得。
create function private.is_member(wid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.memberships where workspace_id=wid and user_id=auth.uid()
  );
$$;
create function private.is_admin(wid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.memberships where workspace_id=wid and user_id=auth.uid() and role='admin'
  );
$$;
create function private.can_read_profile(uid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid()=uid or exists (
    select 1 from public.memberships me join public.memberships other using(workspace_id)
    where me.user_id=auth.uid() and other.user_id=uid
  );
$$;

create function private.new_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id,display_name) values(new.id,'デモメンバー');
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users
for each row execute function private.new_profile();

create function private.record_activity() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  r jsonb; before_row jsonb; after_row jsonb; wid uuid; eid uuid;
begin
  if tg_op <> 'INSERT' then before_row := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then after_row := to_jsonb(new); end if;
  r := coalesce(after_row,before_row);
  wid := (r->>'workspace_id')::uuid;
  eid := coalesce((r->>'id')::uuid,(r->>'user_id')::uuid);
  insert into public.activity_logs(workspace_id,project_id,actor_id,actor_display_name,entity_type,entity_id,action,changes)
  values(wid,case when tg_table_name='projects' then eid else (r->>'project_id')::uuid end,
    auth.uid(),coalesce((select display_name from public.profiles where id=auth.uid()),'ローカル初期データ'),
    tg_table_name,eid,tg_op,
    jsonb_build_object('before',jsonb_strip_nulls(jsonb_build_object('status',before_row->'status','role',before_row->'role','version',before_row->'version')),
                       'after',jsonb_strip_nulls(jsonb_build_object('status',after_row->'status','role',after_row->'role','version',after_row->'version'))));
  return coalesce(new,old);
end;
$$;

create function public.create_workspace(p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare wid uuid;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
  insert into public.workspaces(name) values(btrim(p_name)) returning id into wid;
  insert into public.memberships(workspace_id,user_id,role) values(wid,auth.uid(),'admin');
  return wid;
end;
$$;

create function public.create_project(p_workspace_id uuid,p_name text) returns public.projects
language plpgsql security definer set search_path = '' as $$
declare r public.projects;
begin
  perform 1 from public.workspaces where id=p_workspace_id for update;
  if not private.is_admin(p_workspace_id) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  insert into public.projects(workspace_id,name) values(p_workspace_id,btrim(p_name)) returning * into r;
  return r;
end;
$$;

create function public.update_project(p_workspace_id uuid,p_project_id uuid,p_name text,p_status text,p_due_date date,p_version integer) returns public.projects
language plpgsql security definer set search_path = '' as $$
declare r public.projects;
begin
  perform 1 from public.workspaces where id=p_workspace_id for update;
  if not private.is_admin(p_workspace_id) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  select * into r from public.projects where workspace_id=p_workspace_id and id=p_project_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  if r.version <> p_version or p_version is null then raise exception 'VERSION_CONFLICT' using errcode='40001'; end if;
  update public.projects set name=btrim(p_name),status=p_status,due_date=p_due_date,version=version+1,updated_at=now()
  where id=p_project_id returning * into r;
  return r;
end;
$$;

create function public.set_member_role(p_workspace_id uuid,p_user_id uuid,p_role text) returns void
language plpgsql security definer set search_path = '' as $$
declare old_role text;
begin
  perform 1 from public.workspaces where id=p_workspace_id for update;
  if not private.is_admin(p_workspace_id) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  select role into old_role from public.memberships where workspace_id=p_workspace_id and user_id=p_user_id;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  if old_role='admin' and p_role <> 'admin' and (select count(*) from public.memberships where workspace_id=p_workspace_id and role='admin')=1
  then raise exception 'LAST_ADMIN' using errcode='23514'; end if;
  update public.memberships set role=p_role where workspace_id=p_workspace_id and user_id=p_user_id;
end;
$$;

create function public.remove_member(p_workspace_id uuid,p_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare old_role text;
begin
  perform 1 from public.workspaces where id=p_workspace_id for update;
  if not private.is_admin(p_workspace_id) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  select role into old_role from public.memberships where workspace_id=p_workspace_id and user_id=p_user_id;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  if old_role='admin' and (select count(*) from public.memberships where workspace_id=p_workspace_id and role='admin')=1
  then raise exception 'LAST_ADMIN' using errcode='23514'; end if;
  update public.tasks set assignee_id=null,version=version+1,updated_at=now() where workspace_id=p_workspace_id and assignee_id=p_user_id;
  update public.issues set assignee_id=null,version=version+1,updated_at=now() where workspace_id=p_workspace_id and assignee_id=p_user_id;
  delete from public.memberships where workspace_id=p_workspace_id and user_id=p_user_id;
end;
$$;

-- 限定したテーブル・関数だけを所有者へ移譲し、APIロールのデフォルト権限を剥奪。
do $$
declare t text; f record;
begin
  foreach t in array array['profiles','workspaces','memberships','projects','tasks','issues','activity_logs'] loop
    execute format('alter table public.%I owner to project_hub_owner',t);
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('grant select on public.%I to authenticated',t);
    if t not in ('profiles','workspaces','activity_logs') then
      execute format('create trigger log_change after insert or update or delete on public.%I for each row execute function private.record_activity()',t);
    end if;
    if t not in ('profiles','workspaces') then
      execute format('create policy member_read on public.%I for select to authenticated using(private.is_member(workspace_id))',t);
    end if;
  end loop;
  for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='private' or (n.nspname='public' and p.proname in ('create_workspace','create_project','update_project','set_member_role','remove_member')) loop
    execute format('alter function %s owner to project_hub_owner',f.signature);
    execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  end loop;
end;
$$;
create policy workspace_read on public.workspaces for select to authenticated using(private.is_member(id));
create policy profile_read on public.profiles for select to authenticated using(private.can_read_profile(id));
grant execute on function private.is_member(uuid),private.can_read_profile(uuid) to authenticated;
grant execute on function public.create_workspace(text),public.create_project(uuid,text),public.update_project(uuid,uuid,text,text,date,integer),public.set_member_role(uuid,uuid,text),public.remove_member(uuid,uuid) to authenticated;
revoke create on schema public from project_hub_owner;
