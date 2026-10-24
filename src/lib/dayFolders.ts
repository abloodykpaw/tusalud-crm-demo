export type DayBucket<T> = {
  key: string;
  label: string;
  isToday: boolean;
  items: T[];
};

/**
 * Zona de negocio para carpetas diarias.
 * Venezuela (America/Caracas) = UTC−4 fijo; coincide con Miami en horario de verano.
 * El día corre 00:00 → 23:59:59.999 en esta zona; a las 00:00 empieza el día siguiente.
 */
export const BUSINESS_TIMEZONE = "America/Caracas";

const WEEKDAYS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

const dayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: BUSINESS_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** YYYY-MM-DD en zona de negocio (Caracas / Miami verano). */
export function formatBusinessDayKey(date: Date): string {
  return dayFormatter.format(date);
}

/** Clave YYYY-MM-DD desde ISO (con hora → zona Caracas) o date-only. */
export function dayKeyFromIso(value?: string | null): string {
  if (!value) return "sin-fecha";
  const trimmed = value.trim();
  // Fecha calendario sin hora: ya es el día de negocio.
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) return formatBusinessDayKey(parsed);

  const key = trimmed.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : "sin-fecha";
}

export function todayKey(now = new Date()): string {
  return formatBusinessDayKey(now);
}

/** Rango UTC [start, end) de un día calendario en Caracas (UTC−4). */
export function businessDayUtcRange(dayKey: string): { start: string; end: string } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) return null;
  const start = new Date(`${dayKey}T00:00:00.000-04:00`);
  if (Number.isNaN(start.getTime())) return null;
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

export function formatDayFolderLabel(dayKey: string, now = new Date()): string {
  if (dayKey === "sin-fecha") return "Sin fecha";
  const [ys, ms, ds] = dayKey.split("-");
  const date = new Date(Number(ys), Number(ms) - 1, Number(ds), 12);
  if (Number.isNaN(date.getTime())) return dayKey;
  const label = `${WEEKDAYS[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
  return dayKey === todayKey(now) ? `Hoy · ${label}` : label;
}

export type NumberedDayItem<T> = T & { dayNumber: number };

/** Ordena ítems del día y asigna #1…N (ascendente). */
export function numberItemsInDay<T>(
  items: T[],
  getSortKey: (item: T) => string
): NumberedDayItem<T>[] {
  const sorted = [...items].sort((a, b) => getSortKey(a).localeCompare(getSortKey(b)));
  return sorted.map((item, i) => ({ ...item, dayNumber: i + 1 }));
}

/** Agrupa ítems por día de negocio (más reciente primero). */
export function groupByDay<T>(
  items: T[],
  getDate: (item: T) => string | null | undefined,
  now = new Date()
): DayBucket<T>[] {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = dayKeyFromIso(getDate(item));
    const list = map.get(key) || [];
    list.push(item);
    map.set(key, list);
  }

  const today = todayKey(now);
  return [...map.entries()]
    .sort(([a], [b]) => {
      if (a === "sin-fecha") return 1;
      if (b === "sin-fecha") return -1;
      return b.localeCompare(a);
    })
    .map(([key, bucketItems]) => ({
      key,
      label: formatDayFolderLabel(key, now),
      isToday: key === today,
      items: bucketItems,
    }));
}
