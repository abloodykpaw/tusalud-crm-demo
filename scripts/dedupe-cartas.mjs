/**
 * Borra cartas de consentimiento duplicadas (misma persona en el mismo target).
 * Conserva la más antigua. Uso:
 *   node scripts/dedupe-cartas.mjs           # dry-run
 *   node scripts/dedupe-cartas.mjs --apply   # borra
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { extractPersonFromCartaLabel, normalizePersonName } from "./carta-name-utils.mjs";

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
if (!cris) {
  console.error("No se encontró target Cristhyam");
  process.exit(1);
}

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

const byPerson = new Map();
for (const e of entries) {
  const entryNames = namesBy.get(e.id) || [];
  const raws = entryNames.length ? entryNames : [e.file_name || e.title || ""];
  for (const raw of raws) {
    const person = extractPersonFromCartaLabel(raw);
    if (!person) continue;
    const g = byPerson.get(person) || [];
    g.push({ id: e.id, file: e.file_name, created: e.created_at, person });
    byPerson.set(person, g);
  }
}

const groups = [...byPerson.entries()]
  .filter(([, g]) => g.length > 1)
  .map(([person, g]) => {
    const sorted = [...g].sort((a, b) => a.created.localeCompare(b.created));
    return {
      person,
      keep: sorted[0],
      delete: sorted.slice(1),
    };
  });

const deleteIds = groups.flatMap((g) => g.delete.map((d) => d.id));

console.log(
  JSON.stringify(
    {
      mode: APPLY ? "APPLY" : "DRY_RUN",
      consentBefore: entries.length,
      duplicateGroups: groups.length,
      willDelete: deleteIds.length,
      consentAfter: entries.length - deleteIds.length,
      groups: groups.map((g) => ({
        person: g.person,
        keep: g.keep.file,
        delete: g.delete.map((d) => d.file),
      })),
    },
    null,
    2
  )
);

if (!APPLY) {
  console.log("Dry-run OK. Ejecuta con --apply para borrar.");
  process.exit(0);
}

if (!deleteIds.length) {
  console.log("Nada que borrar.");
  process.exit(0);
}

// report_entry_names debería cascader; si no, borramos names primero
const { error: namesErr } = await sb.from("report_entry_names").delete().in("entry_id", deleteIds);
if (namesErr) {
  console.error("Error borrando names:", namesErr);
  process.exit(1);
}

const { error: entriesErr } = await sb.from("report_entries").delete().in("id", deleteIds);
if (entriesErr) {
  console.error("Error borrando entries:", entriesErr);
  process.exit(1);
}

const { count } = await sb
  .from("report_entries")
  .select("*", { count: "exact", head: true })
  .eq("target_id", cris.id)
  .eq("type", "consent");

console.log(JSON.stringify({ deleted: deleteIds.length, consentRemaining: count }, null, 2));
