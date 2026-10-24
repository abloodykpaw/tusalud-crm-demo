import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

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
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(2);
}

const sb = createClient(url, key, { auth: { persistSession: false } });
const { count, error } = await sb.from("leads").select("*", { count: "exact", head: true });
if (error) {
  console.error(error);
  process.exit(1);
}
const { data: maxRow } = await sb
  .from("leads")
  .select("lead_number")
  .order("lead_number", { ascending: false })
  .limit(1)
  .maybeSingle();

console.log(
  JSON.stringify(
    {
      total: count,
      maxLeadNumber: maxRow?.lead_number ?? null,
      nextNumber: (maxRow?.lead_number ?? 0) + 1,
    },
    null,
    2
  )
);
