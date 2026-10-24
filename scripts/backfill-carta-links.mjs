/**
 * Rellena linked_lead_id en cartas de consentimiento antiguas.
 * Uso: node scripts/backfill-carta-links.mjs
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

function leadFull(l) {
  return normalizePersonName(`${l.first_name || ""} ${l.last_name || ""}`);
}

function pickLead(candidates) {
  const real = candidates.filter((c) => c.status === "realizado");
  const pool = real.length ? real : candidates;
  return [...pool].sort((a, b) => (a.lead_number || 0) - (b.lead_number || 0))[0];
}

function findLead(person, leads) {
  const exact = leads.filter((l) => leadFull(l) === person);
  if (exact.length) return { lead: pickLead(exact), how: "exact" };
  const hits = [];
  for (const l of leads) {
    const how = fuzzyPersonMatch(person, leadFull(l));
    if (how === "token-perm") hits.push({ lead: l, how });
  }
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) {
    return { lead: pickLead(hits.map((h) => h.lead)), how: "token-perm-multi" };
  }
  return null;
}

const entries = (await fetchAll(
  "report_entries",
  "id, type, file_name, title, person_key, linked_lead_id, target_id"
)).filter((e) => e.type === "consent");

const names = await fetchAll("report_entry_names", "entry_id, full_name, sort_order");
const leads = await fetchAll("leads", "id, first_name, last_name, status, lead_number");

const namesBy = new Map();
for (const n of names) {
  const list = namesBy.get(n.entry_id) || [];
  list.push(n);
  namesBy.set(n.entry_id, list);
}

let linked = 0;
let already = 0;
let unmatched = 0;
let fail = 0;
const unmatchedSample = [];

for (const e of entries) {
  if (e.linked_lead_id) {
    already++;
    continue;
  }

  let person = e.person_key || "";
  if (!person) {
    const entryNames = (namesBy.get(e.id) || []).sort((a, b) => a.sort_order - b.sort_order);
    const raw = entryNames[0]?.full_name || e.file_name || e.title || "";
    person = extractPersonFromCartaLabel(raw);
  }
  if (!person) {
    unmatched++;
    if (unmatchedSample.length < 15) {
      unmatchedSample.push({ id: e.id, file: e.file_name });
    }
    continue;
  }

  const hit = findLead(person, leads);
  if (!hit) {
    unmatched++;
    if (unmatchedSample.length < 15) {
      unmatchedSample.push({ id: e.id, person, file: e.file_name });
    }
    continue;
  }

  const patch = { linked_lead_id: hit.lead.id };
  if (!e.person_key) patch.person_key = person;

  const { error } = await sb.from("report_entries").update(patch).eq("id", e.id);
  if (error) {
    fail++;
    console.error("FAIL", e.id, error.message);
    continue;
  }
  linked++;
}

const { count: stillNull } = await sb
  .from("report_entries")
  .select("*", { count: "exact", head: true })
  .eq("type", "consent")
  .is("linked_lead_id", null);

console.log(
  JSON.stringify(
    {
      consent: entries.length,
      linked,
      alreadyHadLink: already,
      unmatched,
      fail,
      stillWithoutLink: stillNull,
      unmatchedSample,
    },
    null,
    2
  )
);
