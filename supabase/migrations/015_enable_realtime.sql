-- Habilita Realtime para que todos los clientes vean la misma data al instante
alter publication supabase_realtime add table public.leads;
alter publication supabase_realtime add table public.report_entries;
alter publication supabase_realtime add table public.report_entry_names;
alter publication supabase_realtime add table public.report_targets;
alter publication supabase_realtime add table public.profiles;
alter publication supabase_realtime add table public.weekly_tasks;
alter publication supabase_realtime add table public.task_progress;
alter publication supabase_realtime add table public.weekly_payments;
alter publication supabase_realtime add table public.history_events;
alter publication supabase_realtime add table public.app_settings;
