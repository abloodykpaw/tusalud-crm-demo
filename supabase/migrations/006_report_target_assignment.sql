-- Asignación de nombres de reporte a agentes

alter table public.report_targets
  add column if not exists assigned_agent_id uuid references public.profiles(id);

create index if not exists report_targets_assigned_agent_idx
  on public.report_targets (assigned_agent_id)
  where assigned_agent_id is not null;

-- Cynthia → Jesmary
insert into public.report_targets (name, slug, active, assigned_agent_id)
values (
  'Cynthia',
  'reporte-cynthia',
  true,
  '22222222-2222-2222-2222-222222222203'
)
on conflict (slug) do update
  set name = excluded.name,
      active = excluded.active,
      assigned_agent_id = excluded.assigned_agent_id;
