grant create on schema public to project_hub_owner;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('project-attachments','project-attachments',false,3145728,array['image/png','image/jpeg','image/webp','application/pdf','text/plain'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

-- 物理オブジェクトの台帳は親の削除後も残し、Storage APIで回収してから消す。
create table private.attachment_objects (
  id uuid primary key default gen_random_uuid(),
  object_path text not null unique,
  workspace_id uuid not null,
  project_id uuid not null,
  task_id uuid,
  issue_id uuid,
  uploader_id uuid not null,
  request_key text not null check(request_key ~ '^[A-Za-z0-9_-]{1,128}$'),
  file_name text not null,
  content_type text not null,
  size_bytes integer not null,
  sha256 text not null,
  state text not null default 'pending' check(state in ('pending','ready','deleting')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now()+interval '1 hour',
  retry_after timestamptz not null default now(),
  check(object_path=id::text),
  check((task_id is null)<>(issue_id is null)),
  unique(workspace_id,project_id,uploader_id,request_key)
);
alter table private.attachment_objects owner to project_hub_owner;
alter table private.attachment_objects enable row level security;
revoke all on private.attachment_objects from public,anon,authenticated,service_role;
create index attachment_cleanup_idx on private.attachment_objects(state,retry_after,expires_at);

create table public.attachments (
  id uuid primary key references private.attachment_objects(id),
  workspace_id uuid not null,
  project_id uuid not null,
  task_id uuid references public.tasks(id) on delete cascade,
  issue_id uuid references public.issues(id) on delete cascade,
  uploader_id uuid not null,
  file_name text not null check(char_length(file_name) between 1 and 180 and file_name !~ '[[:cntrl:]]' and position('/' in file_name)=0 and position(chr(92) in file_name)=0),
  content_type text not null check(content_type in ('image/png','image/jpeg','image/webp','application/pdf','text/plain')),
  size_bytes integer not null check(size_bytes between 1 and 3145728),
  sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
  state text not null default 'pending' check(state in ('pending','ready')),
  created_at timestamptz not null default now(),
  check((task_id is null)<>(issue_id is null)),
  foreign key(workspace_id,project_id) references public.projects(workspace_id,id) on delete cascade
);
alter table public.attachments owner to project_hub_owner;
alter table public.attachments enable row level security;
revoke all on public.attachments from public,anon,authenticated;
grant select on public.attachments to authenticated;
create index attachments_task_idx on public.attachments(workspace_id,project_id,task_id);
create index attachments_issue_idx on public.attachments(workspace_id,project_id,issue_id);

create function private.attachment_parent_exists(wid uuid,pid uuid,tid uuid,iid uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select case when tid is not null and iid is null then exists(select 1 from public.tasks where workspace_id=wid and project_id=pid and id=tid)
    when iid is not null and tid is null then exists(select 1 from public.issues where workspace_id=wid and project_id=pid and id=iid) else false end;
$$;
create function private.attachment_readable(wid uuid,pid uuid,tid uuid,iid uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select private.can_read_project(wid,pid) and private.attachment_parent_exists(wid,pid,tid,iid);
$$;
create function private.attachment_writable(wid uuid,pid uuid,tid uuid,iid uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select private.attachment_readable(wid,pid,tid,iid)
    and exists(select 1 from public.projects where workspace_id=wid and id=pid and status<>'archived')
    and exists(select 1 from public.memberships where workspace_id=wid and user_id=auth.uid() and role in ('admin','member'));
$$;
create function private.attachment_storage_access(object_name text,write_mode boolean default false) returns boolean
language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and exists(
    select 1 from private.attachment_objects l where l.object_path=object_name and (
      (not write_mode and l.state='ready' and private.attachment_readable(l.workspace_id,l.project_id,l.task_id,l.issue_id))
      or (l.state='pending' and l.uploader_id=auth.uid() and l.expires_at>statement_timestamp() and private.attachment_writable(l.workspace_id,l.project_id,l.task_id,l.issue_id))
      or (not write_mode and l.state='deleting' and (l.uploader_id=auth.uid() or private.is_admin(l.workspace_id)) and private.attachment_writable(l.workspace_id,l.project_id,l.task_id,l.issue_id))
    )
  );
$$;
create function private.attachment_storage_deletable(object_name text) returns boolean
language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and exists(select 1 from private.attachment_objects l
    where l.object_path=object_name and l.state='deleting' and (l.uploader_id=auth.uid() or private.is_admin(l.workspace_id))
      and private.attachment_writable(l.workspace_id,l.project_id,l.task_id,l.issue_id));
$$;
create policy attachments_read on public.attachments for select to authenticated
  using(state='ready' and private.attachment_readable(workspace_id,project_id,task_id,issue_id));
create policy attachment_objects_read on storage.objects for select to authenticated
  using(bucket_id='project-attachments' and private.attachment_storage_access(name));
create policy attachment_objects_upload on storage.objects for insert to authenticated
  with check(bucket_id='project-attachments' and private.attachment_storage_access(name,true));
create policy attachment_objects_delete on storage.objects for delete to authenticated
  using(bucket_id='project-attachments' and private.attachment_storage_deletable(name));
-- ログイン不可の関数所有者だけが、公開前・削除待ちのStorageメタデータも照合する。
grant usage on schema storage to project_hub_owner;
grant select on storage.objects to project_hub_owner;
create policy attachment_owner_inspect on storage.objects for select to project_hub_owner using(bucket_id='project-attachments');

create function public.reserve_attachment(p_workspace_id uuid,p_project_id uuid,p_kind text,p_target_id uuid,p_file_name text,p_content_type text,p_size_bytes integer,p_sha256 text,p_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare l private.attachment_objects; r public.attachments; new_id uuid:=gen_random_uuid(); tid uuid; iid uuid;
begin
  perform private.assert_task_writer(p_workspace_id,p_project_id);
  if p_kind='task' then
    tid:=p_target_id;
    perform 1 from public.tasks where workspace_id=p_workspace_id and project_id=p_project_id and id=tid for update;
  elsif p_kind='issue' then
    iid:=p_target_id;
    perform 1 from public.issues where workspace_id=p_workspace_id and project_id=p_project_id and id=iid for update;
  else raise exception 'INVALID_INPUT' using errcode='22023'; end if;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  if p_key is null or p_key !~ '^[A-Za-z0-9_-]{1,128}$' or p_file_name is null or char_length(p_file_name) not between 1 and 180
    or p_file_name ~ '[[:cntrl:]]' or position('/' in p_file_name)>0 or position(chr(92) in p_file_name)>0
    or p_content_type is null or p_content_type not in ('image/png','image/jpeg','image/webp','application/pdf','text/plain')
    or p_size_bytes is null or p_size_bytes not between 1 and 3145728 or p_sha256 is null or p_sha256 !~ '^[a-f0-9]{64}$'
    or not (case p_content_type when 'image/png' then p_file_name ~* '\.png$' when 'image/jpeg' then p_file_name ~* '\.jpe?g$'
      when 'image/webp' then p_file_name ~* '\.webp$' when 'application/pdf' then p_file_name ~* '\.pdf$' when 'text/plain' then p_file_name ~* '\.txt$' else false end)
    then raise exception 'INVALID_INPUT' using errcode='22023'; end if;
  select * into l from private.attachment_objects where workspace_id=p_workspace_id and project_id=p_project_id and uploader_id=auth.uid() and request_key=p_key for update;
  if found then
    if l.task_id is distinct from tid or l.issue_id is distinct from iid or l.file_name<>p_file_name or l.content_type<>p_content_type or l.size_bytes<>p_size_bytes or l.sha256<>p_sha256 or l.state='deleting' or (l.state='pending' and l.expires_at<=statement_timestamp())
      then raise exception 'IDEMPOTENCY_CONFLICT' using errcode='40001'; end if;
    select * into r from public.attachments where id=l.id;
    if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
    return to_jsonb(r);
  end if;
  if (select count(*) from public.attachments where workspace_id=p_workspace_id and project_id=p_project_id and task_id is not distinct from tid and issue_id is not distinct from iid)>=20
    then raise exception 'ATTACHMENT_LIMIT' using errcode='54000'; end if;
  insert into private.attachment_objects(id,object_path,workspace_id,project_id,task_id,issue_id,uploader_id,request_key,file_name,content_type,size_bytes,sha256)
    values(new_id,new_id::text,p_workspace_id,p_project_id,tid,iid,auth.uid(),p_key,p_file_name,p_content_type,p_size_bytes,p_sha256);
  insert into public.attachments(id,workspace_id,project_id,task_id,issue_id,uploader_id,file_name,content_type,size_bytes,sha256)
    values(new_id,p_workspace_id,p_project_id,tid,iid,auth.uid(),p_file_name,p_content_type,p_size_bytes,p_sha256) returning * into r;
  return to_jsonb(r);
end;
$$;
create function public.finalize_attachment(p_id uuid) returns public.attachments
language plpgsql security definer set search_path='' as $$
declare r public.attachments; l private.attachment_objects; object_metadata jsonb;
begin
  select * into r from public.attachments where id=p_id;
  if not found or r.uploader_id is distinct from auth.uid() then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  perform private.assert_task_writer(r.workspace_id,r.project_id);
  select * into r from public.attachments where id=p_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  if not private.attachment_parent_exists(r.workspace_id,r.project_id,r.task_id,r.issue_id) then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  select * into l from private.attachment_objects where id=p_id for update;
  if l.state='ready' then return r; end if;
  if l.state<>'pending' or l.expires_at<=statement_timestamp() then raise exception 'UPLOAD_EXPIRED' using errcode='22023'; end if;
  select metadata into object_metadata from storage.objects where bucket_id='project-attachments' and name=l.object_path;
  if not found or object_metadata->>'size' is distinct from r.size_bytes::text or object_metadata->>'mimetype' is distinct from r.content_type then raise exception 'INVALID_UPLOAD' using errcode='22023'; end if;
  update private.attachment_objects set state='ready' where id=p_id;
  update public.attachments set state='ready' where id=p_id returning * into r;
  return r;
end;
$$;
create function public.remove_attachment(p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare r public.attachments;
begin
  select * into r from public.attachments where id=p_id;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  perform private.assert_task_writer(r.workspace_id,r.project_id);
  if not private.attachment_parent_exists(r.workspace_id,r.project_id,r.task_id,r.issue_id) then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  if r.uploader_id is distinct from auth.uid() and not private.is_admin(r.workspace_id) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  delete from public.attachments where id=p_id;
end;
$$;
create function public.finish_attachment_removal(p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare l private.attachment_objects;
begin
  select * into l from private.attachment_objects where id=p_id for update;
  if not found then return; end if;
  perform private.assert_task_writer(l.workspace_id,l.project_id);
  if l.state<>'deleting' or not private.attachment_parent_exists(l.workspace_id,l.project_id,l.task_id,l.issue_id)
    or (l.uploader_id is distinct from auth.uid() and not private.is_admin(l.workspace_id)) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if exists(select 1 from storage.objects where bucket_id='project-attachments' and name=l.object_path) then raise exception 'DELETE_PENDING' using errcode='22023'; end if;
  delete from private.attachment_objects where id=p_id;
end;
$$;
create function private.record_attachment_change() returns trigger
language plpgsql security definer set search_path='' as $$
declare r public.attachments; verb text;
begin
  if tg_op='DELETE' then
    r:=old;
    update private.attachment_objects set state='deleting',retry_after=statement_timestamp() where id=old.id;
    if old.state<>'ready' then return old; end if;
    verb:='DELETE';
  else
    if old.state<>'pending' or new.state<>'ready' then return new; end if;
    r:=new; verb:='INSERT';
  end if;
  insert into public.activity_logs(workspace_id,project_id,actor_id,actor_display_name,entity_type,entity_id,action,changes)
    values(r.workspace_id,r.project_id,auth.uid(),coalesce((select display_name from public.profiles where id=auth.uid()),'管理処理'),'attachments',r.id,verb,'{"before":{},"after":{}}'::jsonb);
  return coalesce(new,old);
end;
$$;
create trigger attachment_changes after update or delete on public.attachments for each row execute function private.record_attachment_change();

create function private.attachment_cleanup_batch(p_limit integer default 100) returns table(id uuid,object_path text)
language plpgsql security definer set search_path='' set lock_timeout='1s' as $$
declare candidate record; l private.attachment_objects;
begin
  if p_limit is null or p_limit not between 1 and 1000 then raise exception 'INVALID_INPUT' using errcode='22023'; end if;
  for candidate in select o.id from private.attachment_objects o where o.retry_after<=statement_timestamp() and (o.state='deleting' or (o.state='pending' and o.expires_at<=statement_timestamp())) order by o.retry_after,o.id limit p_limit loop
    -- 公開確定・親削除と同じmetadata→ledger順でロックし、送信中の行を待たない。
    perform 1 from public.attachments a where a.id=candidate.id for update skip locked;
    if not found and exists(select 1 from public.attachments a where a.id=candidate.id) then continue; end if;
    select * into l from private.attachment_objects o where o.id=candidate.id and o.retry_after<=statement_timestamp()
      and (o.state='deleting' or (o.state='pending' and o.expires_at<=statement_timestamp())) for update skip locked;
    if not found then continue; end if;
    delete from public.attachments a where a.id=l.id;
    update private.attachment_objects o set state='deleting',retry_after=statement_timestamp()+interval '5 minutes' where o.id=l.id;
    id:=l.id; object_path:=l.object_path; return next;
  end loop;
end;
$$;
create function private.complete_attachment_cleanup(p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.attachments where id=p_id) then raise exception 'ATTACHMENT_STILL_ACTIVE' using errcode='22023'; end if;
  if exists(select 1 from storage.objects where bucket_id='project-attachments' and name=p_id::text) then raise exception 'DELETE_PENDING' using errcode='22023'; end if;
  delete from private.attachment_objects where id=p_id and state='deleting';
end;
$$;

alter function public.reserve_attachment(uuid,uuid,text,uuid,text,text,integer,text,text) owner to project_hub_owner;
alter function public.finalize_attachment(uuid) owner to project_hub_owner;
alter function public.remove_attachment(uuid) owner to project_hub_owner;
alter function public.finish_attachment_removal(uuid) owner to project_hub_owner;
revoke create on schema public from project_hub_owner;
alter function private.attachment_parent_exists(uuid,uuid,uuid,uuid) owner to project_hub_owner;
alter function private.attachment_readable(uuid,uuid,uuid,uuid) owner to project_hub_owner;
alter function private.attachment_writable(uuid,uuid,uuid,uuid) owner to project_hub_owner;
alter function private.attachment_storage_access(text,boolean) owner to project_hub_owner;
alter function private.attachment_storage_deletable(text) owner to project_hub_owner;
alter function private.record_attachment_change() owner to project_hub_owner;
alter function private.attachment_cleanup_batch(integer) owner to project_hub_owner;
alter function private.complete_attachment_cleanup(uuid) owner to project_hub_owner;
revoke all on function private.attachment_parent_exists(uuid,uuid,uuid,uuid),private.attachment_readable(uuid,uuid,uuid,uuid),private.attachment_writable(uuid,uuid,uuid,uuid),private.attachment_storage_access(text,boolean),private.attachment_storage_deletable(text),private.record_attachment_change(),private.attachment_cleanup_batch(integer),private.complete_attachment_cleanup(uuid) from public,anon,authenticated,service_role;
grant execute on function private.attachment_readable(uuid,uuid,uuid,uuid),private.attachment_storage_access(text,boolean),private.attachment_storage_deletable(text) to authenticated;
grant execute on function private.attachment_cleanup_batch(integer),private.complete_attachment_cleanup(uuid) to postgres;
revoke all on function public.reserve_attachment(uuid,uuid,text,uuid,text,text,integer,text,text),public.finalize_attachment(uuid),public.remove_attachment(uuid),public.finish_attachment_removal(uuid) from public,anon,authenticated;
grant execute on function public.reserve_attachment(uuid,uuid,text,uuid,text,text,integer,text,text),public.finalize_attachment(uuid),public.remove_attachment(uuid),public.finish_attachment_removal(uuid) to authenticated;
