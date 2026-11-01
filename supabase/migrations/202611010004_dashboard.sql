create function private.dashboard_day(p_instant timestamptz) returns date
language sql immutable strict security invoker set search_path='' as $$
  select (p_instant at time zone 'Asia/Tokyo')::date;
$$;
alter function private.dashboard_day(timestamptz) owner to project_hub_owner;
revoke all on function private.dashboard_day(timestamptz) from public,anon,authenticated;
grant execute on function private.dashboard_day(timestamptz) to authenticated;

-- 呼出者のSELECT権限とRLSを維持する。所有者権限で集計しない。
create function public.read_dashboard(p_workspace_id uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare result jsonb; today date:=private.dashboard_day(statement_timestamp());
begin
  if auth.uid() is null or not private.is_member(p_workspace_id) then
    raise exception 'NOT_FOUND' using errcode='P0002';
  end if;
  with eligible_projects as materialized (
    select id,name,status,created_at from public.projects where workspace_id=p_workspace_id and status<>'archived'
  ), eligible_tasks as materialized (
    select t.* from public.tasks t join eligible_projects p on p.id=t.project_id where t.workspace_id=p_workspace_id
  ), progress as (
    select p.id,p.name,p.status,p.created_at,count(t.id) as task_total,count(t.id) filter(where t.status='done') as task_done,
      coalesce(round(100.0*count(t.id) filter(where t.status='done')/nullif(count(t.id),0)),0)::integer as completion_percent
    from eligible_projects p left join eligible_tasks t on t.project_id=p.id group by p.id,p.name,p.status,p.created_at
  )
  select jsonb_build_object(
    'workspace_id',p_workspace_id,'viewer_id',auth.uid(),'as_of',statement_timestamp(),'today',today,
    'metrics',jsonb_build_object(
      'active_projects',(select count(*) from eligible_projects where status='active'),
      'task_total',(select count(*) from eligible_tasks),
      'task_done',(select count(*) from eligible_tasks where status='done'),
      'completion_percent',(select coalesce(round(100.0*count(*) filter(where status='done')/nullif(count(*),0)),0)::integer from eligible_tasks),
      'overdue_tasks',(select count(*) from eligible_tasks where status<>'done' and due_date<today),
      'open_issues',(select count(*) from public.issues i join eligible_projects p on p.id=i.project_id where i.workspace_id=p_workspace_id and i.status in ('open','investigating'))
    ),
    'projects',coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at desc,p.id desc) from (select * from progress order by created_at desc,id desc limit 5) p),'[]'::jsonb),
    'my_tasks',coalesce((select jsonb_agg(to_jsonb(t) order by t.due_date nulls last,t.created_at,t.id) from (
      select t.id,t.title,t.status,t.priority,t.project_id,p.name as project_name,t.due_date,t.created_at
      from eligible_tasks t join eligible_projects p on p.id=t.project_id where t.assignee_id=auth.uid() and t.status<>'done'
      order by t.due_date nulls last,t.created_at,t.id limit 5
    ) t),'[]'::jsonb),
    'recent_activity',coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at desc,a.id desc) from (
      select id,actor_display_name,entity_type,action,created_at from public.activity_logs where workspace_id=p_workspace_id order by created_at desc,id desc limit 5
    ) a),'[]'::jsonb)
  ) into result;
  return result;
end;
$$;
grant create on schema public to project_hub_owner;
alter function public.read_dashboard(uuid) owner to project_hub_owner;
revoke create on schema public from project_hub_owner;
revoke all on function public.read_dashboard(uuid) from public,anon,authenticated;
grant execute on function public.read_dashboard(uuid) to authenticated;
