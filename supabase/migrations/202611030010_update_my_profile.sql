-- 本人だけが自分の表示名を変えられる。対象の行はauth.uid()だけから決め、引数では受け取らない。
-- 操作履歴のactor_display_nameは記録した時点の名前を残す（ここでは書き換えない）。
create function public.update_my_profile(p_display_name text) returns public.profiles
language plpgsql security definer set search_path='' as $$
declare r public.profiles; name text:=btrim(p_display_name);
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
  if name is null or char_length(name) not between 1 and 80 then raise exception 'INVALID_INPUT' using errcode='22023'; end if;
  update public.profiles set display_name=name where id=auth.uid() returning * into r;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  return r;
end;
$$;
grant create on schema public to project_hub_owner;
alter function public.update_my_profile(text) owner to project_hub_owner;
revoke create on schema public from project_hub_owner;
revoke all on function public.update_my_profile(text) from public,anon,authenticated;
grant execute on function public.update_my_profile(text) to authenticated;
