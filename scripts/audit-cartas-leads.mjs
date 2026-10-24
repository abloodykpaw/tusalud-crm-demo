/**
 * Audita duplicados de cartas y desfase vs leads realizados.
 * Uso: node scripts/audit-cartas-leads.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

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

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const sb = createClient(url, key, { auth: { persistSession: false } });

function normName(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function leadFullName(l) {
  return normName(`${l.first_name || ""} ${l.last_name || ""}`);
}

async function fetchAll(table, columns, pageSize = 1000) {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await sb
      .from(table)
      .select(columns)
      .range(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

const targets = await fetchAll("report_targets", "id, name, slug");
const cristhyam = targets.find(
  (t) =>
    normName(t.name).includes("cristhyam") ||
    String(t.slug || "").includes("cristhyam")
);

const entries = await fetchAll(
  "report_entries",
  "id, target_id, type, title, file_name, report_date, created_at"
);
const names = await fetchAll("report_entry_names", "entry_id, full_name, sort_order");
const leads = await fetchAll(
  "leads",
  "id, first_name, last_name, phone, email, status, lead_number, assigned_agent_id, created_at"
);

const namesByEntry = new Map();
for (const n of names) {
  const list = namesByEntry.get(n.entry_id) || [];
  list.push(n.full_name);
  namesByEntry.set(n.entry_id, list);
}

const consentAll = entries.filter((e) => e.type === "consent");
const consentCris = cristhyam
  ? consentAll.filter((e) => e.target_id === cristhyam.id)
  : [];

function dupKey(e) {
  const entryNames = (namesByEntry.get(e.id) || []).map(normName).sort().join("|");
  const file = normName(e.file_name || "");
  const title = normName(e.title || "");
  // Prefer file+names; fall back to title
  return `${file}::${entryNames || title}`;
}

function findDuplicates(list) {
  const groups = new Map();
  for (const e of list) {
    const key = dupKey(e);
    const g = groups.get(key) || [];
    g.push(e);
    groups.set(key, g);
  }
  const dups = [];
  for (const [key, g] of groups) {
    if (g.length < 2) continue;
    g.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    dups.push({
      key,
      count: g.length,
      keep: g[0].id,
      delete: g.slice(1).map((x) => x.id),
      samples: g.map((x) => ({
        id: x.id,
        file_name: x.file_name,
        title: x.title,
        created_at: x.created_at,
        names: namesByEntry.get(x.id) || [],
      })),
    });
  }
  return dups;
}

const dupsAll = findDuplicates(consentAll);
const dupsCris = findDuplicates(consentCris);

const realizados = leads.filter((l) => l.status === "realizado");
const realizadosNames = new Set(realizados.map(leadFullName).filter(Boolean));

const cartaPeople = [];
for (const e of consentCris.length ? consentCris : consentAll) {
  const entryNames = namesByEntry.get(e.id) || [];
  if (entryNames.length) {
    for (const n of entryNames) cartaPeople.push({ entryId: e.id, name: normName(n), raw: n });
  } else if (e.file_name) {
    const stem = String(e.file_name).replace(/\.[^.]+$/, "");
    cartaPeople.push({ entryId: e.id, name: normName(stem), raw: stem });
  }
}

const uniqueCartaNames = [...new Set(cartaPeople.map((p) => p.name).filter(Boolean))];
const cartaInRealizados = uniqueCartaNames.filter((n) => realizadosNames.has(n));
const cartaMissingInLeads = uniqueCartaNames.filter((n) => !realizadosNames.has(n));

// Also check if missing names exist as non-realizado leads
const leadByName = new Map();
for (const l of leads) {
  const n = leadFullName(l);
  if (!n) continue;
  const arr = leadByName.get(n) || [];
  arr.push(l);
  leadByName.set(n, arr);
}

const missingButActiveLead = [];
const missingNoLead = [];
for (const n of cartaMissingInLeads) {
  const hits = leadByName.get(n) || [];
  if (hits.length) missingButActiveLead.push({ name: n, leads: hits.map((h) => ({ id: h.id, status: h.status, lead_number: h.lead_number })) });
  else missingNoLead.push(n);
}

const realizadosWithoutCarta = [...realizadosNames].filter((n) => !uniqueCartaNames.includes(n));

console.log(
  JSON.stringify(
    {
      targets: targets.map((t) => ({ id: t.id, name: t.name })),
      cristhyam,
      counts: {
        consent_all: consentAll.length,
        consent_cristhyam: consentCris.length,
        leads_total: leads.length,
        leads_realizados: realizados.length,
        unique_carta_names_cris_or_all: uniqueCartaNames.length,
        carta_names_also_realizado: cartaInRealizados.length,
        carta_names_not_realizado: cartaMissingInLeads.length,
        missing_but_active_lead: missingButActiveLead.length,
        missing_no_lead: missingNoLead.length,
        realizados_without_carta_name: realizadosWithoutCarta.length,
      },
      duplicate_consent_all: {
        groups: dupsAll.length,
        extra_rows: dupsAll.reduce((s, d) => s + d.delete.length, 0),
      },
      duplicate_consent_cristhyam: {
        groups: dupsCris.length,
        extra_rows: dupsCris.reduce((s, d) => s + d.delete.length, 0),
        groups_detail: dupsCris.slice(0, 30),
      },
      sample_missing_but_active: missingButActiveLead.slice(0, 20),
      sample_missing_no_lead: missingNoLead.slice(0, 20),
      sample_realizados_without_carta: realizadosWithoutCarta.slice(0, 20),
    },
    null,
    2
  )
);
