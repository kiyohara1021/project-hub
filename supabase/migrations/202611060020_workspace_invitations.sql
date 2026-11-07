-- Narrow managed-role exception: no arguments, no arbitrary user lookup, no app secret.
-- Hosted postgres can read Auth with BYPASSRLS but cannot alter Auth-owned tables.
create function private.invitation_verified_email() returns text
language sql stable security definer set search_path='' as $$
  select lower(email) from auth.users where id=auth.uid() and email_confirmed_at is not null;
$$;
alter function private.invitation_verified_email() owner to postgres;
revoke all on function private.invitation_verified_email() from public,anon,authenticated,service_role;
grant execute on function private.invitation_verified_email() to project_hub_owner;

create table private.workspace_invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email text not null check(char_length(email)<=254 and email=lower(btrim(email)) and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  role text not null check(role in ('member','viewer')),
  invited_by uuid not null references public.profiles(id),
  token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'),
  status text not null default 'pending' check(status in ('pending','accepted','cancelled','expired')),
  delivery text not null default 'pending' check(delivery in ('pending','sent','failed')),
  version integer not null default 1 check(version>0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default now()+interval '7 days',
  accepted_by uuid,
  accepted_at timestamptz
);
alter table private.workspace_invitations owner to project_hub_owner;
alter table private.workspace_invitations enable row level security;
revoke all on private.workspace_invitations from public,anon,authenticated,service_role;
create unique index pending_workspace_invite_idx on private.workspace_invitations(workspace_id,email) where status='pending';
create index workspace_invites_list_idx on private.workspace_invitations(workspace_id,created_at desc,id desc);
create index workspace_invites_retention_idx on private.workspace_invitations(expires_at);
create trigger log_change after insert or update of status,role,version on private.workspace_invitations for each row execute function private.record_activity();

create table private.invitation_requests (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor_id uuid not null references public.profiles(id),
  request_key text not null check(request_key ~ '^[A-Za-z0-9_-]{1,128}$'),
  payload jsonb not null,
  invitation_id uuid not null references private.workspace_invitations(id) on delete cascade,
  expires_at timestamptz not null default now()+interval '24 hours',
  primary key(workspace_id,actor_id,request_key)
);
alter table private.invitation_requests owner to project_hub_owner;
alter table private.invitation_requests enable row level security;
revoke all on private.invitation_requests from public,anon,authenticated,service_role;
create index invitation_requests_expiry_idx on private.invitation_requests(expires_at);

create function private.invitation_summary(r private.workspace_invitations) returns jsonb
language sql stable set search_path='' as $$
  select jsonb_build_object('id',r.id,'workspace_id',r.workspace_id,'email',r.email,'role',r.role,'status',r.status,'delivery',r.delivery,'version',r.version,'created_at',r.created_at,'expires_at',r.expires_at);
$$;

create function public.prepare_workspace_invitation(p_workspace_id uuid,p_email text,p_role text,p_token_hash text,p_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r private.workspace_invitations; previous private.invitation_requests; payload jsonb; normalized text;
begin
  perform 1 from public.workspaces where id=p_workspace_id for update;
  if not private.is_admin(p_workspace_id) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  normalized:=lower(btrim(p_email));
  if normalized is null or char_length(normalized)>254 or normalized !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or p_role is null or p_role not in ('member','viewer') or p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$'
    or p_key is null or p_key !~ '^[A-Za-z0-9_-]{1,128}$' then raise exception 'INVALID_INPUT' using errcode='22023'; end if;
  payload:=jsonb_build_object('operation','create','email',normalized,'role',p_role);
  delete from private.invitation_requests where workspace_id=p_workspace_id and actor_id=auth.uid() and expires_at<=statement_timestamp();
  select * into previous from private.invitation_requests where workspace_id=p_workspace_id and actor_id=auth.uid() and request_key=p_key;
  if found then
    if previous.payload<>payload then raise exception 'IDEMPOTENCY_CONFLICT' using errcode='40001'; end if;
    select * into r from private.workspace_invitations where id=previous.invitation_id;
    return private.invitation_summary(r)||jsonb_build_object('replayed',true);
  end if;
  update private.workspace_invitations set status='expired',version=version+1,updated_at=now()
    where workspace_id=p_workspace_id and email=normalized and status='pending' and expires_at<=statement_timestamp();
  if exists(select 1 from private.workspace_invitations where workspace_id=p_workspace_id and email=normalized and status='pending') then
    raise exception 'INVITATION_EXISTS' using errcode='23505';
  end if;
  insert into private.workspace_invitations(workspace_id,email,role,invited_by,token_hash)
    values(p_workspace_id,normalized,p_role,auth.uid(),p_token_hash) returning * into r;
  insert into private.invitation_requests(workspace_id,actor_id,request_key,payload,invitation_id)
    values(p_workspace_id,auth.uid(),p_key,payload,r.id);
  return private.invitation_summary(r)||jsonb_build_object('replayed',false);
end;
$$;

create function public.update_workspace_invitation(p_workspace_id uuid,p_invitation_id uuid,p_action text,p_version integer,p_token_hash text,p_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r private.workspace_invitations; previous private.invitation_requests; payload jsonb;
begin
  perform 1 from public.workspaces where id=p_workspace_id for update;
  if not private.is_admin(p_workspace_id) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if p_action is null or p_action not in ('resend','cancel') or p_version is null or p_version<1
    or p_key is null or p_key !~ '^[A-Za-z0-9_-]{1,128}$'
    or (p_action='resend' and (p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$')) then raise exception 'INVALID_INPUT' using errcode='22023'; end if;
  payload:=jsonb_build_object('operation',p_action,'id',p_invitation_id,'version',p_version);
  delete from private.invitation_requests where workspace_id=p_workspace_id and actor_id=auth.uid() and expires_at<=statement_timestamp();
  select * into previous from private.invitation_requests where workspace_id=p_workspace_id and actor_id=auth.uid() and request_key=p_key;
  if found then
    if previous.payload<>payload then raise exception 'IDEMPOTENCY_CONFLICT' using errcode='40001'; end if;
    select * into r from private.workspace_invitations where id=previous.invitation_id;
    return private.invitation_summary(r)||jsonb_build_object('replayed',true);
  end if;
  select * into r from private.workspace_invitations where workspace_id=p_workspace_id and id=p_invitation_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  if r.version<>p_version then raise exception 'VERSION_CONFLICT' using errcode='40001'; end if;
  if r.status not in ('pending','expired') then raise exception 'INVITATION_CLOSED' using errcode='22023'; end if;
  update private.workspace_invitations set
    status=case p_action when 'cancel' then 'cancelled' else 'pending' end,
    token_hash=case p_action when 'resend' then p_token_hash else token_hash end,
    delivery=case p_action when 'resend' then 'pending' else delivery end,
    invited_by=case p_action when 'resend' then auth.uid() else invited_by end,
    expires_at=case p_action when 'resend' then statement_timestamp()+interval '7 days' else expires_at end,
    version=version+1,updated_at=now()
  where id=p_invitation_id returning * into r;
  insert into private.invitation_requests(workspace_id,actor_id,request_key,payload,invitation_id)
    values(p_workspace_id,auth.uid(),p_key,payload,r.id);
  return private.invitation_summary(r)||jsonb_build_object('replayed',false);
end;
$$;

create function public.record_invitation_delivery(p_workspace_id uuid,p_invitation_id uuid,p_version integer,p_delivery text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r private.workspace_invitations;
begin
  perform 1 from public.workspaces where id=p_workspace_id for update;
  if not private.is_admin(p_workspace_id) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if p_delivery is null or p_delivery not in ('sent','failed') then raise exception 'INVALID_INPUT' using errcode='22023'; end if;
  update private.workspace_invitations set delivery=p_delivery,updated_at=now()
    where workspace_id=p_workspace_id and id=p_invitation_id and version=p_version and status='pending' returning * into r;
  if not found then raise exception 'VERSION_CONFLICT' using errcode='40001'; end if;
  return private.invitation_summary(r);
end;
$$;

create function public.list_workspace_invitations(p_workspace_id uuid,p_limit integer default 25,p_before_time timestamptz default null,p_before_id uuid default null)
returns table(id uuid,workspace_id uuid,email text,role text,status text,delivery text,version integer,created_at timestamptz,expires_at timestamptz)
language plpgsql security definer set search_path='' as $$
begin
  if not private.is_admin(p_workspace_id) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if p_limit is null or p_limit not between 1 and 101 or (p_before_time is null)<>(p_before_id is null) then raise exception 'INVALID_INPUT' using errcode='22023'; end if;
  return query select i.id,i.workspace_id,i.email,i.role,i.status,i.delivery,i.version,i.created_at,i.expires_at
    from private.workspace_invitations i where i.workspace_id=p_workspace_id
      and (p_before_time is null or (i.created_at,i.id)<(p_before_time,p_before_id))
    order by i.created_at desc,i.id desc limit p_limit;
end;
$$;

create function private.invitation_for_me(p_token_hash text) returns private.workspace_invitations
language plpgsql security definer set search_path='' as $$
declare r private.workspace_invitations; confirmed_email text;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode='42501'; end if;
  confirmed_email:=private.invitation_verified_email();
  select * into r from private.workspace_invitations where token_hash=p_token_hash;
  if r.id is null or confirmed_email is null or confirmed_email<>r.email or r.expires_at<=statement_timestamp()
    or r.status not in ('pending','accepted') or (r.status='accepted' and r.accepted_by<>auth.uid())
    or not exists(select 1 from public.memberships where workspace_id=r.workspace_id and user_id=r.invited_by and role='admin') then
    raise exception 'NOT_FOUND' using errcode='P0002';
  end if;
  return r;
end;
$$;

create function public.read_workspace_invitation(p_token_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r private.workspace_invitations;
begin
  r:=private.invitation_for_me(p_token_hash);
  return jsonb_build_object('id',r.id,'workspace_id',r.workspace_id,'workspace_name',(select name from public.workspaces where id=r.workspace_id),'role',r.role,'status',r.status,'expires_at',r.expires_at);
end;
$$;
create function public.accept_workspace_invitation(p_token_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r private.workspace_invitations; affected integer; current_role text;
begin
  r:=private.invitation_for_me(p_token_hash);
  perform 1 from public.workspaces where id=r.workspace_id for update;
  select * into r from private.workspace_invitations where id=r.id for update;
  r:=private.invitation_for_me(p_token_hash);
  if r.status='accepted' then return jsonb_build_object('workspace_id',r.workspace_id,'already_accepted',true,'membership_created',false); end if;
  insert into public.memberships(workspace_id,user_id,role) values(r.workspace_id,auth.uid(),r.role) on conflict(workspace_id,user_id) do nothing;
  get diagnostics affected = row_count;
  select role into current_role from public.memberships where workspace_id=r.workspace_id and user_id=auth.uid();
  update private.workspace_invitations set status='accepted',accepted_by=auth.uid(),accepted_at=now(),version=version+1,updated_at=now() where id=r.id;
  return jsonb_build_object('workspace_id',r.workspace_id,'role',current_role,'already_accepted',false,'membership_created',affected=1);
end;
$$;

create function private.purge_old_invitations(p_limit integer default 1000) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='1s' as $$
declare receipt_count integer; invitation_count integer;
begin
  if p_limit is null or p_limit not between 1 and 1000 then raise exception 'INVALID_INPUT' using errcode='22023'; end if;
  if not pg_try_advisory_xact_lock(hashtextextended('project-hub:old-invitations',0)) then return jsonb_build_object('skipped',true); end if;
  with expired as (select ctid from private.invitation_requests where expires_at<=statement_timestamp() order by expires_at limit p_limit for update skip locked)
    delete from private.invitation_requests r using expired where r.ctid=expired.ctid;
  get diagnostics receipt_count = row_count;
  with expired as (select id from private.workspace_invitations where expires_at<=statement_timestamp()-interval '30 days' order by expires_at,id limit p_limit for update skip locked)
    delete from private.workspace_invitations i using expired where i.id=expired.id;
  get diagnostics invitation_count = row_count;
  return jsonb_build_object('skipped',false,'requests',receipt_count,'invitations',invitation_count);
end;
$$;

grant create on schema public to project_hub_owner;
do $permissions$
declare f record;
begin
  for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where (n.nspname='private' and p.proname in ('invitation_summary','invitation_for_me','purge_old_invitations'))
       or (n.nspname='public' and p.proname in ('prepare_workspace_invitation','update_workspace_invitation','record_invitation_delivery','list_workspace_invitations','read_workspace_invitation','accept_workspace_invitation')) loop
    execute format('alter function %s owner to project_hub_owner',f.signature);
    execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  end loop;
end;
$permissions$;
grant execute on function public.prepare_workspace_invitation(uuid,text,text,text,text),public.update_workspace_invitation(uuid,uuid,text,integer,text,text),public.record_invitation_delivery(uuid,uuid,integer,text),public.list_workspace_invitations(uuid,integer,timestamptz,uuid),public.read_workspace_invitation(text),public.accept_workspace_invitation(text) to authenticated;
grant execute on function private.purge_old_invitations(integer) to postgres;
revoke create on schema public from project_hub_owner;

do $cron_install$
begin
  if not exists(select 1 from pg_extension where extname='pg_cron') then
    if exists(select 1 from pg_available_extensions where name='pg_cron') and 'pg_cron'=any(regexp_split_to_array(replace(replace(current_setting('shared_preload_libraries'),' ',''),'"',''),',')) then
      execute 'create extension pg_cron with schema pg_catalog';
    else
      raise notice 'pg_cron unavailable or not preloaded: ProjectHub invitations cleanup job was not installed';
      return;
    end if;
  end if;
  if exists(select 1 from cron.job where jobname='project-hub-invitations' and username<>current_user) then raise exception 'Unexpected owner of ProjectHub invitations job'; end if;
  perform cron.schedule('project-hub-invitations','37 * * * *',
    $job$set statement_timeout='30s'; set lock_timeout='1s'; select private.purge_old_invitations(1000); delete from cron.job_run_details where runid in (select h.runid from cron.job_run_details h join cron.job j using(jobid) where j.jobname='project-hub-invitations' and j.username=current_user and h.end_time<statement_timestamp()-interval '7 days' order by h.runid limit 10000);$job$);
end;
$cron_install$;
