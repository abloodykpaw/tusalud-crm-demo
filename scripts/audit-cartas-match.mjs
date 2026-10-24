/**
 * Cruza cartas (por nombre de persona) con leads realizados.
 * Uso: node scripts/audit-cartas-match.mjs
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

const sb = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

function norm(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractPerson(fileOrTitle) {
  let s = String(fileOrTitle || "").replace(/\.[^.]+$/, "");
  s = s.replace(/^\d+\s*/, "");
  s = s
    .replace(/^carta\s+(de\s+)?consentimiento\s*/i, "")
    .replace(/^consentimiento\s*/i, "")
    .replace(/^carta\s*/i, "");
  return norm(s);
}

function tokens(s) {
  return norm(s).split(" ").filter(Boolean);
}

/** Match exacto o por tokens (todas las palabras de la carta están en el lead o viceversa, min 2). */
function nameMatches(cartaName, leadName) {
  if (!cartaName || !leadName) return false;
  if (cartaName === leadName) return true;
  const ct = tokens(cartaName);
  const lt = tokens(leadName);
  if (ct.length < 2 || lt.length < 2) return false;
  const cset = new Set(ct);
  const lset = new Set(lt);
  const cartaInLead = ct.every((t) => lset.has(t));
  const leadInCarta = lt.every((t) => cset.has(t));
  return cartaInLead || leadInCarta;
}

async function fetchAll(table, columns) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from(table)
      .select(columns)
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

const targets = await fetchAll("report_targets", "id, name");
const cris = targets.find((t) => norm(t.name) === "cristhyam");
const entries = (await fetchAll(
  "report_entries",
  "id, target_id, type, title, file_name, created_at"
)).filter((e) => e.type === "consent" && e.target_id === cris.id);

const names = await fetchAll("report_entry_names", "entry_id, full_name");
const namesBy = new Map();
for (const n of names) {
  const a = namesBy.get(n.entry_id) || [];
  a.push(n.full_name);
  namesBy.set(n.entry_id, a);
}

const leads = await fetchAll(
  "leads",
  "id, first_name, last_name, status, lead_number"
);

const byPerson = new Map();
for (const e of entries) {
  const entryNames = namesBy.get(e.id) || [];
  const people = entryNames.length
    ? entryNames.map(extractPerson)
    : [extractPerson(e.file_name || e.title)];
  for (const p of people) {
    if (!p) continue;
    const g = byPerson.get(p) || [];
    g.push({ id: e.id, file: e.file_name, created: e.created_at, person: p });
    byPerson.set(p, g);
  }
}

const dupPeople = [...byPerson.entries()]
  .filter(([, g]) => g.length > 1)
  .map(([p, g]) => ({
    person: p,
    count: g.length,
    keep: [...g].sort((a, b) => a.created.localeCompare(b.created))[0].id,
    deleteIds: [...g]
      .sort((a, b) => a.created.localeCompare(b.created))
      .slice(1)
      .map((x) => x.id),
    files: g.map((x) => x.file),
  }));

const leadRows = leads.map((l) => ({
  ...l,
  full: norm(`${l.first_name || ""} ${l.last_name || ""}`),
}));

function findLead(person) {
  const exact = leadRows.filter((l) => l.full === person);
  if (exact.length) return exact;
  return leadRows.filter((l) => nameMatches(person, l.full));
}

let matchedReal = 0;
let matchedOther = 0;
let noLead = 0;
const otherStatus = [];
const unmatched = [];
const multiMatch = [];

for (const [p, g] of byPerson) {
  const hits = findLead(p);
  if (!hits.length) {
    noLead++;
    unmatched.push({ p, file: g[0].file });
    continue;
  }
  if (hits.length > 1) {
    multiMatch.push({
      p,
      hits: hits.map((h) => ({
        id: h.id,
        status: h.status,
        lead_number: h.lead_number,
        full: h.full,
      })),
    });
  }
  if (hits.some((h) => h.status === "realizado")) matchedReal++;
  else {
    matchedOther++;
    otherStatus.push({
      p,
      status: hits[0].status,
      lead_number: hits[0].lead_number,
      leadId: hits[0].id,
      file: g[0].file,
    });
  }
}

const realizados = leadRows.filter((l) => l.status === "realizado");
const cartaPeople = [...byPerson.keys()];
const realizadosNoCarta = [];
for (const l of realizados) {
  const hit = cartaPeople.some((p) => nameMatches(p, l.full) || p === l.full);
  if (!hit) realizadosNoCarta.push({ n: l.full, lead_number: l.lead_number, id: l.id });
}

console.log(
  JSON.stringify(
    {
      consent: entries.length,
      uniquePeople: byPerson.size,
      dupPeopleGroups: dupPeople.length,
      dupExtra: dupPeople.reduce((s, d) => s + d.count - 1, 0),
      dupSample: dupPeople.slice(0, 40),
      matchedReal,
      matchedOther,
      noLead,
      otherStatusSample: otherStatus.slice(0, 40),
      unmatchedSample: unmatched.slice(0, 40),
      multiMatchSample: multiMatch.slice(0, 20),
      realizados: realizados.length,
      realizadosNoCarta: realizadosNoCarta.length,
      realizadosNoCartaSample: realizadosNoCarta.slice(0, 40),
      delta_cartas_vs_realizados: entries.length - realizados.length,
    },
    null,
    2
  )
);
