-- 019 · Endurecimiento de seguridad (auditoría F0.1–F0.6) + metas de cartas en la base (F1.6)
-- auth.uid() is null = service role / SQL editor: siempre pasa los candados.

-- ───────────────────────── helpers ─────────────────────────
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
$$;

-- ───────────────────────── F0.1 registro siempre como agente ─────────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_username text;
begin
  v_username := lower(trim(coalesce(
    new.raw_user_meta_data->>'username',
    split_part(new.email, '@', 1)
  )));

  -- El rol de la metadata se ignora: solo admin (Edge Function) puede subirlo.
  insert into public.profiles (id, full_name, email, username, role, status)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    nullif(trim(coalesce(new.raw_user_meta_data->>'contact_email', '')), ''),
    v_username,
    'agente',
    'activo'
  )
  on conflict (id) do update
    set email = coalesce(excluded.email, public.profiles.email),
        full_name = coalesce(excluded.full_name, public.profiles.full_name),
        username = coalesce(excluded.username, public.profiles.username);
  return new;
end;
$$;

-- ───────────────────────── F0.2 perfiles ─────────────────────────
create or replace function public.profiles_guard()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then return new; end if;
  if not public.is_admin() and (
       new.role     is distinct from old.role
    or new.status   is distinct from old.status
    or new.username is distinct from old.username
    or new.id       is distinct from old.id
  ) then
    raise exception 'Solo admin puede cambiar rol, estado o usuario';
  end if;
  return new;
end $$;

drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before update on public.profiles
  for each row execute function public.profiles_guard();

drop policy if exists "profiles_insert_staff" on public.profiles;
create policy "profiles_insert_admin" on public.profiles for insert to authenticated
  with check (public.is_admin());

-- Cada quien edita su perfil; solo admin edita el de otros.
drop policy if exists "profiles_update_staff" on public.profiles;
drop policy if exists "profiles_update_self" on public.profiles;
create policy "profiles_update_self" on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

-- ───────────────────────── F1.6 metas cartas → realizado ─────────────────────────
-- Cartas vinculadas a leads del agente asignado, en el día de la tarea (o su semana si no tiene día).
create or replace function public.task_goal_count(p_agent uuid, p_due date, p_week date)
returns integer
language sql stable security definer set search_path = public
as $$
  select count(*)::int
  from public.report_entries e
  join public.leads l on l.id = e.linked_lead_id
  where e.type = 'consent'
    and l.assigned_agent_id = p_agent
    and (
      (p_due is not null and e.report_date = p_due)
      or (p_due is null and e.report_date >= p_week and e.report_date < p_week + 7)
    )
$$;

-- ───────────────────────── F0.3/F0.4 tareas ─────────────────────────
create or replace function public.weekly_tasks_guard()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_payroll boolean := auth.uid() is null or public.is_payroll();
  v_staff boolean := auth.uid() is null or public.is_staff();
begin
  if tg_op = 'UPDATE' and not v_staff then
    -- Nómina y agentes no editan la definición de la tarea.
    new.title := old.title;
    new.description := old.description;
    new.assigned_to := old.assigned_to;
    new.created_by := old.created_by;
    new.week_start := old.week_start;
    new.due_date := old.due_date;
    new.goal_type := old.goal_type;
    new.goal_target := old.goal_target;

    if not v_payroll then
      if new.proofs_validated is distinct from old.proofs_validated then
        raise exception 'Solo nómina, encargado o admin pueden validar pruebas';
      end if;
      if old.proofs_validated and new.status is distinct from old.status then
        raise exception 'Tarea validada: solo admin/encargado puede reabrirla';
      end if;
      if old.status = 'completada' and new.status <> 'completada' then
        raise exception 'No puedes reabrir una tarea completada';
      end if;
    end if;
  end if;

  if new.goal_type = 'consent_realizado' and coalesce(new.goal_target, 0) > 0 then
    if tg_op = 'UPDATE' and old.proofs_validated and new.proofs_validated then
      new.goal_current := old.goal_current;
    else
      new.goal_current := least(
        new.goal_target,
        public.task_goal_count(new.assigned_to, new.due_date, new.week_start)
      );
      if new.goal_current >= new.goal_target and new.status <> 'completada' then
        new.status := 'completada';
      end if;
    end if;
  else
    new.goal_current := 0;
  end if;

  if tg_op = 'UPDATE' and not v_payroll
     and new.status = 'completada' and old.status <> 'completada'
     and new.goal_type = 'consent_realizado' and new.goal_current < new.goal_target then
    raise exception 'Falta progreso de meta (%/%)', new.goal_current, new.goal_target;
  end if;

  return new;
