alter table public.profiles
  add column job_title text not null default '' check (char_length(job_title)<=80),
  add column bio text not null default '' check (char_length(bio)<=500);

grant create on schema public to project_hub_owner;
create function public.update_my_profile_details(
  p_display_name text,p_job_title text default null,p_bio text default null
) returns public.profiles
language plpgsql security definer set search_path='' as $$
declare
  r public.profiles;
  normalized_name text;
  normalized_title text;
  normalized_bio text;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode='42501'; end if;
  normalized_name:=private.clean_comment_body(p_display_name);
  normalized_title:=private.clean_comment_body(p_job_title);
  normalized_bio:=private.clean_comment_body(p_bio);
  if normalized_name is null or char_length(normalized_name) not between 1 and 80
     or char_length(normalized_title)>80 or char_length(normalized_bio)>500 then
    raise exception 'INVALID_INPUT' using errcode='22023';
  end if;
  update public.profiles
  set display_name=normalized_name,
      job_title=coalesce(normalized_title,job_title),
      bio=coalesce(normalized_bio,bio)
  where id=auth.uid() returning * into r;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  return r;
end;
$$;
alter function public.update_my_profile_details(text,text,text) owner to project_hub_owner;
revoke all on function public.update_my_profile_details(text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.update_my_profile_details(text,text,text) to authenticated;
revoke create on schema public from project_hub_owner;
