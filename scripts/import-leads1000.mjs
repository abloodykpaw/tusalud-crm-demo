/**
 * Importa Leads1000 al CRM en Supabase con raw_data completo y dependientes.
 * Uso: node scripts/import-leads1000.mjs [xlsx] [agentUsername]
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import XLSX from "xlsx";

function loadEnv() {
  const path = resolve(process.cwd(), ".env");
  if (!existsSync(path)) return;
  let text = readFileSync(path, "utf8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (val) process.env[key] = val;
  }
}

function normKey(key) {
  return key.trim().toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
}

function mapLeadFromExcelRow(row) {
  const rawData = Object.fromEntries(
    Object.entries(row).map(([k, v]) => [k, String(v ?? "").trim()])
  );

  function cell(...keys) {
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

  return {
    firstName,
    lastName,
    phone: cell("telefono", "teléfono", "phone", "celular", "móvil", "movil", "whatsapp"),
    email: cell("email", "correo", "mail", "e-mail"),
    city: cell("condado", "ciudad", "city", "municipio", "estado") || cell("dirección", "direccion", "address"),
    rawData,
    ok: !!(fullName || firstName),
  };
}

loadEnv();

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const xlsxPath = process.argv[2] || "C:/Users/Abloody/Desktop/Leads1000_2026-09-02_200945.xlsx";
const agentUsername = (process.argv[3] || "kennedy").toLowerCase();
const fileName = xlsxPath.split(/[/\\]/).pop() || "Leads1000.xlsx";

if (!url || !serviceKey) {
  console.error("Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en .env");
  process.exit(1);
}
if (!existsSync(xlsxPath)) {
  console.error(`No se encontró: ${xlsxPath}`);
  process.exit(1);
}

const sb = createClient(url, serviceKey, { auth: { persistSession: false } });

const { data: agent, error: agentErr } = await sb
  .from("profiles")
  .select("id, full_name, username")
  .eq("username", agentUsername)
  .maybeSingle();

if (agentErr || !agent) {
  console.error("Agente no encontrado:", agentUsername, agentErr?.message || "");
  process.exit(1);
}

const wb = XLSX.readFile(xlsxPath);
const sheet = wb.Sheets[wb.SheetNames[0]];
// Orden de filas = orden del Excel (arriba → abajo).
const rows = XLSX.utils.sheet_to_json(sheet, {
  defval: "",
  blankrows: false,
  raw: false,
});
const columnOrder = rows.length ? Object.keys(rows[0]) : [];
const dayStart = new Date();
dayStart.setHours(12, 0, 0, 0);
const source = `Excel · ${fileName}`;

function excelNumber(rawData) {
  for (const [key, value] of Object.entries(rawData || {})) {
    const k = normKey(key);
    if (k !== "number" && k !== "numero" && k !== "nro" && k !== "#") continue;
    const n = parseInt(String(value).replace(/[^\d]/g, ""), 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

const leads = rows
  .map(mapLeadFromExcelRow)
  .filter((r) => r.ok)
  .map((r, i) => {
    const leadNumber = excelNumber(r.rawData) || i + 1;
    // Si Number viene vacío en el Excel, lo rellenamos con el orden de fila.
    const rawData = { ...r.rawData };
    const numberKey =
      Object.keys(rawData).find((k) => {
        const nk = normKey(k);
        return nk === "number" || nk === "numero" || nk === "nro" || nk === "#";
      }) || "Number";
    if (!(rawData[numberKey] || "").trim()) {
      rawData[numberKey] = String(leadNumber);
    }
    // Misma fecha de negocio; milisegundos crecientes = orden estable.
    const created = new Date(dayStart.getTime() + i).toISOString();
    return {
      id: randomUUID(),
      lead_number: leadNumber,
      first_name: r.firstName,
      last_name: r.lastName,
      phone: r.phone,
      email: r.email,
      city: r.city,
      source,
      status: "nuevo",
      assigned_agent_id: agent.id,
      notes: "",
      raw_data: { ...rawData, _columnOrder: columnOrder },
      created_at: created,
      updated_at: created,
    };
  });

console.log(`Excel: ${rows.length} filas → ${leads.length} leads válidos`);
console.log(`Agente: ${agent.full_name} (${agent.username})`);
console.log(`Orden: lead_number ${leads[0]?.lead_number} → ${leads[leads.length - 1]?.lead_number}`);
console.log(`#1: ${leads[0]?.first_name} ${leads[0]?.last_name}`);

const CHUNK = 100;
let inserted = 0;

for (let i = 0; i < leads.length; i += CHUNK) {
  const chunk = leads.slice(i, i + CHUNK);
  const { error } = await sb.from("leads").insert(chunk);
  if (error) {
    console.error(`Error en lote ${i / CHUNK + 1}:`, error.message);
    process.exit(1);
  }
  inserted += chunk.length;
  console.log(`  Insertados ${inserted}/${leads.length}`);
}

await sb.from("history_events").insert({
  actor_id: agent.id,
  actor_name: "Sistema",
  actor_role: "admin",
  module: "leads",
  type: "leads_imported",
  summary: `Importados ${inserted} leads → ${agent.full_name} (${fileName})`,
  meta: { count: inserted, agentId: agent.id, fileName },
});

const { count } = await sb.from("leads").select("*", { count: "exact", head: true });
console.log(`Listo. Total leads en BD: ${count}`);
console.log(`Primero en BD (por lead_number): comprobar en la app tras refrescar.`);
