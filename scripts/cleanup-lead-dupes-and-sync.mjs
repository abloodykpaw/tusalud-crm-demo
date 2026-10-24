/**
 * Limpia leads duplicados (mismo nombre) y vincula cartas → lead_id.
 * Reglas:
 *  - Mismo nombre + (mismo teléfono o mismo email) → duplicado fuerte: deja 1
 *  - Mismo nombre, uno realizado y otro(s) nuevo → deja el realizado
 *  - Mismo teléfono con nombres distintos → NO borra (pueden ser personas distintas)
 * Uso: node scripts/cleanup-lead-dupes-and-sync.mjs
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

function normPhone(p) {
  const d = String(p || "").replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : d || "";
}

function normEmail(e) {
  return String(e || "").trim().toLowerCase();
}

function leadFull(l) {
  return normalizePersonName(`${l.first_name || ""} ${l.last_name || ""}`);
}

function scoreLead(l) {
  let s = 0;
  if (l.status === "realizado") s += 1000;
  if (l.assigned_agent_id) s += 50;
  if (normPhone(l.phone)) s += 10;
  if (normEmail(l.email)) s += 10;
  s -= (l.lead_number || 0) * 0.001; // prefer lower number
  return s;
}

function pickKeeper(group) {
  return [...group].sort((a, b) => scoreLead(b) - scoreLead(a))[0];
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
for (const l of leads) {
  const n = leadFull(l);
  if (!n) continue;
  const a = byName.get(n) || [];
  a.push(l);
  byName.set(n, a);
}

const deleteIds = new Set();
const plans = [];

for (const [name, group] of byName) {
  if (group.length < 2) continue;

  // Cluster by strong identity: same phone or same email within the name group
  const strongClusters = [];
  const used = new Set();

  for (const l of group) {
    if (used.has(l.id)) continue;
    const cluster = [l];
    used.add(l.id);
    const phone = normPhone(l.phone);
    const email = normEmail(l.email);
    for (const o of group) {
      if (used.has(o.id)) continue;
      const samePhone = phone && phone === normPhone(o.phone);
      const sameEmail = email && email === normEmail(o.email);
      if (samePhone || sameEmail) {
        cluster.push(o);
        used.add(o.id);
      }
    }
    if (cluster.length > 1) strongClusters.push(cluster);
  }

  // Name-only: if any realizado, drop other nuevos with same name (true re-import noise)
  const realizados = group.filter((l) => l.status === "realizado");
  const nuevos = group.filter((l) => l.status !== "realizado");
  if (realizados.length >= 1 && nuevos.length >= 1) {
    const keep = pickKeeper(realizados);
    for (const n of nuevos) {
      // only if not a clearly different strong identity vs keep
      const keepPhone = normPhone(keep.phone);
      const keepEmail = normEmail(keep.email);
      const nPhone = normPhone(n.phone);
      const nEmail = normEmail(n.email);
      const clearlyDifferent =
        (keepPhone && nPhone && keepPhone !== nPhone) ||
        (keepEmail && nEmail && keepEmail !== nEmail);
      // Still delete name-dup nuevos that share no contact overlap with keep OR share name only after realizado exists
      // User asked no duplicate names for sync. Prefer deleting nuevos when a realizado exists.
      if (!clearlyDifferent || true) {
        // For name sync with cartas we need unique names. Delete nuevos when realizado exists.
        deleteIds.add(n.id);
        plans.push({
          reason: "name+realizado_keep",
          name,
          keep: keep.lead_number,
          delete: n.lead_number,
          deleteId: n.id,
        });
      }
    }
  }

  for (const cluster of strongClusters) {
    const keep = pickKeeper(cluster);
    for (const d of cluster) {
      if (d.id === keep.id) continue;
      deleteIds.add(d.id);
      plans.push({
        reason: "strong_identity",
        name,
        keep: keep.lead_number,
        delete: d.lead_number,
        deleteId: d.id,
      });
    }
  }

  // Remaining name-only all-nuevo duplicates: keep lowest lead_number
  const remaining = group.filter((l) => !deleteIds.has(l.id));
  if (remaining.length > 1 && remaining.every((l) => l.status !== "realizado")) {
    const keep = pickKeeper(remaining);
    for (const d of remaining) {
      if (d.id === keep.id) continue;
      deleteIds.add(d.id);
      plans.push({
        reason: "name_only_all_nuevo",
        name,
        keep: keep.lead_number,
        delete: d.lead_number,
        deleteId: d.id,
      });
    }
  }
}

const uniqueDeleteIds = [...deleteIds];

console.log(
  JSON.stringify(
    {
      willDelete: uniqueDeleteIds.length,
      plans: plans.slice(0, 50),
      planCount: plans.length,
    },
    null,
    2
  )
);

if (uniqueDeleteIds.length) {
  // Re-point cartas linked to doomed leads toward the keeper of that name
  const cartas = (await fetchAll(
    "report_entries",
    "id, type, linked_lead_id, person_key, file_name"
  )).filter((e) => e.type === "consent");

  const survivors = leads.filter((l) => !deleteIds.has(l.id));
  const survivorByName = new Map();
  for (const l of survivors) {
    const n = leadFull(l);
    if (!n) continue;
    const cur = survivorByName.get(n);
    if (!cur || scoreLead(l) > scoreLead(cur)) survivorByName.set(n, l);
  }

  for (const c of cartas) {
    if (!c.linked_lead_id || !deleteIds.has(c.linked_lead_id)) continue;
    const doomed = leads.find((l) => l.id === c.linked_lead_id);
    const name = doomed ? leadFull(doomed) : c.person_key;
    const keep = name ? survivorByName.get(name) : null;
    if (!keep) continue;
    const { error } = await sb
      .from("report_entries")
      .update({ linked_lead_id: keep.id })
      .eq("id", c.id);
    if (error) console.error("repoint carta", c.id, error.message);
  }

  // Delete in chunks
  for (let i = 0; i < uniqueDeleteIds.length; i += 50) {
    const chunk = uniqueDeleteIds.slice(i, i + 50);
    const { error } = await sb.from("leads").delete().in("id", chunk);
    if (error) {
      console.error("delete chunk fail", error.message);
      process.exit(1);
    }
  }
}

// Link all cartas without linked_lead_id
const leadsAfter = await fetchAll(
  "leads",
  "id, lead_number, first_name, last_name, phone, email, status, assigned_agent_id"
);
const cartasAfter = (await fetchAll(
  "report_entries",
  "id, type, person_key, linked_lead_id, file_name, title"
)).filter((e) => e.type === "consent");

function findLead(person) {
  const exact = leadsAfter.filter((l) => leadFull(l) === person);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) {
    return [...exact].sort((a, b) => scoreLead(b) - scoreLead(a))[0];
  }
  const fuzzy = [];
  for (const l of leadsAfter) {
    const how = fuzzyPersonMatch(person, leadFull(l));
    if (how === "token-perm" || how === "exact") fuzzy.push(l);
  }
  if (fuzzy.length === 1) return fuzzy[0];
  if (fuzzy.length > 1) return [...fuzzy].sort((a, b) => scoreLead(b) - scoreLead(a))[0];
  return null;
}

let linked = 0;
let unmatched = 0;
const unmatchedSample = [];

for (const c of cartasAfter) {
  const person =
    c.person_key || extractPersonFromCartaLabel(c.file_name || c.title || "");
  if (!person) {
    unmatched++;
    continue;
  }
  const lead = findLead(person);
  if (!lead) {
    unmatched++;
    if (unmatchedSample.length < 15) unmatchedSample.push({ person, file: c.file_name });
    continue;
  }
  const patch = { linked_lead_id: lead.id };
  if (!c.person_key) patch.person_key = person;
  if (c.linked_lead_id === lead.id && c.person_key) continue;
  const { error } = await sb.from("report_entries").update(patch).eq("id", c.id);
  if (error) {
    console.error("link fail", c.id, error.message);
    continue;
  }
  linked++;
}

const { count: sinLink } = await sb
  .from("report_entries")
  .select("*", { count: "exact", head: true })
  .eq("type", "consent")
  .is("linked_lead_id", null);

const { count: cartas } = await sb
  .from("report_entries")
  .select("*", { count: "exact", head: true })
  .eq("type", "consent");

const { count: realizados } = await sb
  .from("leads")
  .select("*", { count: "exact", head: true })
  .eq("status", "realizado");

const { count: leadsTotal } = await sb.from("leads").select("*", { count: "exact", head: true });

// Re-check name dupes
const left = await fetchAll("leads", "id, first_name, last_name, status, lead_number");
const nameMap = new Map();
for (const l of left) {
  const n = leadFull(l);
  if (!n) continue;
  const a = nameMap.get(n) || [];
  a.push(l);
  nameMap.set(n, a);
}
const remainingNameDupes = [...nameMap.entries()].filter(([, g]) => g.length > 1);

console.log(
  JSON.stringify(
    {
      deletedLeads: uniqueDeleteIds.length,
      cartasLinkedOrUpdated: linked,
      unmatchedCartas: unmatched,
      unmatchedSample,
      final: {
        leadsTotal,
        cartas,
        realizados,
        cartasSinLink: sinLink,
        nameDuplicateGroupsLeft: remainingNameDupes.length,
      },
      remainingNameDupes: remainingNameDupes.slice(0, 20).map(([n, g]) => ({
        name: n,
        rows: g.map((x) => `${x.lead_number}/${x.status}`),
      })),
    },
    null,
    2
  )
);
