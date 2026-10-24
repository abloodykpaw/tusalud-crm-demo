-- Módulo G: pagos semanales (solo Zelle)

create type public.payment_status as enum (
  'ready',
  'awaiting_data',
  'data_received',
  'sent'
);

alter table public.weekly_tasks
  add column if not exists proofs_validated boolean not null default false;

create table public.weekly_payments (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.profiles(id),
  week_start date not null,
  status public.payment_status not null default 'ready',
  zelle_holder text,
  zelle_target text,
  zelle_contact text,
  zelle_notes text,
  zelle_submitted_at timestamptz,
  data_requested_at timestamptz,
  data_requested_by uuid references public.profiles(id),
  screenshot_path text,
  screenshot_name text,
  paid_amount text,
  paid_by_name text,
  paid_by_user_id uuid references public.profiles(id),
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  unique (agent_id, week_start)
);

alter table public.weekly_payments enable row level security;

create or replace function public.is_payroll()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('admin', 'encargado', 'nomina')
  )
$$;

create policy "payments_payroll_all" on public.weekly_payments
  for all to authenticated using (public.is_payroll());

create policy "payments_agent_read" on public.weekly_payments
  for select to authenticated using (agent_id = auth.uid() or public.is_payroll());

create policy "payments_agent_update_zelle" on public.weekly_payments
  for update to authenticated
  using (agent_id = auth.uid())
  with check (agent_id = auth.uid());
