grant create on schema public to project_hub_owner;
-- 課題との親子関係をDBでも保証し、課題削除時にコメントを連鎖削除する。
alter table public.issues add constraint issues_comment_parent_key unique(workspace_id,project_id,id);
create table public.issue_comments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  project_id uuid not null,
  issue_id uuid not null,
  author_id uuid not null references public.profiles(id),
  author_display_name text not null check(char_length(author_display_name) between 1 and 80),
  body text not null check(char_length(body) between 1 and 5000),
  version integer not null default 1 check(version>=1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key(workspace_id,project_id,issue_id) references public.issues(workspace_id,project_id,id) on delete cascade
);
alter table public.issue_comments owner to project_hub_owner;
alter table public.issue_comments enable row level security;
revoke all on public.issue_comments from public,anon,authenticated;
grant select on public.issue_comments to authenticated;
create policy member_read on public.issue_comments for select to authenticated using(private.is_member(workspace_id));
create index comments_list_idx on public.issue_comments(workspace_id,project_id,issue_id,created_at desc,id desc);
create trigger log_change after insert or update or delete on public.issue_comments for each row execute function private.record_activity();

-- 課題削除後も再送結果を保持し、削除されたコメントを復活させない。
create table private.comment_requests (
  workspace_id uuid not null,
  project_id uuid not null,
  issue_id uuid not null,
  actor_id uuid not null references public.profiles(id),
  request_key text not null,
  payload jsonb not null,
  result jsonb not null,
  expires_at timestamptz not null,
  primary key(workspace_id,project_id,issue_id,actor_id,request_key),
  foreign key(workspace_id,project_id) references public.projects(workspace_id,id)
);
alter table private.comment_requests owner to project_hub_owner;
alter table private.comment_requests enable row level security;
revoke all on private.comment_requests from public,anon,authenticated;

-- JavaScript String.trimと同じ前後の空白を除く。内部の改行は保持する。
create function private.clean_comment_body(value text) returns text
language sql immutable set search_path='' as $$
  select btrim(value,E' \t\n\r\f'||chr(11)||chr(160)||chr(5760)||chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||chr(8197)||chr(8198)||chr(8199)||chr(8200)||chr(8201)||chr(8202)||chr(8232)||chr(8233)||chr(8239)||chr(8287)||chr(12288)||chr(65279));
$$;
create function private.assert_comment_issue(wid uuid,pid uuid,iid uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform private.assert_task_writer(wid,pid);
  perform 1 from public.issues where workspace_id=wid and project_id=pid and id=iid for update;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
end;
$$;

create function public.create_comment_once(p_workspace_id uuid,p_project_id uuid,p_issue_id uuid,p_body text,p_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.issue_comments; normalized text; payload jsonb; previous private.comment_requests;
begin
  perform private.assert_comment_issue(p_workspace_id,p_project_id,p_issue_id);
  normalized:=private.clean_comment_body(p_body);
  if normalized is null or char_length(normalized) not between 1 and 5000 or p_key is null or p_key !~ '^[A-Za-z0-9_-]{1,128}$'
    then raise exception 'INVALID_INPUT' using errcode='22023'; end if;
  payload:=jsonb_build_object('body',normalized);
  delete from private.comment_requests where workspace_id=p_workspace_id and actor_id=auth.uid() and expires_at<=clock_timestamp();
  select * into previous from private.comment_requests where workspace_id=p_workspace_id and project_id=p_project_id and issue_id=p_issue_id and actor_id=auth.uid() and request_key=p_key;
  if found then
    if previous.payload<>payload then raise exception 'IDEMPOTENCY_CONFLICT' using errcode='40001'; end if;
    return previous.result;
  end if;
  insert into public.issue_comments(workspace_id,project_id,issue_id,author_id,author_display_name,body)
    values(p_workspace_id,p_project_id,p_issue_id,auth.uid(),(select display_name from public.profiles where id=auth.uid()),normalized) returning * into r;
  insert into private.comment_requests values(p_workspace_id,p_project_id,p_issue_id,auth.uid(),p_key,payload,to_jsonb(r),clock_timestamp()+interval '24 hours');
  return to_jsonb(r);
end;
$$;

create function public.edit_comment(p_workspace_id uuid,p_project_id uuid,p_issue_id uuid,p_comment_id uuid,p_body text,p_version integer) returns public.issue_comments
language plpgsql security definer set search_path='' as $$
declare r public.issue_comments; normalized text;
begin
  perform private.assert_comment_issue(p_workspace_id,p_project_id,p_issue_id);
  select * into r from public.issue_comments where workspace_id=p_workspace_id and project_id=p_project_id and issue_id=p_issue_id and id=p_comment_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  if r.author_id<>auth.uid() and not private.is_admin(p_workspace_id) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if p_version is null or r.version<>p_version then raise exception 'VERSION_CONFLICT' using errcode='40001'; end if;
  normalized:=private.clean_comment_body(p_body);
  if normalized is null or char_length(normalized) not between 1 and 5000 then raise exception 'INVALID_INPUT' using errcode='22023'; end if;
  update public.issue_comments set body=normalized,version=version+1,updated_at=clock_timestamp() where id=p_comment_id returning * into r;
  return r;
end;
$$;

create function public.delete_comment(p_workspace_id uuid,p_project_id uuid,p_issue_id uuid,p_comment_id uuid,p_version integer) returns void
language plpgsql security definer set search_path='' as $$
declare r public.issue_comments;
begin
  perform private.assert_comment_issue(p_workspace_id,p_project_id,p_issue_id);
  select * into r from public.issue_comments where workspace_id=p_workspace_id and project_id=p_project_id and issue_id=p_issue_id and id=p_comment_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  if r.author_id<>auth.uid() and not private.is_admin(p_workspace_id) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if p_version is null or r.version<>p_version then raise exception 'VERSION_CONFLICT' using errcode='40001'; end if;
  delete from public.issue_comments where id=p_comment_id;
end;
$$;

alter function private.clean_comment_body(text) owner to project_hub_owner;
alter function private.assert_comment_issue(uuid,uuid,uuid) owner to project_hub_owner;
alter function public.create_comment_once(uuid,uuid,uuid,text,text) owner to project_hub_owner;
alter function public.edit_comment(uuid,uuid,uuid,uuid,text,integer) owner to project_hub_owner;
alter function public.delete_comment(uuid,uuid,uuid,uuid,integer) owner to project_hub_owner;
revoke create on schema public from project_hub_owner;
revoke all on function private.clean_comment_body(text),private.assert_comment_issue(uuid,uuid,uuid),public.create_comment_once(uuid,uuid,uuid,text,text),public.edit_comment(uuid,uuid,uuid,uuid,text,integer),public.delete_comment(uuid,uuid,uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.create_comment_once(uuid,uuid,uuid,text,text),public.edit_comment(uuid,uuid,uuid,uuid,text,integer),public.delete_comment(uuid,uuid,uuid,uuid,integer) to authenticated;
