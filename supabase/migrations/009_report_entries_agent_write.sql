-- Ventana de corrección (5 min en la app): el agente puede UPDATE/DELETE
-- solo sus propios reportes. Publicar sigue siendo INSERT.

drop policy if exists "entries_update_own" on public.report_entries;
create policy "entries_update_own" on public.report_entries
  for update to authenticated
  using (uploaded_by = auth.uid() or public.is_staff())
  with check (uploaded_by = auth.uid() or public.is_staff());

drop policy if exists "entry_names_delete" on public.report_entry_names;
create policy "entry_names_delete" on public.report_entry_names
  for delete to authenticated
  using (
    public.is_staff()
    or exists (
      select 1
      from public.report_entries e
      where e.id = entry_id
        and e.uploaded_by = auth.uid()
    )
  );

drop policy if exists "entry_names_update" on public.report_entry_names;
create policy "entry_names_update" on public.report_entry_names
  for update to authenticated
  using (
    public.is_staff()
    or exists (
      select 1
      from public.report_entries e
      where e.id = entry_id
        and e.uploaded_by = auth.uid()
    )
  )
  with check (
    public.is_staff()
    or exists (
      select 1
      from public.report_entries e
      where e.id = entry_id
        and e.uploaded_by = auth.uid()
    )
  );
