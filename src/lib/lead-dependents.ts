import { normalizePersonName } from "./cartaLeadSync";

function normKey(key: string) {
  return key
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

const HOUSEHOLD_KEYS = [
  "numero de dependientes",
  "numero de aplicantes",
  "total de miembros",
  "nombre del plan",
];

/** Columnas que el CRM espera para cada persona del hogar (Generador-Direcciones). */
export const EXPECTED_DEPENDENT_COLUMNS = [
  "Dependiente (Pareja)",
  "Fecha de nacimiento (Pareja)",
  "Edad (Pareja)",
  "Sexo (Pareja)",
  "Dependiente (Hijo 1)",
  "Fecha de nacimiento (Hijo 1)",
  "Edad (Hijo 1)",
  "Sexo (Hijo 1)",
  "Dependiente (Hijo 2)",
  "Fecha de nacimiento (Hijo 2)",
  "Edad (Hijo 2)",
  "Sexo (Hijo 2)",
];

/** Columnas de hogar/póliza: van al panel lateral, no a la tabla principal. */
export function isHouseholdColumn(column: string) {
  const k = normKey(column);
  return HOUSEHOLD_KEYS.some((h) => k === h || k.includes(h));
}

function isPersonDependentColumn(column: string) {
  const k = normKey(column);
  if (isHouseholdColumn(column)) return false;
  return (
    /\bdepend/.test(k) ||
    /\bdep\s*\d/.test(k) ||
    /\bdep\d/.test(k) ||
    /\bpareja\b/.test(k) ||
    /\bhijo\s*\d/.test(k) ||
    /\bhija\s*\d/.test(k) ||
    /\bchild\s*\d/.test(k) ||
    /\besposa\b|\besposo\b|\bconyuge\b|\bspouse\b/.test(k) ||
    /\bmember\s*\d/.test(k) ||
    /\bfamiliar\s*\d/.test(k)
  );
}

/** Columnas del Excel que no van en la tabla principal (hogar + personas). */
export function isDependentColumn(column: string) {
  return isHouseholdColumn(column) || isPersonDependentColumn(column);
}

export type DependentField = { label: string; value: string };
export type DependentGroup = { index: number; label: string; fields: DependentField[] };
export type HouseholdSummary = { label: string; value: string }[];

export type ParsedDependents = {
  groups: DependentGroup[];
  expectedCount: number;
  hasPersonDetails: boolean;
};

function slotFromColumn(column: string): { key: string; label: string; order: number } | null {
  const k = normKey(column);
  if (!isPersonDependentColumn(column)) return null;

  if (/\bpareja\b|\besposa\b|\besposo\b|\bconyuge\b|\bspouse\b/.test(k) && !/\bhijo/.test(k) && !/\bhija/.test(k)) {
    return { key: "pareja", label: "Pareja", order: 0 };
  }

  const child =
    k.match(/\bhijo\s*(\d+)\b/) ||
    k.match(/\bhija\s*(\d+)\b/) ||
    k.match(/\bchild\s*(\d+)\b/) ||
    k.match(/\bfamiliar\s*(\d+)\b/) ||
    k.match(/\bmember\s*(\d+)\b/);
  if (child) {
    const n = parseInt(child[1], 10);
    return { key: `hijo-${n}`, label: `Hijo ${n}`, order: n };
  }

  const dep =
    k.match(/depend(?:iente|ent)?\s*[#._-]?\s*(\d+)/) ||
    k.match(/\bdep\s*[#._-]?\s*(\d+)/) ||
    k.match(/\bdep(\d+)/);
  if (dep) {
    const n = parseInt(dep[1], 10);
    return { key: `dep-${n}`, label: `Dependiente ${n}`, order: n };
  }

  return null;
}

function friendlyFieldLabel(column: string) {
  const k = normKey(column);
  if (/fecha/.test(k) || /nacimiento/.test(k) || /\bdob\b/.test(k)) return "Fecha de nacimiento";
  if (/\bedad\b|\bage\b/.test(k)) return "Edad";
  if (/\bsexo\b|\bgenero\b|\bgender\b/.test(k)) return "Sexo";
  if (/relacion|parentesco|relationship/.test(k)) return "Relación";
  if (/telefono|phone/.test(k)) return "Teléfono";
  if (/ssn|seguro social/.test(k)) return "SSN";
  if (/^dependiente\b|^depend\b|\bdep\s*\d|^nombre\b/.test(k)) return "Nombre";
  return column.replace(/\s*\([^)]+\)\s*$/, "").trim() || column;
}

function findRawValue(rawData: Record<string, string>, ...needles: string[]) {
  for (const [key, value] of Object.entries(rawData)) {
    const k = normKey(key);
    if (needles.some((n) => k.includes(n)) && String(value).trim()) {
      return { key, value: String(value).trim() };
    }
  }
  return null;
}

function parseIntSafe(value: string) {
  const n = parseInt(value.replace(/[^\d]/g, ""), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Resumen del hogar (plan, aplicantes, total miembros, # dependientes). */
export function parseHouseholdSummary(rawData?: Record<string, string>): HouseholdSummary {
  if (!rawData) return [];
  const fields: HouseholdSummary = [];
  const dep = findRawValue(rawData, "numero de dependientes");
  const app = findRawValue(rawData, "numero de aplicantes");
  const total = findRawValue(rawData, "total de miembros");
  const plan = findRawValue(rawData, "nombre del plan");
  if (dep) fields.push({ label: dep.key, value: dep.value });
  if (app) fields.push({ label: app.key, value: app.value });
  if (total) fields.push({ label: total.key, value: total.value });
  if (plan) fields.push({ label: plan.key, value: plan.value });
  return fields;
}

/** Agrupa columnas de personas dependientes. No inventa filas si solo hay un conteo. */
export function parseDependents(
  rawData?: Record<string, string>,
  columnOrder?: string[]
): ParsedDependents {
  if (!rawData) return { groups: [], expectedCount: 0, hasPersonDetails: false };

  const depCountEntry = findRawValue(rawData, "numero de dependientes");
  const expectedCount = depCountEntry ? parseIntSafe(depCountEntry.value) : 0;

  const keys = columnOrder?.length ? columnOrder : Object.keys(rawData);
  const grouped = new Map<string, { order: number; label: string; fields: DependentField[] }>();

  for (const key of keys) {
    const slot = slotFromColumn(key);
    if (!slot) continue;
    const value = (rawData[key] || "").trim();
    if (!value) continue;
    if (!grouped.has(slot.key)) {
      grouped.set(slot.key, { order: slot.order, label: slot.label, fields: [] });
    }
    grouped.get(slot.key)!.fields.push({ label: friendlyFieldLabel(key), value });
  }

  const groups = [...grouped.values()]
    .sort((a, b) => a.order - b.order)
    .map((g, i) => ({
      index: i + 1,
      label: g.label,
      fields: g.fields,
    }));

  return {
    groups,
    expectedCount: expectedCount || groups.length,
    hasPersonDetails: groups.length > 0,
  };
}

export function dependentCount(rawData?: Record<string, string>) {
  const parsed = parseDependents(rawData);
  return parsed.expectedCount || parsed.groups.length;
}

/** Columnas visibles en la tabla principal (titular, sin hogar ni dependientes). */
export function primaryExcelColumns(
  rows: { columnOrder?: string[]; rawData?: Record<string, string> }[]
) {
  return excelColumnsInOrder(rows).filter((col) => !isDependentColumn(col));
}

/**
 * Todas las columnas del Excel en el orden original del archivo (como en la hoja).
 * Si las filas vienen de archivos con columnas distintas, se unen: cada columna nueva
 * entra justo después de la que la precede en su propio archivo.
 */
export function excelColumnsInOrder(
  rows: { columnOrder?: string[]; rawData?: Record<string, string> }[]
) {
  const all: string[] = [];
  const seenOrders = new Set<string>();
  for (const l of rows) {
    const order = l.columnOrder?.length ? l.columnOrder : Object.keys(l.rawData || {});
    const key = order.join("\u0001");
    if (!order.length || seenOrders.has(key)) continue;
    seenOrders.add(key);
    let at = 0;
    for (const col of order) {
      const i = all.indexOf(col);
      if (i >= 0) {
        at = i + 1;
        continue;
      }
      all.splice(at++, 0, col);
    }
  }
  return all.filter((col) => col && col !== "_columnOrder");
}

/** Columna "Number" / "Número" del Excel. */
export function isExcelNumberColumn(column: string) {
  const k = normKey(column);
  return k === "number" || k === "numero" || k === "nro" || k === "#";
}

/** Número de fila del Excel / CRM para ordenar la lista (ascendente = Excel). */
export function leadSortNumber(lead: {
  leadNumber?: number;
  rawData?: Record<string, string>;
  columnOrder?: string[];
}): number {
  // Preferir lead_number de la BD (asignado al importar en orden del Excel).
  if (lead.leadNumber && lead.leadNumber > 0) return lead.leadNumber;
  const keys = lead.columnOrder?.length ? lead.columnOrder : Object.keys(lead.rawData || {});
  for (const key of keys) {
    if (!isExcelNumberColumn(key)) continue;
    const raw = (lead.rawData?.[key] || "").trim();
    if (!raw) continue;
    const n = parseInt(raw.replace(/[^\d]/g, ""), 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

/** Valor de celda: si Number del Excel está vacío, usa el # del CRM. */
export function leadExcelCellValue(
  lead: { leadNumber?: number; dayNumber?: number; rawData?: Record<string, string> },
  column: string
): string {
  const raw = (lead.rawData?.[column] || "").trim();
  if (raw) return raw;
  if (isExcelNumberColumn(column)) {
    const n = lead.dayNumber || lead.leadNumber;
    return n && n > 0 ? String(n) : "—";
  }
  return "—";
}

/** Mapeo estándar Generador / Leads1000 → campos del CRM. */
export function mapLeadFromExcelRow(row: Record<string, unknown>) {
  const rawData = Object.fromEntries(
    Object.entries(row).map(([k, v]) => [k, String(v ?? "").trim()])
  );

  function cell(...keys: string[]) {
    for (const key of keys) {
      const found = Object.entries(row).find(([k]) => normKey(k) === normKey(key));
      if (found && found[1] != null && String(found[1]).trim()) return String(found[1]).trim();
    }
    for (const key of keys) {
      const nk = normKey(key);
      const found = Object.entries(row).find(([k]) => normKey(k).includes(nk));
      if (found && found[1] != null && String(found[1]).trim()) return String(found[1]).trim();
    }
    return "";
  }

  const fullName = cell("nombre completo", "nombre", "name", "nombres");
  let firstName = cell("nombre", "first_name", "firstname", "nombres");
  let lastName = cell("apellido", "last_name", "lastname", "apellidos");

  if (fullName) {
    const parts = fullName.split(/\s+/).filter(Boolean);
    firstName = parts[0] || fullName;
    lastName = parts.length > 1 ? parts.slice(1).join(" ") : lastName;
  }

  const phone = cell("telefono", "teléfono", "phone", "celular", "móvil", "movil", "whatsapp");
  const email = cell("email", "correo", "mail", "e-mail");
  const city =
    cell("condado", "ciudad", "city", "municipio", "estado") ||
    cell("dirección", "direccion", "address");

  return {
    firstName,
    lastName,
    phone,
    email,
    city,
    rawData,
    ok: !!(fullName || firstName),
  };
}

export function normalizePhone(value: string) {
  return value.replace(/\D/g, "");
}

/**
 * Identidad de un lead = contacto (teléfono o email) + nombre.
 * Un teléfono compartido (familia, oficina) con otro nombre es otra persona.
 */
export function leadMatchKey(lead: {
  firstName?: string;
  lastName?: string;
  phone?: string;
  email?: string;
}) {
  const p = normalizePhone(lead.phone || "");
  const e = (lead.email || "").trim().toLowerCase();
  const contact = p.length >= 7 ? `p:${p}` : e ? `e:${e}` : "";
  if (!contact) return null;
  const name = normalizePersonName(`${lead.firstName || ""} ${lead.lastName || ""}`)
    .split(" ")
    .filter(Boolean)
    .sort()
    .join(" ");
  return name ? `${contact}|n:${name}` : contact;
}
