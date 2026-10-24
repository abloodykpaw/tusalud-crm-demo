/**
 * Aplica supabase/migrations/012_renumber_leads_asc.sql y verifica min/max.
 */
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

const sql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/012_renumber_leads_asc.sql"),
  "utf8"
);

const accessToken =
  process.env.SUPABASE_ACCESS_TOKEN || process.env.SUPABASE_PAT || process.env.SUPABASE_TOKEN;
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const refMatch = supabaseUrl.match(/^https:\/\/([a-z0-9-]+)\.supabase\.co/i);
const projectRef = process.env.SUPABASE_PROJECT_REF || (refMatch ? refMatch[1] : "");

if (!accessToken || !projectRef) {
  console.error("Falta SUPABASE_ACCESS_TOKEN o project ref");
  process.exit(2);
}

async function runQuery(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });
  const bodyText = await res.text();
  if (!res.ok) {
    throw new Error(`${res.status} ${bodyText.slice(0, 800)}`);
  }
  try {
    return JSON.parse(bodyText);
  } catch {
    return bodyText;
  }
}

await runQuery(sql);
const stats = await runQuery(`
  select
    count(*)::int as total,
    min(lead_number)::int as min_n,
    max(lead_number)::int as max_n,
    count(distinct lead_number)::int as distinct_n
  from public.leads
  where lead_number is not null
`);
console.log("OK renumeración 1…N aplicada");
console.log(stats);
