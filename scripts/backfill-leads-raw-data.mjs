/**
 * Rellena raw_data y column_order en leads ya importados desde Leads1000.
 * Uso: node scripts/backfill-leads-raw-data.mjs [ruta-al-xlsx]
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import XLSX from "xlsx";

function normKey(key) {
  return key
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

function normalizePhone(value) {
  return String(value || "").replace(/\D/g, "");
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
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (val) process.env[key] = val;
  }
}

loadEnv();

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const xlsxPath =
  process.argv[2] ||
  "C:/Users/Abloody/Desktop/Leads1000_2026-09-02_200945.xlsx";

if (!url || !serviceKey) {
  console.error("Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en .env");
  process.exit(1);
}

if (!existsSync(xlsxPath)) {
  console.error(`No se encontró el Excel: ${xlsxPath}`);
  process.exit(1);
}

const sb = createClient(url, serviceKey, { auth: { persistSession: false } });

const wb = XLSX.readFile(xlsxPath);
const sheet = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
const columnOrder = rows.length ? Object.keys(rows[0]) : [];

const byPhone = new Map();
const byEmail = new Map();

for (const row of rows) {
  const mapped = mapLeadFromExcelRow(row);
  const phoneKey = normalizePhone(mapped.phone);
  const emailKey = mapped.email.trim().toLowerCase();
  const payload = {
    raw_data: {
      ...mapped.rawData,
      _columnOrder: columnOrder,
    },
    first_name: mapped.firstName,
    last_name: mapped.lastName,
    phone: mapped.phone,
    email: mapped.email,
    city: mapped.city,
    updated_at: new Date().toISOString(),
  };
  if (phoneKey) byPhone.set(phoneKey, payload);
  if (emailKey) byEmail.set(emailKey, payload);
}

console.log(`Excel: ${rows.length} filas, ${columnOrder.length} columnas`);
console.log(`Índice teléfono: ${byPhone.size}, email: ${byEmail.size}`);

const { data: leads, error } = await sb
  .from("leads")
  .select("id, phone, email, source, raw_data")
  .ilike("source", "%Leads1000%");

if (error) {
  console.error("Error leyendo leads:", error.message);
  process.exit(1);
}

console.log(`Leads en BD (Leads1000): ${leads?.length || 0}`);

let updated = 0;
let skipped = 0;
let missing = 0;

for (const lead of leads || []) {
  const phoneKey = normalizePhone(lead.phone || "");
  const emailKey = (lead.email || "").trim().toLowerCase();
  const patch = (phoneKey && byPhone.get(phoneKey)) || (emailKey && byEmail.get(emailKey));

  if (!patch) {
    missing++;
    continue;
  }

  const hasRaw =
    lead.raw_data &&
    typeof lead.raw_data === "object" &&
    Object.keys(lead.raw_data).filter((k) => k !== "_columnOrder").length > 0;

  if (hasRaw) {
    skipped++;
    continue;
  }

  const { error: upErr } = await sb.from("leads").update(patch).eq("id", lead.id);
  if (upErr) {
    console.error(`Error actualizando ${lead.id}:`, upErr.message);
    continue;
  }
  updated++;
}

console.log(`Actualizados: ${updated}`);
console.log(`Ya tenían raw_data: ${skipped}`);
console.log(`Sin match en Excel: ${missing}`);
