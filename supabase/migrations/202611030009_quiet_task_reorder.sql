-- 並び順は利用者が編集する項目ではない。振り直しで他のタスクのversionを上げず、履歴にも残さない。
-- position以外が同じUPDATEは記録しない（移動したタスク自身は状態・versionが変わるので記録される）。
create or replace function private.record_activity() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  r jsonb; before_row jsonb; after_row jsonb; wid uuid; eid uuid;
begin
  if tg_op = 'UPDATE' and (to_jsonb(old) - 'position') = (to_jsonb(new) - 'position') then return new; end if;
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

-- 振り直しは今までどおり1024刻み。移動したタスクだけversionとupdated_atを更新する。
create or replace function public.move_task(p_workspace_id uuid,p_project_id uuid,p_task_id uuid,p_status text,p_before_id uuid,p_version integer) returns public.tasks
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
    if item=p_task_id then
      update public.tasks set status=p_status,position=rank,version=version+1,updated_at=now() where id=item;
    else
      update public.tasks set position=rank where id=item and position<>rank;
    end if;
  end loop;
  select * into r from public.tasks where id=p_task_id;
  return r;
end;
$$;
