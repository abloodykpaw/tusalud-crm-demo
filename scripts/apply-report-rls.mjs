/**
 * Aplica 009 vía Supabase Management API (necesita SUPABASE_ACCESS_TOKEN)
 * o vía DATABASE_URL / SUPABASE_DB_URL con pg.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";

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
  resolve(process.cwd(), "supabase/migrations/009_report_entries_agent_write.sql"),
  "utf8"
);

const dbUrl =
  process.env.DATABASE_URL ||
  process.env.SUPABASE_DB_URL ||
  process.env.POSTGRES_URL ||
  process.env.DIRECT_URL;

if (dbUrl) {
  const require = createRequire(import.meta.url);
  const { Client } = require("pg");
  const client = new Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    await client.query(sql);
    console.log("OK: migración 009 aplicada (Postgres)");
  } finally {
    await client.end();
  }
  process.exit(0);
}

const accessToken =
  process.env.SUPABASE_ACCESS_TOKEN || process.env.SUPABASE_PAT || process.env.SUPABASE_TOKEN;
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const refMatch = supabaseUrl.match(/^https:\/\/([a-z0-9-]+)\.supabase\.co/i);
const projectRef = process.env.SUPABASE_PROJECT_REF || (refMatch ? refMatch[1] : "");

if (!accessToken || !projectRef) {
  console.error(
    JSON.stringify({
      ok: false,
      reason: "missing_credentials",
      need: ["DATABASE_URL o SUPABASE_DB_URL", "o SUPABASE_ACCESS_TOKEN + project ref"],
      hasAccessToken: !!accessToken,
      hasProjectRef: !!projectRef,
    })
  );
  process.exit(2);
}

const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ query: sql }),
});

const bodyText = await res.text();
if (!res.ok) {
  console.error("FAIL Management API", res.status, bodyText.slice(0, 500));
  process.exit(1);
}

console.log("OK: migración 009 aplicada (Management API)");
console.log(bodyText.slice(0, 300));
