-- Solo admin y encargado pueden crear/editar nombres de reporte y asignaciones

drop policy if exists "targets_write_staff" on public.report_targets;

create policy "targets_write_assigners" on public.report_targets
  for all to authenticated
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('admin', 'encargado')
    )
  )
  with check (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('admin', 'encargado')
    )
  );
