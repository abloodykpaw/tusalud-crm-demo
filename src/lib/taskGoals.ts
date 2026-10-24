import type { TaskGoalType, TaskStatus, WeeklyTask } from "./types";

export function normalizeTaskGoalType(raw: unknown): TaskGoalType {
  if (raw === "consent_realizado") return "consent_realizado";
  return "none";
}

/** Meta cumplida, o (tarea manual) al menos un avance registrado. */
export function taskHasCompletionEvidence(task: WeeklyTask): boolean {
  if (task.goalType === "consent_realizado" && task.goalTarget > 0) {
    return task.goalCurrent >= task.goalTarget;
  }
  return task.progressNotes.length > 0;
}

/** Solo las metas se cierran solas; las manuales usan la casilla «Marcar como terminada». */
export function taskShouldAutoComplete(task: WeeklyTask): boolean {
  if (task.status === "completada" || task.proofsValidated) return false;
  return task.goalType === "consent_realizado" && task.goalTarget > 0 && task.goalCurrent >= task.goalTarget;
}

export function withAutoCompleteStatus(task: WeeklyTask): WeeklyTask {
  if (!taskShouldAutoComplete(task)) return task;
  return { ...task, status: "completada" as TaskStatus };
}

/**
 * Suma progreso a tareas de meta «cartas → realizado» del agente.
 * Si se pasa `dueDate`, solo afecta la tarea de ese día (metas diarias).
 * Si no, afecta las de la semana operativa (`weekStart`).
 */
export function bumpConsentRealizadoGoals(
  tasks: WeeklyTask[],
  opts: {
    agentId: string;
    weekStart: string;
    /** Si hay tareas diarias, limitar al día del reporte. */
    dueDate?: string;
    count: number;
    at?: string;
    by: string;
  }
): { tasks: WeeklyTask[]; touched: WeeklyTask[]; autoCompleted: number } {
  if (opts.count <= 0) {
    return { tasks, touched: [], autoCompleted: 0 };
  }
  const at = opts.at || new Date().toISOString();
  const touched: WeeklyTask[] = [];
  let autoCompleted = 0;

  const next = tasks.map((task) => {
    if (task.assignedTo !== opts.agentId) return task;
    if (task.goalType !== "consent_realizado") return task;
    if (task.proofsValidated) return task;
    if (task.goalTarget <= 0) return task;
    if (task.goalCurrent >= task.goalTarget && task.status === "completada") return task;

    if (opts.dueDate) {
      if (task.dueDate !== opts.dueDate) return task;
    } else if (task.weekStart !== opts.weekStart) {
      return task;
    }

    const before = task.goalCurrent;
    const goalCurrent = Math.min(task.goalTarget, task.goalCurrent + opts.count);
    const gained = goalCurrent - before;
    if (gained <= 0) return task;

    const note = {
      at,
      by: opts.by,
      notes: `Auto: +${gained} carta(s) con lead → realizado (${goalCurrent}/${task.goalTarget})`,
    };

    let updated: WeeklyTask = {
      ...task,
      goalCurrent,
      status: task.status === "pendiente" ? "en_progreso" : task.status,
      progressNotes: [...task.progressNotes, note],
    };
    const wasDone = updated.status === "completada";
    updated = withAutoCompleteStatus(updated);
    if (!wasDone && updated.status === "completada") autoCompleted += 1;
    touched.push(updated);
    return updated;
  });

  return { tasks: next, touched, autoCompleted };
}
