/**
 * Quita unique global de lead_number y renumera 1…N por día Caracas.
 */
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

const accessToken =
  process.env.SUPABASE_ACCESS_TOKEN || process.env.SUPABASE_PAT || process.env.SUPABASE_TOKEN;
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const refMatch = supabaseUrl.match(/^https:\/\/([a-z0-9-]+)\.supabase\.co/i);
const projectRef = process.env.SUPABASE_PROJECT_REF || (refMatch ? refMatch[1] : "");
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!accessToken || !projectRef) {
  console.error("Falta SUPABASE_ACCESS_TOKEN o project ref");
  process.exit(2);
}
if (!supabaseUrl || !serviceKey) {
  console.error("Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(2);
}

const sql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/013_lead_number_per_day.sql"),
  "utf8"
);

async function runSql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });
  const bodyText = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${bodyText.slice(0, 800)}`);
  return bodyText;
}

await runSql(sql);
console.log("OK migración 013 (índice unique removido)");

const dayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Caracas",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const sb = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

const all = [];
let from = 0;
const page = 1000;
for (;;) {
  const { data, error } = await sb
    .from("leads")
    .select("id, created_at, lead_number")
    .order("created_at", { ascending: true })
    .range(from, from + page - 1);
  if (error) throw error;
  if (!data?.length) break;
  all.push(...data);
  if (data.length < page) break;
  from += page;
}

const byDay = new Map();
for (const row of all) {
  const day = dayFormatter.format(new Date(row.created_at));
  const list = byDay.get(day) || [];
  list.push(row);
  byDay.set(day, list);
}

let updated = 0;
for (const [, rows] of byDay) {
  rows.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || String(a.id).localeCompare(String(b.id)));
  for (let i = 0; i < rows.length; i++) {
    const next = i + 1;
    if (Number(rows[i].lead_number) === next) continue;
    const { error } = await sb.from("leads").update({ lead_number: next }).eq("id", rows[i].id);
    if (error) throw error;
    updated += 1;
  }
}

console.log(
  JSON.stringify(
    {
      totalLeads: all.length,
      days: byDay.size,
      renumbered: updated,
      sampleDays: [...byDay.entries()]
        .slice(0, 5)
        .map(([day, rows]) => ({ day, count: rows.length })),
    },
    null,
    2
  )
);
