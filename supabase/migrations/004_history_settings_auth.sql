-- Historial, ajustes globales y trigger de perfil al registrarse

create table if not exists public.history_events (
  id text primary key,
  at timestamptz not null default now(),
  actor_id text,
  actor_name text not null,
  actor_role public.app_role not null,
  module text not null,
  type text not null,
  summary text not null,
  entity_type text,
  entity_id text,
  meta jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

insert into public.app_settings (key, value) values
  ('force_payment_window', 'false'::jsonb),
  ('current_week_start', '"2026-08-25"'::jsonb),
  ('week_number', '35'::jsonb)
on conflict (key) do nothing;

alter table public.report_entries
  add column if not exists file_content text;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email, role, status)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    new.email,
    coalesce((new.raw_user_meta_data->>'role')::public.app_role, 'agente'),
    'activo'
  )
  on conflict (id) do update
    set email = excluded.email,
        full_name = coalesce(public.profiles.full_name, excluded.full_name);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

alter table public.history_events enable row level security;
alter table public.app_settings enable row level security;

create policy "history_read" on public.history_events
  for select to authenticated using (true);

create policy "history_insert" on public.history_events
  for insert to authenticated with check (actor_id = auth.uid()::text or public.is_staff());

create policy "settings_read" on public.app_settings
  for select to authenticated using (true);

create policy "settings_write_staff" on public.app_settings
  for all to authenticated using (public.is_staff());

create policy "profiles_insert_staff" on public.profiles
  for insert to authenticated with check (public.is_staff() or id = auth.uid());
