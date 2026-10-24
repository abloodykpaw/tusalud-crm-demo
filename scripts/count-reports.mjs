/**
 * Cuenta reportes y leads en Supabase (solo lectura).
 * Uso: node scripts/count-reports.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

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
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!url || !key) {
  console.error("Faltan SUPABASE_URL / VITE_SUPABASE_URL y una key en .env");
  process.exit(1);
}

const sb = createClient(url, key, { auth: { persistSession: false } });

async function count(table, filter) {
  let q = sb.from(table).select("*", { count: "exact", head: true });
  if (filter) q = filter(q);
  const { count, error } = await q;
  if (error) throw error;
  return count ?? 0;
}

const entries = await count("report_entries");
const leadsReports = await count("report_entries", (q) => q.eq("type", "leads"));
const consentReports = await count("report_entries", (q) => q.eq("type", "consent"));
const names = await count("report_entry_names");
const withFile = await count("report_entries", (q) => q.not("file_content", "is", null));
const pdfs = await count("report_entries", (q) =>
  q.ilike("file_content", "data:application/pdf%")
);
const leadRows = await count("leads");

const { data: recent, error: recentError } = await sb
  .from("report_entries")
  .select("type, file_name, title, created_at")
  .order("created_at", { ascending: false })
  .limit(8);
if (recentError) throw recentError;

console.log(
  JSON.stringify(
    {
      report_entries_total: entries,
      report_leads: leadsReports,
      report_consent: consentReports,
      report_entry_names: names,
      con_file_content: withFile,
      pdfs_consent: pdfs,
      leads_table: leadRows,
      recientes: recent,
    },
    null,
    2
  )
);
