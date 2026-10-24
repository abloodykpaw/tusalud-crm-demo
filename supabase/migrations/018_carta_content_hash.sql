-- Huella SHA-256 del PDF de cada carta: el mismo archivo no puede cargarse dos veces,
-- aunque cambie el nombre del archivo o exista un homónimo.
alter table public.report_entries
  add column if not exists content_hash text;

create or replace function public.report_entries_set_content_hash()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  if new.file_content is not null and new.file_content like 'data:%' then
    new.content_hash := encode(extensions.digest(new.file_content, 'sha256'), 'hex');
  end if;
  return new;
end;
$$;

drop trigger if exists report_entries_content_hash on public.report_entries;
create trigger report_entries_content_hash
  before insert or update of file_content on public.report_entries
  for each row execute function public.report_entries_set_content_hash();

update public.report_entries
set content_hash = encode(extensions.digest(file_content, 'sha256'), 'hex')
where file_content like 'data:%'
  and content_hash is null;

create unique index if not exists report_entries_consent_hash_unique
  on public.report_entries (content_hash)
  where type = 'consent'
    and content_hash is not null;

comment on column public.report_entries.content_hash is
  'SHA-256 del PDF (lo calcula el trigger); anti-duplicado por archivo en cartas consent';
