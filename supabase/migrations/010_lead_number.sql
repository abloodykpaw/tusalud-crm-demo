-- Numeración global fija de leads (igual para todos los usuarios).
alter table public.leads
  add column if not exists lead_number integer;

-- Backfill por orden de creación
with ordered as (
  select id, row_number() over (order by created_at asc, id asc) as n
  from public.leads
  where lead_number is null
)
update public.leads l
set lead_number = o.n
from ordered o
where l.id = o.id
  and l.lead_number is null;

-- Si ya había algunos numerados, rellena huecos restantes con números altos
with maxn as (
  select coalesce(max(lead_number), 0) as m from public.leads
),
missing as (
  select id, row_number() over (order by created_at asc, id asc) as n
  from public.leads
  where lead_number is null
)
update public.leads l
set lead_number = maxn.m + missing.n
from missing, maxn
where l.id = missing.id;

create unique index if not exists leads_lead_number_uidx
  on public.leads (lead_number)
  where lead_number is not null;
