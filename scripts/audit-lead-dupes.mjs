/**
 * Audita leads duplicados por nombre, teléfono o email.
 * Uso: node scripts/audit-lead-dupes.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { normalizePersonName } from "./carta-name-utils.mjs";

function loadEnv() {
  for (const name of [".env", ".env.local"]) {
    const path = resolve(process.cwd(), name);
    if (!existsSync(path)) continue;
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
      if (val && !process.env[key]) process.env[key] = val;
    }
  }
}

loadEnv();

const sb = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

function normPhone(p) {
  const d = String(p || "").replace(/\D/g, "");
  if (d.length >= 10) return d.slice(-10);
  return d || "";
}

function normEmail(e) {
  return String(e || "").trim().toLowerCase();
}

async function fetchAll(table, columns) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(table).select(columns).range(from, from + 999);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

const leads = await fetchAll(
  "leads",
  "id, lead_number, first_name, last_name, phone, email, status, assigned_agent_id, created_at"
);

const byName = new Map();
const byPhone = new Map();
const byEmail = new Map();

for (const l of leads) {
  const name = normalizePersonName(`${l.first_name || ""} ${l.last_name || ""}`);
  const phone = normPhone(l.phone);
  const email = normEmail(l.email);
  if (name) {
    const a = byName.get(name) || [];
    a.push(l);
    byName.set(name, a);
  }
  if (phone) {
    const a = byPhone.get(phone) || [];
    a.push(l);
    byPhone.set(phone, a);
  }
  if (email) {
    const a = byEmail.get(email) || [];
    a.push(l);
    byEmail.set(email, a);
  }
}

function groups(map, keyLabel) {
  return [...map.entries()]
    .filter(([, g]) => g.length > 1)
    .map(([key, g]) => ({
      keyLabel,
      key,
      count: g.length,
      rows: g
        .map((l) => ({
          id: l.id,
          lead_number: l.lead_number,
          name: `${l.first_name || ""} ${l.last_name || ""}`.trim(),
          status: l.status,
          phone: l.phone,
          email: l.email,
        }))
        .sort((a, b) => (a.lead_number || 0) - (b.lead_number || 0)),
    }));
}

const nameDupes = groups(byName, "name");
const phoneDupes = groups(byPhone, "phone");
const emailDupes = groups(byEmail, "email");

const cartas = (await fetchAll(
  "report_entries",
  "id, type, person_key, linked_lead_id, file_name"
)).filter((e) => e.type === "consent");

const sinLink = cartas.filter((c) => !c.linked_lead_id);
const realizados = leads.filter((l) => l.status === "realizado");

console.log(
  JSON.stringify(
    {
      leadsTotal: leads.length,
      realizados: realizados.length,
      cartas: cartas.length,
      cartasSinLink: sinLink.length,
      nameDuplicateGroups: nameDupes.length,
      nameExtraRows: nameDupes.reduce((s, g) => s + g.count - 1, 0),
      phoneDuplicateGroups: phoneDupes.length,
      phoneExtraRows: phoneDupes.reduce((s, g) => s + g.count - 1, 0),
      emailDuplicateGroups: emailDupes.length,
      emailExtraRows: emailDupes.reduce((s, g) => s + g.count - 1, 0),
      nameDupesSample: nameDupes.slice(0, 40),
      phoneDupesSample: phoneDupes.slice(0, 20),
      emailDupesSample: emailDupes.slice(0, 20),
      sinLinkSample: sinLink.slice(0, 20),
    },
    null,
    2
  )
);
