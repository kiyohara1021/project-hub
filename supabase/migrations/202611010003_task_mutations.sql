create table private.task_requests (
  workspace_id uuid not null,
  project_id uuid not null,
  actor_id uuid not null references public.profiles(id),
  request_key text not null check(char_length(request_key) between 1 and 128),
  payload jsonb not null,
  result jsonb not null,
  expires_at timestamptz not null,
  primary key(workspace_id,project_id,actor_id,request_key),
  foreign key(workspace_id,project_id) references public.projects(workspace_id,id)
);
alter table private.task_requests owner to project_hub_owner;
alter table private.task_requests enable row level security;
revoke all on private.task_requests from public,anon,authenticated;

create function private.assert_task_writer(wid uuid,pid uuid) returns void
language plpgsql security definer set search_path='' as $$
declare project_status text;
begin
  perform 1 from public.workspaces where id=wid for update;
  if auth.uid() is null or not exists(select 1 from public.memberships where workspace_id=wid and user_id=auth.uid() and role in ('admin','member'))
    then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  select status into project_status from public.projects where workspace_id=wid and id=pid for update;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  if project_status='archived' then raise exception 'PROJECT_ARCHIVED' using errcode='55000'; end if;
end;
$$;

create function public.create_task_once(p_workspace_id uuid,p_project_id uuid,p_title text,p_description text,p_priority text,p_assignee_id uuid,p_due_date date,p_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.tasks; payload jsonb; previous private.task_requests; last_position bigint;
begin
  perform private.assert_task_writer(p_workspace_id,p_project_id);
  if p_key is null or char_length(p_key) not between 1 and 128 then raise exception 'INVALID_KEY' using errcode='22023'; end if;
  payload := jsonb_build_object('title',btrim(p_title),'description',p_description,'priority',p_priority,'assignee_id',p_assignee_id,'due_date',p_due_date);
  delete from private.task_requests where workspace_id=p_workspace_id and actor_id=auth.uid() and expires_at<=clock_timestamp();
  select * into previous from private.task_requests where workspace_id=p_workspace_id and project_id=p_project_id and actor_id=auth.uid() and request_key=p_key;
  if found then
    if previous.payload<>payload then raise exception 'IDEMPOTENCY_CONFLICT' using errcode='40001'; end if;
    return previous.result;
  end if;
  select coalesce(max(position),0)+1024 into last_position from public.tasks where workspace_id=p_workspace_id and project_id=p_project_id and status='todo';
  insert into public.tasks(workspace_id,project_id,title,description,priority,assignee_id,due_date,position)
  values(p_workspace_id,p_project_id,btrim(p_title),p_description,p_priority,p_assignee_id,p_due_date,last_position) returning * into r;
  insert into private.task_requests values(p_workspace_id,p_project_id,auth.uid(),p_key,payload,to_jsonb(r),clock_timestamp()+interval '24 hours');
  return to_jsonb(r);
end;
$$;

create function public.edit_task(p_workspace_id uuid,p_project_id uuid,p_task_id uuid,p_title text,p_description text,p_priority text,p_assignee_id uuid,p_due_date date,p_version integer) returns public.tasks
language plpgsql security definer set search_path='' as $$
declare r public.tasks;
begin
  perform private.assert_task_writer(p_workspace_id,p_project_id);
  select * into r from public.tasks where workspace_id=p_workspace_id and project_id=p_project_id and id=p_task_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  if p_version is null or r.version<>p_version then raise exception 'VERSION_CONFLICT' using errcode='40001'; end if;
  update public.tasks set title=btrim(p_title),description=p_description,priority=p_priority,assignee_id=p_assignee_id,due_date=p_due_date,version=version+1,updated_at=now()
  where id=p_task_id returning * into r;
  return r;
end;
$$;

create function public.delete_task(p_workspace_id uuid,p_project_id uuid,p_task_id uuid,p_version integer) returns void
language plpgsql security definer set search_path='' as $$
declare r public.tasks;
begin
  perform private.assert_task_writer(p_workspace_id,p_project_id);
  select * into r from public.tasks where workspace_id=p_workspace_id and project_id=p_project_id and id=p_task_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  if p_version is null or r.version<>p_version then raise exception 'VERSION_CONFLICT' using errcode='40001'; end if;
  delete from public.tasks where id=p_task_id;
end;
$$;

create function public.move_task(p_workspace_id uuid,p_project_id uuid,p_task_id uuid,p_status text,p_before_id uuid,p_version integer) returns public.tasks
language plpgsql security definer set search_path='' as $$
declare r public.tasks; ids uuid[]; insertion integer; item uuid; rank bigint:=0;
begin
  perform private.assert_task_writer(p_workspace_id,p_project_id);
  select * into r from public.tasks where workspace_id=p_workspace_id and project_id=p_project_id and id=p_task_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  if p_version is null or r.version<>p_version then raise exception 'VERSION_CONFLICT' using errcode='40001'; end if;
  if p_status is null or p_status not in ('todo','doing','review','done') or p_before_id=p_task_id then raise exception 'INVALID_MOVE' using errcode='22023'; end if;
  select coalesce(array_agg(id order by position,id),'{}'::uuid[]) into ids from public.tasks
    where workspace_id=p_workspace_id and project_id=p_project_id and status=p_status and id<>p_task_id;
  if p_before_id is null then ids:=array_append(ids,p_task_id);
  else
    insertion:=array_position(ids,p_before_id);
    if insertion is null then raise exception 'INVALID_MOVE' using errcode='22023'; end if;
    ids:=coalesce(ids[1:insertion-1],'{}'::uuid[])||array[p_task_id]||ids[insertion:];
  end if;
  foreach item in array ids loop
    rank:=rank+1024;
    update public.tasks set status=p_status,position=rank,version=version+1,updated_at=now()
      where id=item and (id=p_task_id or position<>rank);
  end loop;
  select * into r from public.tasks where id=p_task_id;
  return r;
end;
$$;

grant create on schema public to project_hub_owner;
alter function private.assert_task_writer(uuid,uuid) owner to project_hub_owner;
alter function public.create_task_once(uuid,uuid,text,text,text,uuid,date,text) owner to project_hub_owner;
alter function public.edit_task(uuid,uuid,uuid,text,text,text,uuid,date,integer) owner to project_hub_owner;
alter function public.delete_task(uuid,uuid,uuid,integer) owner to project_hub_owner;
alter function public.move_task(uuid,uuid,uuid,text,uuid,integer) owner to project_hub_owner;
revoke create on schema public from project_hub_owner;
revoke all on function private.assert_task_writer(uuid,uuid) from public,anon,authenticated;
revoke all on function public.create_task_once(uuid,uuid,text,text,text,uuid,date,text),public.edit_task(uuid,uuid,uuid,text,text,text,uuid,date,integer),public.delete_task(uuid,uuid,uuid,integer),public.move_task(uuid,uuid,uuid,text,uuid,integer) from public,anon,authenticated;
grant execute on function public.create_task_once(uuid,uuid,text,text,text,uuid,date,text),public.edit_task(uuid,uuid,uuid,text,text,text,uuid,date,integer),public.delete_task(uuid,uuid,uuid,integer),public.move_task(uuid,uuid,uuid,text,uuid,integer) to authenticated;
