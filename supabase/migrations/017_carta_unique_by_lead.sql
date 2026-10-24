-- Anti-duplicado de cartas por lead, no por nombre:
-- dos personas con el mismo nombre (homónimos) pueden tener cada una su carta.
drop index if exists public.report_entries_consent_person_unique;

create unique index if not exists report_entries_consent_lead_unique
  on public.report_entries (target_id, linked_lead_id)
  where type = 'consent'
    and linked_lead_id is not null;

create index if not exists report_entries_consent_person_idx
  on public.report_entries (target_id, person_key)
  where type = 'consent';

comment on column public.report_entries.person_key is
  'Nombre normalizado de la persona (cartas consent); usado para emparejar con leads. El anti-duplicado es por linked_lead_id.';
