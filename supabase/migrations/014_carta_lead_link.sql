-- Cartas ↔ leads: clave de persona, vínculo y anti-duplicado
-- person_key: nombre normalizado (ailina brito)
-- linked_lead_id: lead emparejado al subir

alter table public.report_entries
  add column if not exists person_key text,
  add column if not exists linked_lead_id uuid references public.leads(id) on delete set null;

create index if not exists report_entries_linked_lead_idx
  on public.report_entries (linked_lead_id)
  where linked_lead_id is not null;

-- Una sola carta de consentimiento por persona dentro del mismo reporte (target)
create unique index if not exists report_entries_consent_person_unique
  on public.report_entries (target_id, person_key)
  where type = 'consent'
    and person_key is not null
    and length(trim(person_key)) > 0;

comment on column public.report_entries.person_key is
  'Nombre normalizado de la persona (cartas consent); usado para anti-duplicado y sync con leads';
comment on column public.report_entries.linked_lead_id is
  'Lead vinculado al subir la carta (match seguro)';
