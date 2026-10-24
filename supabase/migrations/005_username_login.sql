-- Fase 1: login por usuario (email interno en auth, opcional en perfil)

alter table public.profiles
  add column if not exists username text;

create unique index if not exists profiles_username_lower_idx
  on public.profiles (lower(trim(username)))
  where username is not null and btrim(username) <> '';

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_username text;
begin
  v_username := lower(trim(coalesce(
    new.raw_user_meta_data->>'username',
    split_part(new.email, '@', 1)
  )));

  insert into public.profiles (id, full_name, email, username, role, status)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    nullif(trim(coalesce(new.raw_user_meta_data->>'contact_email', '')), ''),
    v_username,
    coalesce((new.raw_user_meta_data->>'role')::public.app_role, 'agente'),
    'activo'
  )
  on conflict (id) do update
    set email = coalesce(excluded.email, public.profiles.email),
        full_name = coalesce(excluded.full_name, public.profiles.full_name),
        username = coalesce(excluded.username, public.profiles.username);
  return new;
end;
$$;
