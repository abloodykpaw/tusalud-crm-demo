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

const sb = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const { data: one, error: findErr } = await sb
  .from("leads")
  .select("id, status, lead_number")
  .eq("status", "nuevo")
  .order("lead_number")
  .limit(1)
  .maybeSingle();

if (findErr) throw findErr;
if (!one) {
  console.log("No hay leads nuevo para probar");
  process.exit(0);
}

const { data: upd, error } = await sb
  .from("leads")
  .update({ status: "realizado" })
  .eq("id", one.id)
  .select("id, status, lead_number")
  .maybeSingle();

console.log("update result", upd, error || null);

if (upd) {
  await sb.from("leads").update({ status: "nuevo" }).eq("id", one.id);
  console.log("restored to nuevo");
}
