-- Módulo H: metadatos de usuarios
alter table public.profiles
  add column if not exists last_access timestamptz,
  add column if not exists phone text;
