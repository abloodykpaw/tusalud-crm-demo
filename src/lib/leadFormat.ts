/**
 * Formato Cristhyam: el formato de leads del CRM (Generador-Direcciones).
 * Cualquier Excel con otro formato se traduce a este antes de guardarse; lo que no
 * existe en él (estatus legal, estado civil, «Aplica», contacto de cada familiar…) se descarta.
 *
 * Sin imports: lo usan la app y los scripts de Node (`scripts/adapt-leads-cristhyam.mjs`).
 */

function personColumns(slot: string) {
  return [
    `Dependiente (${slot})`,
    `Fecha de nacimiento (${slot})`,
    `Edad (${slot})`,
    `Sexo (${slot})`,
  ];
}

export const CRISTHYAM_COLUMNS = [
  "Number",
  "Nombre Completo",
  "Género",
  "Fecha De Nacimiento",
  "Edad",
  "Email",
  "Teléfono",
  "Dirección",
  "Estado",
  "Condado",
  "Zip Code",
  "Ingreso Estimado Anual",
  "Nombre Del Plan",
  "Número De Aplicantes",
  "Número De Dependientes",
  "Total De Miembros",
  ...personColumns("Pareja"),
  ...personColumns("Hijo 1"),
  ...personColumns("Hijo 2"),
];

type Field =
  | "name"
  | "sex"
  | "dob"
  | "age"
  | "phone"
  | "email"
  | "address"
  | "state"
  | "county"
  | "zip"
  | "income"
  | "incomeAlt"
  | "plan"
  | "applicants"
  | "dependents"
  | "members";

/** Del hogar o la póliza: valen estén donde estén en la hoja. */
const HOUSEHOLD_FIELDS = new Set<Field>(["income", "incomeAlt", "plan", "applicants", "dependents", "members"]);

type Person = { name: string; sex: string; dob: string; age: string };
type SourceRow = {
  titular: Partial<Record<Field, string>>;
  members: Person[];
};

