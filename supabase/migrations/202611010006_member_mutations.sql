alter table public.memberships add column version integer not null default 1 check(version>0);
create function private.member_version() returns trigger language plpgsql set search_path='' as $$
begin new.version := old.version+1; return new; end; $$;
alter function private.member_version() owner to project_hub_owner;
revoke all on function private.member_version() from public,anon,authenticated;
create trigger membership_version before update on public.memberships for each row execute function private.member_version();

create function public.change_member(p_workspace_id uuid,p_user_id uuid,p_role text,p_version integer,p_remove boolean) returns void
language plpgsql security definer set search_path='' as $$
declare current_version integer;
begin
 perform 1 from public.workspaces where id=p_workspace_id for update;
 if not private.is_admin(p_workspace_id) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select version into current_version from public.memberships where workspace_id=p_workspace_id and user_id=p_user_id;
 if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
 if p_version is null or p_version<>current_version then raise exception 'VERSION_CONFLICT' using errcode='40001'; end if;
 if p_remove is null or (not p_remove and (p_role is null or p_role not in ('admin','member','viewer'))) then raise exception 'INVALID_INPUT' using errcode='22023'; end if;
 if p_remove then perform public.remove_member(p_workspace_id,p_user_id);
 else perform public.set_member_role(p_workspace_id,p_user_id,p_role); end if;
end; $$;
grant create on schema public to project_hub_owner;
alter function public.change_member(uuid,uuid,text,integer,boolean) owner to project_hub_owner;
revoke create on schema public from project_hub_owner;
revoke all on function public.change_member(uuid,uuid,text,integer,boolean) from public,anon,authenticated;
grant execute on function public.change_member(uuid,uuid,text,integer,boolean) to authenticated;
