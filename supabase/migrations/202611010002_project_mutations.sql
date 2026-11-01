create table private.project_requests (
  workspace_id uuid not null references public.workspaces(id),
  actor_id uuid not null references public.profiles(id),
  request_key text not null check (char_length(request_key) between 1 and 128),
  payload jsonb not null,
  result jsonb not null,
  expires_at timestamptz not null,
  primary key(workspace_id,actor_id,request_key)
);
alter table private.project_requests owner to project_hub_owner;
alter table private.project_requests enable row level security;
revoke all on private.project_requests from public,anon,authenticated;

create function public.create_project_once(p_workspace_id uuid,p_name text,p_description text,p_due_date date,p_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.projects; payload jsonb; previous private.project_requests;
begin
  perform 1 from public.workspaces where id=p_workspace_id for update;
  if not private.is_admin(p_workspace_id) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if p_key is null or char_length(p_key) not between 1 and 128 then raise exception 'INVALID_KEY' using errcode='22023'; end if;
  payload := jsonb_build_object('name',btrim(p_name),'description',p_description,'due_date',p_due_date);
  delete from private.project_requests where workspace_id=p_workspace_id and actor_id=auth.uid() and expires_at <= clock_timestamp();
  select * into previous from private.project_requests where workspace_id=p_workspace_id and actor_id=auth.uid() and request_key=p_key;
  if found then
    if previous.payload <> payload then raise exception 'IDEMPOTENCY_CONFLICT' using errcode='40001'; end if;
    return previous.result;
  end if;
  insert into public.projects(workspace_id,name,description,due_date) values(p_workspace_id,btrim(p_name),p_description,p_due_date) returning * into r;
  insert into private.project_requests values(p_workspace_id,auth.uid(),p_key,payload,to_jsonb(r),clock_timestamp()+interval '24 hours');
  return to_jsonb(r);
end;
$$;

create function public.edit_project(p_workspace_id uuid,p_project_id uuid,p_name text,p_description text,p_status text,p_due_date date,p_version integer) returns public.projects
language plpgsql security definer set search_path='' as $$
declare r public.projects;
begin
  perform 1 from public.workspaces where id=p_workspace_id for update;
  if not private.is_admin(p_workspace_id) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  select * into r from public.projects where workspace_id=p_workspace_id and id=p_project_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  if p_version is null or r.version <> p_version then raise exception 'VERSION_CONFLICT' using errcode='40001'; end if;
  update public.projects set name=btrim(p_name),description=p_description,status=p_status,due_date=p_due_date,version=version+1,updated_at=now()
  where id=p_project_id returning * into r;
  return r;
end;
$$;

-- 既存の専用所有者に移譲するため、作成権限を一時付与する。
grant create on schema public to project_hub_owner;
alter function public.create_project_once(uuid,text,text,date,text) owner to project_hub_owner;
alter function public.edit_project(uuid,uuid,text,text,text,date,integer) owner to project_hub_owner;
revoke create on schema public from project_hub_owner;
revoke all on function public.create_project_once(uuid,text,text,date,text),public.edit_project(uuid,uuid,text,text,text,date,integer) from public,anon,authenticated;
grant execute on function public.create_project_once(uuid,text,text,date,text),public.edit_project(uuid,uuid,text,text,text,date,integer) to authenticated;