/** Encabezado comparable: sin acentos ni mayúsculas, y sin el «_N» que SheetJS añade a los repetidos. */
function baseKey(header: string) {
  return header
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/_\d+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function fieldOf(key: string): Field | null {
  if (["nombre completo", "nombre", "nombre y apellido", "nombres", "name", "full name"].includes(key)) {
    return "name";
  }
  if (["sexo", "genero", "gender"].includes(key)) return "sex";
  if (key.includes("nacimiento") || key === "dob") return "dob";
  if (key === "edad" || key === "age") return "age";
  if (["telefono", "phone", "celular"].includes(key)) return "phone";
  if (["email", "correo", "e-mail"].includes(key)) return "email";
  if (key === "direccion" || key === "address") return "address";
  if (key === "estado" || key === "state") return "state";
  if (key === "condado" || key === "county") return "county";
  if (["zip code", "zip", "codigo postal"].includes(key)) return "zip";
  if (key === "ingreso estimado anual") return "income";
  if (["ingresos", "ingreso", "ingreso anual"].includes(key)) return "incomeAlt";
  if (key === "nombre del plan" || key === "plan") return "plan";
  if (key === "numero de aplicantes") return "applicants";
  if (key === "numero de dependientes") return "dependents";
  if (key === "total de miembros") return "members";
  return null;
}

/** Ya viene en formato Cristhyam (nombre completo + bloques Pareja / Hijo N). */
export function isCristhyamFormat(headers: string[]) {
  return (
    headers.some((h) => baseKey(h) === "nombre completo") &&
    headers.some((h) => /\((pareja|hijo \d+)\)/i.test(h))
  );
}

function clean(value: unknown) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Lee la fila por posición: lo anterior al primer familiar es del titular; cada «Aplica» o
 * nombre adicional abre un familiar nuevo, y su sexo/fecha/edad son los que le siguen.
 */
function readRow(row: Record<string, unknown>, headers: string[]): SourceRow {
  const titular: SourceRow["titular"] = {};
  const members: Person[] = [];
  let current: Person | null = null;
  let titularNamed = false;
  let pendingMember = false;

  for (const header of headers) {
    const key = baseKey(header);
    if (key === "aplica") {
      pendingMember = true;
      continue;
    }
    const field = fieldOf(key);
    if (!field) continue;
    const value = clean(row[header]);
    if (HOUSEHOLD_FIELDS.has(field)) {
      if (value && !titular[field]) titular[field] = value;
      continue;
    }
    if (field === "name") {
      if (!titularNamed && !pendingMember) {
        titular.name = value;
        titularNamed = true;
      } else {
        current = { name: value, sex: "", dob: "", age: "" };
        members.push(current);
        pendingMember = false;
      }
      continue;
    }
    if (!current) {
      if (value && !titular[field]) titular[field] = value;
    } else if ((field === "sex" || field === "dob" || field === "age") && value && !current[field]) {
      current[field] = value;
    }
  }
  return { titular, members: members.filter((m) => m.name) };
}

const pad2 = (s: string) => s.padStart(2, "0");

/** MM/DD/YYYY como en Cristhyam (años de 2 dígitos → 19xx / 20xx). */
function formatDate(value: string, now: Date) {
  const us = value.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
  if (us) {
    let year = Number(us[3]);
    if (us[3].length === 2) year += year > now.getFullYear() % 100 ? 1900 : 2000;
    return `${pad2(us[1])}/${pad2(us[2])}/${year}`;
  }
  const iso = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${pad2(iso[2])}/${pad2(iso[3])}/${iso[1]}`;
  return value;
}

function ageFrom(date: string, now: Date) {
  const m = date.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return "";
  const [month, day, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
  let age = now.getFullYear() - year;
  if (now.getMonth() + 1 < month || (now.getMonth() + 1 === month && now.getDate() < day)) age -= 1;
  return age >= 0 && age < 130 ? String(age) : "";
}

function sexCode(value: string) {
  const k = value.toLowerCase();
  if (k === "f" || k.startsWith("fem") || k === "mujer") return "F";
  if (k === "m" || k.startsWith("masc") || k === "male" || k === "hombre") return "M";
  return value.toUpperCase();
}

/** (954) 950-7397 */
function formatPhone(value: string) {
  let digits = value.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  if (digits.length !== 10) return value;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

/** 37.920,00 */
function formatMoney(value: string) {
  if (!value) return "";
  if (/^\d{1,3}(\.\d{3})*,\d{2}$/.test(value)) return value;
  const plain = value.replace(/[$\s]/g, "");
  let n = NaN;
  if (/^\d{1,3}(\.\d{3})*(,\d{1,2})?$/.test(plain)) n = Number(plain.replace(/\./g, "").replace(",", "."));
  else if (/^\d{1,3}(,\d{3})*(\.\d{1,2})?$/.test(plain) || /^\d+(\.\d{1,2})?$/.test(plain)) {
    n = Number(plain.replace(/,/g, ""));
  }
  if (!Number.isFinite(n)) return value;
  const [int, dec] = n.toFixed(2).split(".");
  return `${int.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${dec}`;
}

type Slot = { slot: string; person: Person; date: string; age: string };

/** El primer familiar es la pareja salvo que sea menor de edad; los demás, hijos en orden. */
function familySlots(members: Person[], now: Date): Slot[] {
  let child = 0;
  return members.map((person, i) => {
    const date = formatDate(person.dob, now);
    const age = person.age || ageFrom(date, now);
    const minor = age !== "" && Number(age) < 18;
    return { slot: i === 0 && !minor ? "Pareja" : `Hijo ${++child}`, person, date, age };
  });
}

function toCristhyamRow(source: SourceRow, slots: Slot[], columns: string[], now: Date) {
  const t = source.titular;
  const out: Record<string, string> = Object.fromEntries(columns.map((c) => [c, ""]));
  const dob = formatDate(t.dob || "", now);
  out["Nombre Completo"] = t.name || "";
  out["Género"] = sexCode(t.sex || "");
  out["Fecha De Nacimiento"] = dob;
  out["Edad"] = t.age || ageFrom(dob, now);
  out["Email"] = t.email || "";
  out["Teléfono"] = formatPhone(t.phone || "");
  out["Dirección"] = t.address || "";
  out["Estado"] = t.state || "";
  out["Condado"] = t.county || "";
  out["Zip Code"] = t.zip || "";
  out["Ingreso Estimado Anual"] = formatMoney(t.income || t.incomeAlt || "");
  out["Nombre Del Plan"] = t.plan || "";
  // Como en Cristhyam: dependientes = familiares listados y total = titular + dependientes.
  out["Número De Aplicantes"] = t.applicants || "1";
  out["Número De Dependientes"] = String(source.members.length);
  out["Total De Miembros"] = String(source.members.length + 1);

  for (const { slot, person, date, age } of slots) {
    out[`Dependiente (${slot})`] = person.name;
    out[`Fecha de nacimiento (${slot})`] = date;
    out[`Edad (${slot})`] = age;
    out[`Sexo (${slot})`] = sexCode(person.sex);
  }
  return out;
}

export type CristhyamSheet = { columns: string[]; rows: Record<string, string>[] };

/**
 * Traduce las filas de un Excel al formato Cristhyam. Devuelve null si ya viene en ese
 * formato o si no tiene ninguna columna de nombre reconocible (entonces se importa tal cual).
 * `Number` queda vacío: lo rellena quien importa con el orden del archivo.
 */
export function adaptRowsToCristhyam(
  rows: Record<string, unknown>[],
  headers: string[],
  now = new Date()
): CristhyamSheet | null {
  if (!rows.length || isCristhyamFormat(headers)) return null;
  if (!headers.some((h) => fieldOf(baseKey(h)) === "name")) return null;
  const sources = rows.map((row) => readRow(row, headers));
  const slots = sources.map((s) => familySlots(s.members, now));
  // Más de 2 hijos: se añaden bloques Hijo 3, Hijo 4… al final.
  const maxChildren = Math.max(0, ...slots.map((list) => list.filter((x) => x.slot !== "Pareja").length));
  const columns = [...CRISTHYAM_COLUMNS];
  for (let n = 3; n <= maxChildren; n++) columns.push(...personColumns(`Hijo ${n}`));
  return { columns, rows: sources.map((s, i) => toCristhyamRow(s, slots[i], columns, now)) };
}