end $$;

drop trigger if exists weekly_tasks_guard on public.weekly_tasks;
create trigger weekly_tasks_guard before insert or update on public.weekly_tasks
  for each row execute function public.weekly_tasks_guard();

create or replace function public.weekly_tasks_goal_note()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.goal_type = 'consent_realizado' and new.goal_current > old.goal_current then
    insert into public.task_progress (task_id, submitted_by, notes)
    values (
      new.id,
      coalesce(auth.uid(), new.assigned_to),
      format('Auto: +%s carta(s) con lead → realizado (%s/%s)',
        new.goal_current - old.goal_current, new.goal_current, new.goal_target)
    );
  end if;
  return null;
end $$;

drop trigger if exists weekly_tasks_goal_note on public.weekly_tasks;
create trigger weekly_tasks_goal_note after update on public.weekly_tasks
  for each row execute function public.weekly_tasks_goal_note();

-- Recalcula metas afectadas (el guard de weekly_tasks hace el conteo).
create or replace function public.touch_goal_tasks(p_agents uuid[], p_dates date[])
returns void
language plpgsql security definer set search_path = public
as $$
begin
  update public.weekly_tasks t
     set goal_current = t.goal_current
   where t.goal_type = 'consent_realizado'
     and not t.proofs_validated
     and t.assigned_to = any (p_agents)
     and (
       t.due_date = any (p_dates)
       or (t.due_date is null and exists (
         select 1 from unnest(p_dates) d where d >= t.week_start and d < t.week_start + 7
       ))
     );
end $$;

create or replace function public.report_entries_touch_goals()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_agents uuid[];
  v_dates date[];
begin
  select array_agg(distinct l.assigned_agent_id) into v_agents
    from public.leads l
   where l.assigned_agent_id is not null
     and l.id in (
       case when tg_op <> 'DELETE' then new.linked_lead_id end,
       case when tg_op <> 'INSERT' then old.linked_lead_id end
     );
  if v_agents is null then return null; end if;
  v_dates := array_remove(array[
    case when tg_op <> 'DELETE' then new.report_date end,
    case when tg_op <> 'INSERT' then old.report_date end
  ], null);
  perform public.touch_goal_tasks(v_agents, v_dates);
  return null;
end $$;

drop trigger if exists report_entries_touch_goals on public.report_entries;
create trigger report_entries_touch_goals
  after insert or delete or update of linked_lead_id, report_date, type on public.report_entries
  for each row execute function public.report_entries_touch_goals();

-- ───────────────────────── F0.3 leads ─────────────────────────
create or replace function public.leads_guard()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null or public.is_staff() then return new; end if;
  -- Agentes: solo status y notas de sus leads.
  new.lead_number := old.lead_number;
  new.first_name := old.first_name;
  new.last_name := old.last_name;
  new.phone := old.phone;
  new.email := old.email;
  new.city := old.city;
  new.source := old.source;
  new.assigned_agent_id := old.assigned_agent_id;
  new.raw_data := old.raw_data;
  new.created_at := old.created_at;
  return new;
end $$;

drop trigger if exists leads_guard on public.leads;
create trigger leads_guard before update on public.leads
  for each row execute function public.leads_guard();

create or replace function public.leads_touch_goals()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_dates date[];
begin
  select array_agg(distinct e.report_date) into v_dates
    from public.report_entries e
   where e.type = 'consent' and e.linked_lead_id = new.id;
  if v_dates is null then return null; end if;
  perform public.touch_goal_tasks(
    array_remove(array[old.assigned_agent_id, new.assigned_agent_id], null),
    v_dates
  );
  return null;
end $$;

drop trigger if exists leads_touch_goals on public.leads;
create trigger leads_touch_goals
  after update of assigned_agent_id on public.leads
  for each row when (old.assigned_agent_id is distinct from new.assigned_agent_id)
  execute function public.leads_touch_goals();

