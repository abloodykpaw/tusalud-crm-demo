/**
 * Carga una carta PDF puntual en report_entries (Cristhyam · 2026-09-24).
 * Uso: node scripts/upload-one-carta.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
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

const PDF_PATH =
  process.env.CARTA_PDF ||
  "C:\\Users\\Abloody\\Desktop\\carta\\001_carta_consentimiento_esperanza_galindez.pdf";
const TARGET_ID = "3670da5f-703a-461a-ad08-b3a75a23c639"; // Cristhyam
const REPORT_DATE = process.env.CARTA_DATE || "2026-09-24";
const UPLOADER = "22222222-2222-2222-2222-222222222202"; // Kennedy (agente del reporte)
const LEAD_ID = process.env.CARTA_LEAD_ID || "f5f51a4e-8ea2-487f-ab31-78735d142dd8";
const DISPLAY_NAME = process.env.CARTA_NAME || "Esperanza Galindez";

async function main() {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.VITE_SUPABASE_SERVICE_ROLE_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error("Faltan VITE_SUPABASE_URL y service/anon key en .env");
  }
  if (!existsSync(PDF_PATH)) {
    throw new Error(`No existe el PDF: ${PDF_PATH}`);
  }

  const fileName = PDF_PATH.split(/[/\\]/).pop();
  const personKey = extractPersonFromCartaLabel(fileName);
  console.log("person_key:", personKey);

  const sb = createClient(url, key, { auth: { persistSession: false } });

  const { data: existing, error: dupErr } = await sb
    .from("report_entries")
    .select("id, file_name, person_key, report_date")
    .eq("target_id", TARGET_ID)
    .eq("type", "consent")
    .eq("report_date", REPORT_DATE)
    .eq("person_key", personKey);

  if (dupErr) throw dupErr;
  if (existing?.length && process.env.CARTA_HOMONYM !== "1") {
    console.log("DUPLICADA — no se inserta:", existing);
    return { ok: false, reason: "duplicate", existing };
  }

  const buf = readFileSync(PDF_PATH);
  const dataUrl = `data:application/pdf;base64,${buf.toString("base64")}`;
  const id = randomUUID();
  const createdAt = `${REPORT_DATE}T23:50:00.000-04:00`;

  const { error: insErr } = await sb.from("report_entries").insert({
    id,
    target_id: TARGET_ID,
    type: "consent",
    title: "CARTAS DE CONSENTIMIENTO",
    report_date: REPORT_DATE,
    uploaded_by: UPLOADER,
    file_name: fileName,
    file_content: dataUrl,
    created_at: createdAt,
    person_key: personKey,
    linked_lead_id: LEAD_ID,
  });
  if (insErr) throw insErr;

  const { error: nameErr } = await sb.from("report_entry_names").insert({
    entry_id: id,
    full_name: DISPLAY_NAME,
    sort_order: 0,
  });
  if (nameErr) throw nameErr;

  const { error: leadErr } = await sb
    .from("leads")
    .update({ status: "realizado" })
    .eq("id", LEAD_ID);
  if (leadErr) console.warn("Lead update warning:", leadErr.message);
  else console.log("Lead marcado realizado:", LEAD_ID);

  // Progreso de tarea del 24/09 si es meta automática
  const { data: tasks } = await sb
    .from("weekly_tasks")
    .select("*")
    .eq("assigned_to", UPLOADER)
    .eq("due_date", REPORT_DATE)
    .eq("goal_type", "consent_realizado");

  for (const t of tasks || []) {
    if (t.proofs_validated) continue;
    const next = Math.min(t.goal_target || 35, (t.goal_current || 0) + 1);
    const status =
      next >= (t.goal_target || 35) ? "completada" : next > 0 ? "en_progreso" : t.status;
    await sb
      .from("weekly_tasks")
      .update({ goal_current: next, status })
      .eq("id", t.id);
    await sb.from("task_progress").insert({
      task_id: t.id,
      submitted_by: UPLOADER,
      notes: `Auto: +1 carta(s) con lead → realizado (${next}/${t.goal_target})`,
      submitted_at: createdAt,
    });
    console.log(`Tarea ${t.due_date}: ${next}/${t.goal_target} · ${status}`);
  }

  console.log("OK insertada:", { id, fileName, personKey, reportDate: REPORT_DATE });
  return { ok: true, id };
}

main().catch((err) => {
  console.error("FAIL:", err.message || err);
  process.exit(1);
});
