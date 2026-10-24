-- Numeración por día: el mismo # puede repetirse en días distintos.
drop index if exists public.leads_lead_number_uidx;

-- Índice de apoyo para “siguiente # del día”
create index if not exists leads_created_at_lead_number_idx
  on public.leads (created_at, lead_number);
