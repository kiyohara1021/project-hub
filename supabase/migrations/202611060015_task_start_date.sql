alter table public.tasks add column start_date date;
alter table public.tasks add constraint tasks_schedule_dates_check check (
  (start_date is null or start_date between date '0001-01-01' and date '9999-12-31')
  and (due_date is null or due_date between date '0001-01-01' and date '9999-12-31')
  and (start_date is null or due_date is null or start_date<=due_date)
);
create index tasks_gantt_page_idx on public.tasks(workspace_id,project_id,id);

-- 末尾の既定引数により、開始日がなかったクライアントの呼出しを維持する。
drop function public.create_task_once(uuid,uuid,text,text,text,uuid,date,text);
create function public.create_task_once(p_workspace_id uuid,p_project_id uuid,p_title text,p_description text,p_priority text,p_assignee_id uuid,p_due_date date,p_key text,p_start_date date default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.tasks; payload jsonb; previous private.task_requests; last_position bigint;
begin
  perform private.assert_task_writer(p_workspace_id,p_project_id);
  if p_key is null or char_length(p_key) not between 1 and 128 then raise exception 'INVALID_KEY' using errcode='22023'; end if;
  payload := jsonb_build_object('title',btrim(p_title),'description',p_description,'priority',p_priority,'assignee_id',p_assignee_id,'due_date',p_due_date);
  -- 未設定は従来の本文と同じにし、導入前の有効な再送記録も再利用できる。
  if p_start_date is not null then payload := payload || jsonb_build_object('start_date',p_start_date); end if;
  delete from private.task_requests where workspace_id=p_workspace_id and actor_id=auth.uid() and expires_at<=clock_timestamp();
  select * into previous from private.task_requests where workspace_id=p_workspace_id and project_id=p_project_id and actor_id=auth.uid() and request_key=p_key;
  if found then
    if previous.payload<>payload then raise exception 'IDEMPOTENCY_CONFLICT' using errcode='40001'; end if;
    return previous.result;
  end if;
  select coalesce(max(position),0)+1024 into last_position from public.tasks where workspace_id=p_workspace_id and project_id=p_project_id and status='todo';
  insert into public.tasks(workspace_id,project_id,title,description,priority,assignee_id,due_date,start_date,position)
  values(p_workspace_id,p_project_id,btrim(p_title),p_description,p_priority,p_assignee_id,p_due_date,p_start_date,last_position) returning * into r;
  insert into private.task_requests values(p_workspace_id,p_project_id,auth.uid(),p_key,payload,to_jsonb(r),clock_timestamp()+interval '24 hours');
  return to_jsonb(r);
end;
$$;

drop function public.edit_task(uuid,uuid,uuid,text,text,text,uuid,date,integer);
create function public.edit_task(p_workspace_id uuid,p_project_id uuid,p_task_id uuid,p_title text,p_description text,p_priority text,p_assignee_id uuid,p_due_date date,p_version integer,p_start_date date default null,p_schedule_provided boolean default false) returns public.tasks
language plpgsql security definer set search_path='' as $$
declare r public.tasks;
begin
  perform private.assert_task_writer(p_workspace_id,p_project_id);
  select * into r from public.tasks where workspace_id=p_workspace_id and project_id=p_project_id and id=p_task_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  if p_version is null or r.version<>p_version then raise exception 'VERSION_CONFLICT' using errcode='40001'; end if;
  update public.tasks set title=btrim(p_title),description=p_description,priority=p_priority,assignee_id=p_assignee_id,due_date=p_due_date,
    start_date=case when p_schedule_provided or p_start_date is not null then p_start_date else start_date end,
    version=version+1,updated_at=now()
  where id=p_task_id returning * into r;
  return r;
end;
$$;
grant create on schema public to project_hub_owner;
alter function public.create_task_once(uuid,uuid,text,text,text,uuid,date,text,date) owner to project_hub_owner;
alter function public.edit_task(uuid,uuid,uuid,text,text,text,uuid,date,integer,date,boolean) owner to project_hub_owner;
revoke create on schema public from project_hub_owner;
revoke all on function public.create_task_once(uuid,uuid,text,text,text,uuid,date,text,date),public.edit_task(uuid,uuid,uuid,text,text,text,uuid,date,integer,date,boolean) from public,anon,authenticated;
grant execute on function public.create_task_once(uuid,uuid,text,text,text,uuid,date,text,date),public.edit_task(uuid,uuid,uuid,text,text,text,uuid,date,integer,date,boolean) to authenticated;
