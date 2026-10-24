/**
 * Sincroniza leads → realizado según cartas de consentimiento (Cristhyam u opcionalmente todos).
 * Uso:
 *   node scripts/sync-cartas-realizados.mjs          # dry-run
 *   node scripts/sync-cartas-realizados.mjs --apply  # aplica UPDATE status=realizado
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  extractPersonFromCartaLabel,
  fuzzyPersonMatch,
  normalizePersonName,
} from "./carta-name-utils.mjs";

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

const APPLY = process.argv.includes("--apply");
const ALL_TARGETS = process.argv.includes("--all-targets");

const sb = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

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

const targets = await fetchAll("report_targets", "id, name");
const cris = targets.find((t) => normalizePersonName(t.name) === "cristhyam");
const targetIds = ALL_TARGETS
  ? new Set(targets.map((t) => t.id))
  : new Set(cris ? [cris.id] : []);

const entries = (await fetchAll(
  "report_entries",
  "id, target_id, type, title, file_name, created_at"
)).filter((e) => e.type === "consent" && targetIds.has(e.target_id));

const names = await fetchAll("report_entry_names", "entry_id, full_name");
const namesBy = new Map();
for (const n of names) {
  const a = namesBy.get(n.entry_id) || [];
  a.push(n.full_name);
  namesBy.set(n.entry_id, a);
}

const leads = await fetchAll(
  "leads",
  "id, first_name, last_name, status, lead_number, phone, email, updated_at"
);

const leadRows = leads.map((l) => ({
  ...l,
  full: normalizePersonName(`${l.first_name || ""} ${l.last_name || ""}`),
}));

const byExact = new Map();
for (const l of leadRows) {
  if (!l.full) continue;
  const a = byExact.get(l.full) || [];
  a.push(l);
  byExact.set(l.full, a);
}

/** Preferir lead ya realizado; si no, el de menor lead_number. */
function pickLead(candidates) {
  const real = candidates.filter((c) => c.status === "realizado");
  const pool = real.length ? real : candidates;
  return [...pool].sort((a, b) => (a.lead_number || 0) - (b.lead_number || 0))[0];
}

function findBestLead(person) {
  const exact = byExact.get(person);
  if (exact?.length) return { lead: pickLead(exact), how: "exact", person };

  let best = null;
  for (const l of leadRows) {
    const how = fuzzyPersonMatch(person, l.full);
    if (!how) continue;
    if (!best || (l.status === "realizado" && best.lead.status !== "realizado")) {
      best = { lead: l, how, person };
    }
  }
  return best;
}

// Cartas por persona
const cartaByPerson = new Map();
for (const e of entries) {
  const entryNames = namesBy.get(e.id) || [];
  const raws = entryNames.length ? entryNames : [e.file_name || e.title || ""];
  for (const raw of raws) {
    const person = extractPersonFromCartaLabel(raw);
    if (!person) continue;
    const g = cartaByPerson.get(person) || [];
    g.push({
      entryId: e.id,
      file: e.file_name,
      created: e.created_at,
      raw,
    });
    cartaByPerson.set(person, g);
  }
}

const dupCartas = [...cartaByPerson.entries()]
  .filter(([, g]) => g.length > 1)
  .map(([person, g]) => {
    const sorted = [...g].sort((a, b) => a.created.localeCompare(b.created));
    return {
      person,
      keep: sorted[0].entryId,
      deleteIds: sorted.slice(1).map((x) => x.entryId),
      files: sorted.map((x) => x.file),
    };
  });

const alreadyReal = [];
const toMark = [];
const unmatchedCartas = [];
const matchedHow = { exact: 0, "token-perm": 0, typo: 0 };

for (const [person, g] of cartaByPerson) {
  const hit = findBestLead(person);
  if (!hit) {
    unmatchedCartas.push({ person, file: g[0].file, entryId: g[0].entryId });
    continue;
  }
  matchedHow[hit.how] = (matchedHow[hit.how] || 0) + 1;
  if (hit.lead.status === "realizado") {
    alreadyReal.push({
      person,
      leadId: hit.lead.id,
      lead_number: hit.lead.lead_number,
      how: hit.how,
    });
  } else {
    toMark.push({
      person,
      leadId: hit.lead.id,
      lead_number: hit.lead.lead_number,
      status: hit.lead.status,
      how: hit.how,
      file: g[0].file,
    });
  }
}

const realizados = leadRows.filter((l) => l.status === "realizado");
const cartaPeople = [...cartaByPerson.keys()];
const realizadosSinCarta = realizados.filter((l) => {
  if (cartaByPerson.has(l.full)) return false;
  return !cartaPeople.some((p) => fuzzyPersonMatch(p, l.full));
});

console.log(
  JSON.stringify(
    {
      mode: APPLY ? "APPLY" : "DRY_RUN",
      target: ALL_TARGETS ? "all" : cris?.name || null,
      consentEntries: entries.length,
      uniqueCartaPeople: cartaByPerson.size,
      duplicateCartaGroups: dupCartas.length,
      duplicateCartaExtraRows: dupCartas.reduce((s, d) => s + d.deleteIds.length, 0),
      duplicateCartaSample: dupCartas.slice(0, 20),
      matchedHow,
      alreadyRealizado: alreadyReal.length,
      toMarkRealizado: toMark.length,
      unmatchedCartas: unmatchedCartas.length,
      toMarkSample: toMark.slice(0, 40),
      unmatchedSample: unmatchedCartas.slice(0, 40),
      realizadosTotal: realizados.length,
      realizadosSinCarta: realizadosSinCarta.length,
      realizadosSinCartaSample: realizadosSinCarta.slice(0, 20).map((l) => ({
        full: l.full,
        lead_number: l.lead_number,
      })),
      projectedRealizados: realizados.length + toMark.length,
      cartasVsProjected: entries.length - (realizados.length + toMark.length),
    },
    null,
    2
  )
);

if (APPLY && toMark.length) {
  let ok = 0;
  let fail = 0;
  const now = new Date().toISOString();
  for (const row of toMark) {
    const { error } = await sb
      .from("leads")
      .update({ status: "realizado", updated_at: now })
      .eq("id", row.leadId)
      .neq("status", "realizado");
    if (error) {
      fail++;
      console.error("FAIL", row.leadId, error.message);
    } else ok++;
  }
  console.log(JSON.stringify({ applied: ok, failed: fail }, null, 2));
}

if (APPLY && dupCartas.length) {
  const deleteIds = dupCartas.flatMap((d) => d.deleteIds);
  console.log(
    JSON.stringify(
      {
        note: "Hay grupos de cartas duplicadas por persona. No se borran automáticamente aquí; revisa deleteIds.",
        deleteIds,
      },
      null,
      2
    )
  );
}
