-- Leads ↔ perfil de reporte: cada lote importado pertenece a un perfil (Cynthia, Valeria…).
-- Permite separar en Leads los de un agente que trabaja 2+ perfiles.

alter table public.leads
  add column if not exists report_target_id uuid references public.report_targets(id) on delete set null;

create index if not exists leads_report_target_idx
  on public.leads (report_target_id)
  where report_target_id is not null;

comment on column public.leads.report_target_id is
  'Perfil de reporte del lote importado (report_targets). Solo staff lo cambia.';

-- Agentes: solo status y notas de sus leads (tampoco el perfil).
create or replace function public.leads_guard()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null or public.is_staff() then return new; end if;
  new.lead_number := old.lead_number;
  new.first_name := old.first_name;
  new.last_name := old.last_name;
  new.phone := old.phone;
  new.email := old.email;
  new.city := old.city;
  new.source := old.source;
  new.assigned_agent_id := old.assigned_agent_id;
  new.report_target_id := old.report_target_id;
  new.raw_data := old.raw_data;
  new.created_at := old.created_at;
  return new;
end $$;

-- ───────────── Relleno de leads existentes (solo los que no tienen perfil) ─────────────

-- 1) Lote del Excel («Excel · archivo.xlsx») ↔ «Leads nuevos» publicado con ese archivo (archivo.txt).
with batch as (
  select lower(trim(regexp_replace(e.file_name, '\.[^.]+$', ''))) as stem,
         min(e.target_id::text)::uuid as target_id
    from public.report_entries e
   where e.type = 'leads'
     and coalesce(e.file_name, '') <> ''
   group by 1
  having count(distinct e.target_id) = 1
)
update public.leads l
   set report_target_id = b.target_id
  from batch b
 where l.report_target_id is null
   and lower(trim(regexp_replace(regexp_replace(coalesce(l.source, ''), '^Excel\s*·\s*', '', 'i'), '\.[^.]+$', ''))) = b.stem;

-- 2) Lead con carta de consentimiento vinculada → perfil de esa carta.
update public.leads l
   set report_target_id = e.target_id
  from public.report_entries e
 where l.report_target_id is null
   and e.type = 'consent'
   and e.linked_lead_id = l.id;

-- 3) Agente con un único perfil activo asignado → ese perfil.
with single as (
  select assigned_agent_id, min(id::text)::uuid as target_id
    from public.report_targets
   where active and assigned_agent_id is not null
   group by assigned_agent_id
  having count(*) = 1
)
update public.leads l
   set report_target_id = s.target_id
  from single s
 where l.report_target_id is null
   and l.assigned_agent_id = s.assigned_agent_id;

-- 4) Agente con 2+ perfiles: si le queda un solo lote sin perfil y un solo perfil propio
--    todavía sin leads suyos, ese lote es de ese perfil (p. ej. Valeria ya emparejada → el resto es Cynthia).
with free as (
  select t.assigned_agent_id, min(t.id::text)::uuid as target_id
    from public.report_targets t
   where t.active
     and t.assigned_agent_id is not null
     and not exists (
       select 1 from public.leads x
        where x.assigned_agent_id = t.assigned_agent_id
          and x.report_target_id = t.id
     )
   group by t.assigned_agent_id
  having count(*) = 1
),
orphan as (
  select assigned_agent_id
    from public.leads
   where report_target_id is null
     and assigned_agent_id is not null
   group by assigned_agent_id
  having count(distinct coalesce(source, '')) = 1
)
update public.leads l
   set report_target_id = f.target_id
  from free f
  join orphan o on o.assigned_agent_id = f.assigned_agent_id
 where l.report_target_id is null
   and l.assigned_agent_id = f.assigned_agent_id;
