grant create on schema public to project_hub_owner;
-- 対象IDを引数にせず、認証した本人の表示名だけを更新する。
create function public.update_my_profile(p_display_name text) returns public.profiles
language plpgsql security definer set search_path='' as $$
declare r public.profiles; normalized text;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode='42501'; end if;
  normalized:=private.clean_comment_body(p_display_name);
  if normalized is null or char_length(normalized) not between 1 and 80 then
    raise exception 'INVALID_INPUT' using errcode='22023';
  end if;
  update public.profiles set display_name=normalized where id=auth.uid() returning * into r;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  return r;
end;
$$;
alter function public.update_my_profile(text) owner to project_hub_owner;
revoke all on function public.update_my_profile(text) from public,anon,authenticated;
grant execute on function public.update_my_profile(text) to authenticated;
revoke create on schema public from project_hub_owner;
