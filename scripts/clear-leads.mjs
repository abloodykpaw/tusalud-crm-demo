/**
 * Borra leads del CRM en Supabase (por defecto el lote Leads1000).
 * Uso: node scripts/clear-leads.mjs [all|Leads1000]
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
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (val) process.env[key] = val;
  }
}

loadEnv();

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const mode = (process.argv[2] || "Leads1000").toLowerCase();

if (!url || !serviceKey) {
  console.error("Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en .env");
  process.exit(1);
}

const sb = createClient(url, serviceKey, { auth: { persistSession: false } });

const { count: before, error: countErr } = await sb
  .from("leads")
  .select("*", { count: "exact", head: true });

if (countErr) {
  console.error(countErr.message);
  process.exit(1);
}

console.log(`Leads antes: ${before}`);

let del;
if (mode === "all") {
  del = await sb.from("leads").delete().neq("id", "00000000-0000-0000-0000-000000000000");
} else {
  del = await sb.from("leads").delete().ilike("source", "%Leads1000%");
}

if (del.error) {
  console.error("Error borrando:", del.error.message);
  process.exit(1);
}

const { count: after } = await sb.from("leads").select("*", { count: "exact", head: true });
console.log(`Leads después: ${after}`);
console.log(mode === "all" ? "Borrados todos los leads." : "Borrados leads del lote Leads1000.");
