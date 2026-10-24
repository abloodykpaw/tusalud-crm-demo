-- Metas de progreso en tareas semanales (cartas → realizado, etc.)
alter table public.weekly_tasks
  add column if not exists goal_type text not null default 'none',
  add column if not exists goal_target int not null default 0,
  add column if not exists goal_current int not null default 0;

alter table public.weekly_tasks
  drop constraint if exists weekly_tasks_goal_type_check;

alter table public.weekly_tasks
  add constraint weekly_tasks_goal_type_check
  check (goal_type in ('none', 'consent_realizado'));

alter table public.weekly_tasks
  drop constraint if exists weekly_tasks_goal_nonneg;

alter table public.weekly_tasks
  add constraint weekly_tasks_goal_nonneg
  check (goal_target >= 0 and goal_current >= 0);

comment on column public.weekly_tasks.goal_type is
  'none | consent_realizado — auto-progreso al marcar leads por cartas';
comment on column public.weekly_tasks.goal_target is
  'Meta numérica (ej. 20 cartas/realizados)';
comment on column public.weekly_tasks.goal_current is
  'Avance actual hacia la meta';