-- ───────────────────────── F0.3 pagos ─────────────────────────
create or replace function public.weekly_payments_guard()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null or public.is_payroll() then return new; end if;

  if tg_op = 'INSERT' then
    if new.status::text <> 'ready' then
      raise exception 'Solo nómina puede abrir una solicitud de pago';
    end if;
    new.data_requested_at := null;
    new.data_requested_by := null;
    new.screenshot_path := null;
    new.screenshot_name := null;
    new.paid_amount := null;
    new.paid_by_name := null;
    new.paid_by_user_id := null;
    new.paid_at := null;
    return new;
  end if;

  if new.status is distinct from old.status
     and not (old.status::text in ('awaiting_data', 'data_received') and new.status::text = 'data_received') then
    raise exception 'Solo nómina puede cambiar el estado del pago';
  end if;
  if new.status::text <> 'data_received' and (
       new.zelle_holder  is distinct from old.zelle_holder
    or new.zelle_target  is distinct from old.zelle_target
    or new.zelle_contact is distinct from old.zelle_contact
    or new.zelle_notes   is distinct from old.zelle_notes
  ) then
    raise exception 'Los datos Zelle solo se envían cuando nómina los solicita';
  end if;

  new.agent_id := old.agent_id;
  new.week_start := old.week_start;
  new.data_requested_at := old.data_requested_at;
  new.data_requested_by := old.data_requested_by;
  new.screenshot_path := old.screenshot_path;
  new.screenshot_name := old.screenshot_name;
  new.paid_amount := old.paid_amount;
  new.paid_by_name := old.paid_by_name;
  new.paid_by_user_id := old.paid_by_user_id;
  new.paid_at := old.paid_at;
  return new;
end $$;

drop trigger if exists weekly_payments_guard on public.weekly_payments;
create trigger weekly_payments_guard before insert or update on public.weekly_payments
  for each row execute function public.weekly_payments_guard();

-- ───────────────────────── F0.4 nómina en tareas ─────────────────────────
drop policy if exists "tasks_payroll_read" on public.weekly_tasks;
create policy "tasks_payroll_read" on public.weekly_tasks for select to authenticated
  using (public.is_payroll());
drop policy if exists "tasks_payroll_update" on public.weekly_tasks;
create policy "tasks_payroll_update" on public.weekly_tasks for update to authenticated
  using (public.is_payroll()) with check (public.is_payroll());

-- ───────────────────────── F0.5 lecturas ─────────────────────────
drop policy if exists "entries_read" on public.report_entries;
create policy "entries_read" on public.report_entries for select to authenticated
  using (
    public.is_payroll()
    or uploaded_by = auth.uid()
    or exists (
      select 1 from public.report_targets t
      where t.id = report_entries.target_id and t.assigned_agent_id = auth.uid()
    )
  );

drop policy if exists "entry_names_read" on public.report_entry_names;
create policy "entry_names_read" on public.report_entry_names for select to authenticated
  using (exists (select 1 from public.report_entries e where e.id = report_entry_names.entry_id));

drop policy if exists "entry_names_insert" on public.report_entry_names;
create policy "entry_names_insert" on public.report_entry_names for insert to authenticated
  with check (exists (
    select 1 from public.report_entries e
    where e.id = report_entry_names.entry_id
      and (e.uploaded_by = auth.uid() or public.is_staff())
  ));

drop policy if exists "progress_read" on public.task_progress;
create policy "progress_read" on public.task_progress for select to authenticated
  using (
    public.is_payroll()
    or exists (select 1 from public.weekly_tasks t where t.id = task_progress.task_id and t.assigned_to = auth.uid())
  );

drop policy if exists "progress_insert" on public.task_progress;
create policy "progress_insert" on public.task_progress for insert to authenticated
  with check (
    submitted_by = auth.uid()
    and (
      public.is_payroll()
      or exists (select 1 from public.weekly_tasks t where t.id = task_progress.task_id and t.assigned_to = auth.uid())
    )
  );

drop policy if exists "history_read" on public.history_events;
create policy "history_read" on public.history_events for select to authenticated
  using (public.is_payroll());

-- ───────────────────────── F0.6 ventana de 5 minutos ─────────────────────────
drop policy if exists "entries_update_own" on public.report_entries;
create policy "entries_update_window" on public.report_entries for update to authenticated
  using (
    public.is_admin()
    or (created_at > now() - interval '5 minutes'
        and (uploaded_by = auth.uid() or public.current_role() = 'encargado'))
  )
  with check (
    public.is_admin()
    or (created_at > now() - interval '5 minutes'
        and (uploaded_by = auth.uid() or public.current_role() = 'encargado'))
  );

drop policy if exists "entries_delete_staff" on public.report_entries;
create policy "entries_delete_window" on public.report_entries for delete to authenticated
  using (
    public.is_admin()
    or (created_at > now() - interval '5 minutes'
        and (uploaded_by = auth.uid() or public.current_role() = 'encargado'))
  );

