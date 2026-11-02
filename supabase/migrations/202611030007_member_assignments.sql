-- 読取は呼出者のSELECT権限・RLSのまま。行取得上限より前にDB内で担当数を集計する。
create function public.read_members(
  p_workspace_id uuid, p_role text default null, p_cursor uuid default null, p_limit integer default 25
) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
  if auth.uid() is null or not private.is_member(p_workspace_id) then
    raise exception 'NOT_FOUND' using errcode='P0002';
  end if;
  if p_limit is null or p_limit<1 or p_limit>100 or (p_role is not null and p_role not in ('admin','member','viewer')) then
    raise exception 'INVALID_INPUT' using errcode='22023';
  end if;
  with candidates as materialized (
    select m.user_id,m.role,m.version,m.joined_at,p.display_name
    from public.memberships m join public.profiles p on p.id=m.user_id
    where m.workspace_id=p_workspace_id and (p_role is null or m.role::text=p_role)
      and (p_cursor is null or m.user_id>p_cursor)
    order by m.user_id limit p_limit+1
  ), page as materialized (
    select * from candidates order by user_id limit p_limit
  ), counted as (
    select m.user_id,m.role,m.version,m.joined_at,jsonb_build_object('display_name',m.display_name) as profiles,
      (select count(*) from public.tasks t join public.projects p on p.id=t.project_id and p.workspace_id=t.workspace_id
       where t.workspace_id=p_workspace_id and t.assignee_id=m.user_id and t.status in ('todo','doing','review') and p.status in ('planned','active')) as task_count,
      (select count(*) from public.issues i join public.projects p on p.id=i.project_id and p.workspace_id=i.workspace_id
       where i.workspace_id=p_workspace_id and i.assignee_id=m.user_id and i.status in ('open','investigating') and p.status in ('planned','active')) as issue_count
    from page m
  )
  select jsonb_build_object(
    'data',coalesce((select jsonb_agg(to_jsonb(m) order by m.user_id) from counted m),'[]'::jsonb),
    'nextCursor',case when (select count(*) from candidates)>p_limit then (select user_id from page order by user_id desc limit 1) else null end
  ) into result;
  return result;
end;
$$;
grant create on schema public to project_hub_owner;
alter function public.read_members(uuid,text,uuid,integer) owner to project_hub_owner;
revoke create on schema public from project_hub_owner;
revoke all on function public.read_members(uuid,text,uuid,integer) from public,anon,authenticated;
grant execute on function public.read_members(uuid,text,uuid,integer) to authenticated;
