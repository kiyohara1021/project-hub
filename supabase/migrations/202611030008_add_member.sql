create table private.member_requests (
  workspace_id uuid not null references public.workspaces(id),
  actor_id uuid not null references public.profiles(id),
  request_key text not null,
  payload jsonb not null,
  response jsonb not null,
  expires_at timestamptz not null,
  primary key(workspace_id,actor_id,request_key)
);
alter table private.member_requests owner to project_hub_owner;
alter table private.member_requests enable row level security;
revoke all on private.member_requests from public,anon,authenticated;

create function public.add_member_once(p_workspace_id uuid,p_user_id uuid,p_role text,p_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare previous private.member_requests; result jsonb; current_member public.memberships; payload jsonb;
begin
  perform 1 from public.workspaces where id=p_workspace_id for update;
  if not private.is_admin(p_workspace_id) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if p_user_id is null or p_role is null or p_role not in ('admin','member','viewer') or p_key is null or p_key !~ '^[A-Za-z0-9_-]{1,128}$'
    then raise exception 'INVALID_INPUT' using errcode='22023'; end if;
  payload := jsonb_build_object('user_id',p_user_id,'role',p_role);
  delete from private.member_requests where workspace_id=p_workspace_id and actor_id=auth.uid() and expires_at<=clock_timestamp();
  select * into previous from private.member_requests where workspace_id=p_workspace_id and actor_id=auth.uid() and request_key=p_key;
  if found then
    if previous.payload<>payload then raise exception 'IDEMPOTENCY_CONFLICT' using errcode='40001'; end if;
    return previous.response;
  end if;
  if not exists(select 1 from public.profiles where id=p_user_id) then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  if exists(select 1 from public.memberships where workspace_id=p_workspace_id and user_id=p_user_id) then raise exception 'ALREADY_MEMBER' using errcode='23505'; end if;
  insert into public.memberships(workspace_id,user_id,role) values(p_workspace_id,p_user_id,p_role) returning * into current_member;
  result := jsonb_build_object('user_id',current_member.user_id,'role',current_member.role,'version',current_member.version,'joined_at',current_member.joined_at);
  insert into private.member_requests values(p_workspace_id,auth.uid(),p_key,payload,result,clock_timestamp()+interval '24 hours');
  return result;
end; $$;
grant create on schema public to project_hub_owner;
alter function public.add_member_once(uuid,uuid,text,text) owner to project_hub_owner;
revoke create on schema public from project_hub_owner;
revoke all on function public.add_member_once(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.add_member_once(uuid,uuid,text,text) to authenticated;