drop policy if exists "entry_names_update" on public.report_entry_names;
create policy "entry_names_update" on public.report_entry_names for update to authenticated
  using (exists (
    select 1 from public.report_entries e
    where e.id = report_entry_names.entry_id
      and (public.is_admin()
        or (e.created_at > now() - interval '5 minutes'
            and (e.uploaded_by = auth.uid() or public.current_role() = 'encargado')))
  ));

drop policy if exists "entry_names_delete" on public.report_entry_names;
create policy "entry_names_delete" on public.report_entry_names for delete to authenticated
  using (exists (
    select 1 from public.report_entries e
    where e.id = report_entry_names.entry_id
      and (public.is_admin()
        or (e.created_at > now() - interval '5 minutes'
            and (e.uploaded_by = auth.uid() or public.current_role() = 'encargado')))
  ));

-- Vínculo carta → lead fuera de la ventana: solo admin/encargado, solo esas columnas.
create or replace function public.link_carta_to_lead(p_entry uuid, p_lead uuid, p_person_key text default null)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_staff() then
    raise exception 'Solo admin o encargado pueden vincular cartas';
  end if;
  update public.report_entries
     set linked_lead_id = p_lead,
         person_key = coalesce(p_person_key, person_key)
   where id = p_entry and type = 'consent';
  if not found then
    raise exception 'Carta no encontrada';
  end if;
end $$;

revoke all on function public.link_carta_to_lead(uuid, uuid, text) from public, anon;
grant execute on function public.link_carta_to_lead(uuid, uuid, text) to authenticated;

-- ───────────────────────── F1.9 ajustes solo admin ─────────────────────────
drop policy if exists "settings_write_staff" on public.app_settings;
create policy "settings_write_admin" on public.app_settings for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ───────────────────────── F1.10 pagos: monto numérico + comprobantes ─────────────────────────
alter table public.weekly_payments
  alter column paid_amount type numeric(10,2)
  using nullif(regexp_replace(coalesce(paid_amount, ''), '[^0-9.]', '', 'g'), '')::numeric(10,2);

insert into public.app_settings (key, value)
values ('default_weekly_amount', to_jsonb(450))
on conflict (key) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'payment-receipts', 'payment-receipts', false, 5242880,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "receipts_read" on storage.objects;
create policy "receipts_read" on storage.objects for select to authenticated
  using (
    bucket_id = 'payment-receipts'
    and (public.is_payroll() or (storage.foldername(name))[1] = auth.uid()::text)
  );

drop policy if exists "receipts_insert" on storage.objects;
create policy "receipts_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'payment-receipts' and public.is_payroll());

drop policy if exists "receipts_update" on storage.objects;
create policy "receipts_update" on storage.objects for update to authenticated
  using (bucket_id = 'payment-receipts' and public.is_payroll())
  with check (bucket_id = 'payment-receipts' and public.is_payroll());

drop policy if exists "receipts_delete" on storage.objects;
create policy "receipts_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'payment-receipts' and public.is_admin());

-- ───────────────────────── F1.15 numeración de leads del día ─────────────────────────
create table if not exists public.lead_number_counters (
  day date primary key,
  last_number integer not null
);
alter table public.lead_number_counters enable row level security;

-- Reserva p_count números consecutivos del día (Caracas); devuelve el primero.
create or replace function public.reserve_lead_numbers(p_day date, p_count integer)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_max integer;
  v_start integer;
begin
  if not public.is_staff() then
    raise exception 'Solo admin o encargado pueden importar leads';
  end if;
  if p_count is null or p_count < 1 then
    raise exception 'Cantidad inválida';
  end if;
  perform pg_advisory_xact_lock(hashtext('lead_numbers'), p_day - date '2000-01-01');
  select coalesce(max(lead_number), 0) into v_max
    from public.leads
   where (created_at at time zone 'America/Caracas')::date = p_day;
  insert into public.lead_number_counters (day, last_number)
  values (p_day, v_max + p_count)
  on conflict (day) do update
    set last_number = greatest(public.lead_number_counters.last_number, v_max) + p_count
  returning last_number - p_count + 1 into v_start;
  return v_start;
end $$;

revoke all on function public.reserve_lead_numbers(date, integer) from public, anon;
grant execute on function public.reserve_lead_numbers(date, integer) to authenticated;

-- Funciones internas: no exponer por RPC.
revoke all on function public.touch_goal_tasks(uuid[], date[]) from public, anon, authenticated;
revoke all on function public.task_goal_count(uuid, date, date) from public, anon, authenticated;

-- Recalcular las metas abiertas con la regla nueva (crédito al agente asignado al lead).
update public.weekly_tasks
   set goal_current = goal_current
 where goal_type = 'consent_realizado'
   and not proofs_validated;
