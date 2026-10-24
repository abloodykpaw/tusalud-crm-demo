-- Permite al agente crear su fila de pago semanal (Zelle) si aún no existe.
drop policy if exists "payments_agent_insert" on public.weekly_payments;
create policy "payments_agent_insert" on public.weekly_payments
  for insert to authenticated
  with check (agent_id = auth.uid());

-- Admin/encargado pueden actualizar perfiles (rol/estado).
drop policy if exists "profiles_update_staff" on public.profiles;
create policy "profiles_update_staff" on public.profiles
  for update to authenticated
  using (public.is_staff())
  with check (public.is_staff());
