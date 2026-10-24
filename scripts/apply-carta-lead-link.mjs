/**
 * Aplica 014_carta_lead_link.sql y rellena person_key en cartas existentes.
 * Uso: node scripts/apply-carta-lead-link.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { createClient } from "@supabase/supabase-js";
import { extractPersonFromCartaLabel } from "./carta-name-utils.mjs";

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

const sql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/014_carta_lead_link.sql"),
  "utf8"
);

async function applySql() {
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
      console.log("OK: migración 014 aplicada (pg)");
    } finally {
      await client.end();
    }
    return;
  }

  const accessToken =
    process.env.SUPABASE_ACCESS_TOKEN || process.env.SUPABASE_PAT || process.env.SUPABASE_TOKEN;
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  const refMatch = supabaseUrl.match(/^https:\/\/([a-z0-9-]+)\.supabase\.co/i);
  const projectRef = process.env.SUPABASE_PROJECT_REF || (refMatch ? refMatch[1] : "");

  if (!accessToken || !projectRef) {
    throw new Error(
      "Faltan DATABASE_URL o SUPABASE_ACCESS_TOKEN + project ref para aplicar la migración SQL"
    );
  }

  const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: sql }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Management API ${res.status}: ${body}`);
  console.log("OK: migración 014 aplicada (Management API)");
}

async function backfillPersonKeys() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Faltan SUPABASE_URL / SERVICE_ROLE_KEY");

  const sb = createClient(url, key, { auth: { persistSession: false } });

  const entries = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("report_entries")
      .select("id, type, file_name, title, target_id, person_key")
      .eq("type", "consent")
      .range(from, from + 999);
    if (error) throw error;
    entries.push(...(data || []));
    if (!data || data.length < 1000) break;
  }

  const names = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("report_entry_names")
      .select("entry_id, full_name, sort_order")
      .range(from, from + 999);
    if (error) throw error;
    names.push(...(data || []));
    if (!data || data.length < 1000) break;
  }

  const namesBy = new Map();
  for (const n of names) {
    const a = namesBy.get(n.entry_id) || [];
    a.push(n);
    namesBy.set(n.entry_id, a);
  }

  let updated = 0;
  let skipped = 0;
  const seenPerTarget = new Map();

  for (const e of entries) {
    if (e.person_key) {
      skipped++;
      continue;
    }
    const entryNames = (namesBy.get(e.id) || []).sort((a, b) => a.sort_order - b.sort_order);
    const raw = entryNames[0]?.full_name || e.file_name || e.title || "";
    const personKey = extractPersonFromCartaLabel(raw);
    if (!personKey) continue;

    let set = seenPerTarget.get(e.target_id);
    if (!set) {
      set = new Set(
        entries
          .filter((x) => x.target_id === e.target_id && x.person_key)
          .map((x) => x.person_key)
      );
      seenPerTarget.set(e.target_id, set);
    }
    if (set.has(personKey)) {
      console.warn("DUP skip backfill", e.id, personKey, e.file_name);
      continue;
    }

    const { error } = await sb
      .from("report_entries")
      .update({ person_key: personKey })
      .eq("id", e.id);
    if (error) {
      console.error("fail", e.id, error.message);
      continue;
    }
    set.add(personKey);
    updated++;
  }

  console.log(JSON.stringify({ consent: entries.length, updated, alreadyHadKey: skipped }, null, 2));
}

try {
  await applySql();
  await backfillPersonKeys();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
