create table private.issue_requests (
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
alter table private.issue_requests owner to project_hub_owner;
alter table private.issue_requests enable row level security;
revoke all on private.issue_requests from public,anon,authenticated;
create index issues_cursor_idx on public.issues(workspace_id,project_id,created_at desc,id desc);

-- タスクと課題は同じ親ロック・所属・ロール・アーカイブ判定を共用する。
create function public.create_issue_once(p_workspace_id uuid,p_project_id uuid,p_title text,p_description text,p_priority text,p_assignee_id uuid,p_due_date date,p_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.issues; payload jsonb; previous private.issue_requests;
begin
  perform private.assert_task_writer(p_workspace_id,p_project_id);
  if p_key is null or char_length(p_key) not between 1 and 128 then raise exception 'INVALID_KEY' using errcode='22023'; end if;
  payload:=jsonb_build_object('title',btrim(p_title),'description',p_description,'priority',p_priority,'assignee_id',p_assignee_id,'due_date',p_due_date);
  delete from private.issue_requests where workspace_id=p_workspace_id and actor_id=auth.uid() and expires_at<=clock_timestamp();
  select * into previous from private.issue_requests where workspace_id=p_workspace_id and project_id=p_project_id and actor_id=auth.uid() and request_key=p_key;
  if found then
    if previous.payload<>payload then raise exception 'IDEMPOTENCY_CONFLICT' using errcode='40001'; end if;
    return previous.result;
  end if;
  insert into public.issues(workspace_id,project_id,title,description,priority,assignee_id,due_date)
    values(p_workspace_id,p_project_id,btrim(p_title),p_description,p_priority,p_assignee_id,p_due_date) returning * into r;
  insert into private.issue_requests values(p_workspace_id,p_project_id,auth.uid(),p_key,payload,to_jsonb(r),clock_timestamp()+interval '24 hours');
  return to_jsonb(r);
end;
$$;

create function public.edit_issue(p_workspace_id uuid,p_project_id uuid,p_issue_id uuid,p_title text,p_description text,p_status text,p_priority text,p_assignee_id uuid,p_due_date date,p_version integer) returns public.issues
language plpgsql security definer set search_path='' as $$
declare r public.issues;
begin
  perform private.assert_task_writer(p_workspace_id,p_project_id);
  select * into r from public.issues where workspace_id=p_workspace_id and project_id=p_project_id and id=p_issue_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  if p_version is null or r.version<>p_version then raise exception 'VERSION_CONFLICT' using errcode='40001'; end if;
  update public.issues set title=btrim(p_title),description=p_description,status=p_status,priority=p_priority,assignee_id=p_assignee_id,due_date=p_due_date,version=version+1,updated_at=now()
    where id=p_issue_id returning * into r;
  return r;
end;
$$;

create function public.delete_issue(p_workspace_id uuid,p_project_id uuid,p_issue_id uuid,p_version integer) returns void
language plpgsql security definer set search_path='' as $$
declare r public.issues;
begin
  perform private.assert_task_writer(p_workspace_id,p_project_id);
  select * into r from public.issues where workspace_id=p_workspace_id and project_id=p_project_id and id=p_issue_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  if p_version is null or r.version<>p_version then raise exception 'VERSION_CONFLICT' using errcode='40001'; end if;
  delete from public.issues where id=p_issue_id;
end;
$$;

grant create on schema public to project_hub_owner;
alter function public.create_issue_once(uuid,uuid,text,text,text,uuid,date,text) owner to project_hub_owner;
alter function public.edit_issue(uuid,uuid,uuid,text,text,text,text,uuid,date,integer) owner to project_hub_owner;
alter function public.delete_issue(uuid,uuid,uuid,integer) owner to project_hub_owner;
revoke create on schema public from project_hub_owner;
revoke all on function public.create_issue_once(uuid,uuid,text,text,text,uuid,date,text),public.edit_issue(uuid,uuid,uuid,text,text,text,text,uuid,date,integer),public.delete_issue(uuid,uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.create_issue_once(uuid,uuid,text,text,text,uuid,date,text),public.edit_issue(uuid,uuid,uuid,text,text,text,text,uuid,date,integer),public.delete_issue(uuid,uuid,uuid,integer) to authenticated;
