import type { WeeklyTask } from "./types";

/** Primera semana operativa (lun–vie) del nuevo ciclo de pagos/tareas. */
export const OPERATIVE_WEEK_START = "2026-09-21";

export function parseLocalDate(isoDate: string): Date {
  return new Date(`${isoDate}T12:00:00`);
}

/** YYYY-MM-DD local. */
export function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Lunes de la semana laboral que contiene esa fecha. */
export function mondayOfDate(isoDate: string): string {
  const d = parseLocalDate(isoDate);
  const day = d.getDay(); // 0 Dom … 6 Sáb
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return toIsoDate(d);
}

/** Viernes de la semana laboral (weekStart = lunes). */
export function fridayOfWeek(weekStart: string): string {
  const d = parseLocalDate(weekStart);
  d.setDate(d.getDate() + 4);
  return toIsoDate(d);
}

/** ¿La fecha de vencimiento cae en lun–vie de esa semana? */
export function isDueInWorkWeek(dueDate: string, weekStart: string): boolean {
  return dueDate >= weekStart && dueDate <= fridayOfWeek(weekStart);
}

/**
 * Semana efectiva de una tarea: siempre el lunes según dueDate
 * (más fiable que weekStart histórico mal cargado).
 */
export function taskEffectiveWeekStart(task: Pick<WeeklyTask, "dueDate" | "weekStart">): string {
  if (task.dueDate) return mondayOfDate(task.dueDate);
  return task.weekStart;
}

const businessDayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Caracas",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * Lunes de la semana operativa para `now` (hora Caracas).
 * Sábado y domingo ya pertenecen a la semana siguiente (el domingo se asigna).
 */
export function operativeWeekStartFor(now = new Date()): string {
  const today = businessDayFormatter.format(now);
  const day = weekdayOf(today);
  if (day === 6 || day === 0) {
    const d = parseLocalDate(today);
    d.setDate(d.getDate() + (day === 6 ? 2 : 1));
    return toIsoDate(d);
  }
  return mondayOfDate(today);
}

/**
 * Avanza la semana guardada si el calendario ya pasó a otra.
 * Nunca retrocede (respeta un avance manual adelantado).
 */
export function rollWeekForward(
  stored: { currentWeekStart: string; weekNumber: number },
  now = new Date()
): { currentWeekStart: string; weekNumber: number } {
  const due = operativeWeekStartFor(now);
  if (!stored.currentWeekStart || due <= stored.currentWeekStart) return stored;
  const diffDays = Math.round(
    (parseLocalDate(due).getTime() - parseLocalDate(stored.currentWeekStart).getTime()) / 86400000
  );
  return {
    currentWeekStart: due,
    weekNumber: stored.weekNumber + Math.round(diffDays / 7),
  };
}

/** 0=Dom … 6=Sáb (hora local). */
export function weekdayOf(isoDate: string): number {
  return parseLocalDate(isoDate).getDay();
}

/** Rango lun–vie a partir del lunes de la semana. */
export function formatWorkWeekRange(weekStart: string): string {
  const start = parseLocalDate(weekStart);
  const end = new Date(start);
  end.setDate(end.getDate() + 4);
  const fmt = (d: Date) =>
    d.toLocaleDateString("es-VE", { day: "2-digit", month: "2-digit", year: "numeric" });
  return `${fmt(start)} – ${fmt(end)}`;
}

/** Tareas que cuentan para el candado del jueves (todo excepto viernes). */
export function isThruThursdayTask(dueDate: string): boolean {
  return weekdayOf(dueDate) !== 5;
}

export function isFridayTask(dueDate: string): boolean {
  return weekdayOf(dueDate) === 5;
}

export function taskCompleteAndValidated(task: WeeklyTask): boolean {
  return task.status === "completada" && task.proofsValidated;
}

export type AgentWeekGates = {
  tasksTotal: number;
  tasksDone: number;
  thruThursdayTotal: number;
  thruThursdayDone: number;
  fridayTotal: number;
  fridayDone: number;
  /** Lun–jue (y no-viernes) completas + validadas. Sin tareas → false. */
  thruThursdayOk: boolean;
  /** Toda la semana (lun–vie) completa + validada. */
  fullWeekOk: boolean;
  /** Alias histórico: elegible para pago = semana completa. */
  paymentEligible: boolean;
  /** Elegible para pedir/subir datos Zelle. */
  dataEligible: boolean;
};

export function evaluateAgentWeekTasks(tasks: WeeklyTask[]): AgentWeekGates {
  const tasksTotal = tasks.length;
  const tasksDone = tasks.filter((t) => t.status === "completada").length;
  const thru = tasks.filter((t) => isThruThursdayTask(t.dueDate));
  const friday = tasks.filter((t) => isFridayTask(t.dueDate));
  const thruThursdayDone = thru.filter(taskCompleteAndValidated).length;
  const fridayDone = friday.filter(taskCompleteAndValidated).length;

  const thruThursdayOk =
    tasksTotal > 0 &&
    (thru.length === 0 || thru.every(taskCompleteAndValidated));

  const fullWeekOk = tasksTotal > 0 && tasks.every(taskCompleteAndValidated);

  return {
    tasksTotal,
    tasksDone,
    thruThursdayTotal: thru.length,
    thruThursdayDone,
    fridayTotal: friday.length,
    fridayDone,
    thruThursdayOk,
    fullWeekOk,
    paymentEligible: fullWeekOk,
    dataEligible: thruThursdayOk,
  };
}

export type PaymentPhase = {
  /** Domingo: día preferido para asignar tareas. */
  isSundayAssign: boolean;
  /** Jueves ≥ 18:00 (o forzado): ventana de datos Zelle. */
  isDataWindowOpen: boolean;
  /** Viernes (o forzado): ventana de pago. */
  isPayWindowOpen: boolean;
};

const caracasClockFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Caracas",
  weekday: "short",
  hour: "numeric",
  hourCycle: "h23",
});

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Día de la semana (0=Dom) y hora en Caracas, sin depender de la zona del navegador. */
export function caracasDayHour(now = new Date()): { day: number; hour: number } {
  const parts = caracasClockFormatter.formatToParts(now);
  const weekday = parts.find((p) => p.type === "weekday")?.value || "Sun";
  const hour = Number(parts.find((p) => p.type === "hour")?.value || 0) % 24;
  return { day: WEEKDAY_INDEX[weekday] ?? 0, hour };
}

/**
 * Ventanas duales de pago (hora Caracas).
 * `force` (demo) abre ambas para poder probar el flujo completo.
 */
export function getPaymentPhase(force: boolean, now = new Date()): PaymentPhase {
  if (force) {
    return {
      isSundayAssign: false,
      isDataWindowOpen: true,
      isPayWindowOpen: true,
    };
  }
  const { day, hour } = caracasDayHour(now);
  return {
    isSundayAssign: day === 0,
    isDataWindowOpen: day === 4 && hour >= 18,
    isPayWindowOpen: day === 5,
  };
}

/** Semanas anteriores al corte operativo → historial. */
export function isHistoricWeek(weekStart: string): boolean {
  return weekStart < OPERATIVE_WEEK_START;
}

/** Tareas de la semana operativa (por dueDate → lunes). */
export function tasksInWeek<T extends Pick<WeeklyTask, "dueDate" | "weekStart">>(
  tasks: T[],
  weekStart: string
): T[] {
  return tasks.filter((t) => taskEffectiveWeekStart(t) === weekStart);
}
