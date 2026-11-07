-- 認証サービスの検証済みユーザーだけをアプリの所属作成主体とする。
create or replace function private.new_profile() returns trigger
language plpgsql security definer set search_path='' as $$
declare label text := btrim(new.raw_user_meta_data->>'display_name');
begin
  if label is null or char_length(label) not between 1 and 80 then label := '新しいメンバー'; end if;
  insert into public.profiles(id,display_name) values(new.id,label);
  return new;
end;
$$;

create table private.workspace_requests (
  workspace_id uuid not null references public.workspaces(id),
  actor_id uuid not null references public.profiles(id),
  request_key text not null check (request_key ~ '^[A-Za-z0-9_-]{1,128}$'),
  payload jsonb not null,
  result jsonb not null,
  expires_at timestamptz not null,
  primary key(actor_id,request_key)
);
alter table private.workspace_requests owner to project_hub_owner;
alter table private.workspace_requests enable row level security;
revoke all on private.workspace_requests from public,anon,authenticated,service_role;
create index workspace_requests_expiry_cleanup_idx on private.workspace_requests(expires_at);
create index workspace_requests_actor_cleanup_idx on private.workspace_requests(actor_id,expires_at);

create function public.create_workspace_once(p_name text,p_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare previous private.workspace_requests; payload jsonb; r public.workspaces;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
  if p_name is null or char_length(btrim(p_name)) not between 1 and 120 then raise exception 'INVALID_INPUT' using errcode='22023'; end if;
  if p_key is null or p_key !~ '^[A-Za-z0-9_-]{1,128}$' then raise exception 'INVALID_KEY' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('workspace-create:'||auth.uid()::text,0));
  payload := jsonb_build_object('name',btrim(p_name));
  delete from private.workspace_requests where actor_id=auth.uid() and expires_at<=clock_timestamp();
  select * into previous from private.workspace_requests where actor_id=auth.uid() and request_key=p_key;
  if found then
    if not private.is_member(previous.workspace_id) then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
    if previous.payload<>payload then raise exception 'IDEMPOTENCY_CONFLICT' using errcode='40001'; end if;
    return previous.result;
  end if;
  insert into public.workspaces(name) values(btrim(p_name)) returning * into r;
  insert into public.memberships(workspace_id,user_id,role) values(r.id,auth.uid(),'admin');
  insert into private.workspace_requests values(r.id,auth.uid(),p_key,payload,to_jsonb(r),clock_timestamp()+interval '24 hours');
  return to_jsonb(r);
end;
$$;
grant create on schema public to project_hub_owner;
alter function public.create_workspace_once(text,text) owner to project_hub_owner;
revoke create on schema public from project_hub_owner;
revoke all on function public.create_workspace_once(text,text) from public,anon,authenticated,service_role;
grant execute on function public.create_workspace_once(text,text) to authenticated;

-- ワークスペース作成の再送記録も既存の定期削除へ含める。
create or replace function private.purge_expired_requests(p_limit integer default 1000) returns jsonb
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
  foreach target in array array['project_requests','task_requests','issue_requests','member_requests','comment_requests','workspace_requests'] loop
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
