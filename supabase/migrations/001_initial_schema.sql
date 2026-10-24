-- TuSalud Ensurance CRM — schema inicial (módulos A–F)
-- Roles: admin | encargado | agente
-- Reportes: report_targets (nombres) ≠ report_entries (cargados por agentes)

create type public.app_role as enum ('admin', 'encargado', 'agente', 'nomina');
create type public.lead_status as enum ('nuevo', 'contactado', 'cotizado', 'cerrado', 'perdido');
create type public.task_status as enum ('pendiente', 'en_progreso', 'completada');
create type public.report_type as enum ('leads', 'consent');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  email text,
  role public.app_role not null default 'agente',
  phone text,
  status text not null default 'activo',
  created_at timestamptz not null default now()
);

create table public.report_targets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.report_entries (
  id uuid primary key default gen_random_uuid(),
  target_id uuid not null references public.report_targets(id) on delete cascade,
  type public.report_type not null,
  title text not null,
  report_date date not null,
  uploaded_by uuid not null references public.profiles(id),
  file_path text,
  file_name text,
  created_at timestamptz not null default now()
);

create table public.report_entry_names (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.report_entries(id) on delete cascade,
  full_name text not null,
  sort_order int not null default 0
);

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text,
  phone text,
  email text,
  city text,
  source text default 'manual',
  status public.lead_status not null default 'nuevo',
  assigned_agent_id uuid references public.profiles(id),
  notes text,
  raw_data jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.lead_documents (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  storage_path text not null,
  file_name text,
  uploaded_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.weekly_tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  assigned_to uuid not null references public.profiles(id),
  created_by uuid not null references public.profiles(id),
  week_start date not null,
  due_date date,
  status public.task_status not null default 'pendiente',
  created_at timestamptz not null default now()
);

create table public.task_progress (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.weekly_tasks(id) on delete cascade,
  submitted_by uuid not null references public.profiles(id),
  notes text,
  storage_path text,
  submitted_at timestamptz not null default now()
);

-- Seed canales ficticios (demo pública)
insert into public.report_targets (name, slug) values
  ('Canal Norte', 'reportes-norte'),
  ('Canal Sur', 'reportes-sur'),
  ('Canal Oeste', 'reportes-oeste'),
  ('Leads Online', 'reportes-online'),
  ('Partners 100', 'reportes-partners'),
  ('Eventos 50', 'reportes-eventos');

alter table public.profiles enable row level security;
alter table public.report_targets enable row level security;
alter table public.report_entries enable row level security;
alter table public.report_entry_names enable row level security;
alter table public.leads enable row level security;
alter table public.lead_documents enable row level security;
alter table public.weekly_tasks enable row level security;
alter table public.task_progress enable row level security;

create or replace function public.current_role()
returns public.app_role
language sql stable security definer set search_path = public
as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.is_staff()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('admin', 'encargado')
  )
$$;

-- Policies (authenticated)
create policy "profiles_read" on public.profiles for select to authenticated using (true);
create policy "profiles_update_self" on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_staff());

create policy "targets_read" on public.report_targets for select to authenticated using (active = true or public.is_staff());
create policy "targets_write_staff" on public.report_targets for all to authenticated using (public.is_staff());

create policy "entries_read" on public.report_entries for select to authenticated using (true);
create policy "entries_insert" on public.report_entries for insert to authenticated with check (uploaded_by = auth.uid());
create policy "entries_delete_staff" on public.report_entries for delete to authenticated using (public.is_staff() or uploaded_by = auth.uid());

create policy "entry_names_read" on public.report_entry_names for select to authenticated using (true);
create policy "entry_names_insert" on public.report_entry_names for insert to authenticated with check (true);

create policy "leads_staff_all" on public.leads for all to authenticated using (public.is_staff());
create policy "leads_agent_read" on public.leads for select to authenticated
  using (assigned_agent_id = auth.uid() or public.is_staff());
create policy "leads_agent_update" on public.leads for update to authenticated
  using (assigned_agent_id = auth.uid() or public.is_staff());

create policy "tasks_staff" on public.weekly_tasks for all to authenticated using (public.is_staff());
create policy "tasks_agent_read" on public.weekly_tasks for select to authenticated
  using (assigned_to = auth.uid() or public.is_staff());
create policy "tasks_agent_update" on public.weekly_tasks for update to authenticated
  using (assigned_to = auth.uid() or public.is_staff());

create policy "progress_read" on public.task_progress for select to authenticated using (true);
create policy "progress_insert" on public.task_progress for insert to authenticated
  with check (submitted_by = auth.uid());
