/**
 * Publica en «Leads nuevos» de un perfil de reporte todos los leads existentes:
 * un reporte por lote importado (día de negocio Caracas + archivo de origen).
 * Idempotente: no repite un lote ya publicado (mismo día + archivo en ese perfil).
 *
 * Uso:
 *   node scripts/backfill-leads-report.mjs                    (vista previa, no escribe)
 *   node scripts/backfill-leads-report.mjs --apply            (publica)
 *   node scripts/backfill-leads-report.mjs --target=Cynthia   (otro perfil; por defecto Cristhyam)
 */
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

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
const TARGET_ARG =
  process.argv.find((a) => a.startsWith("--target="))?.slice("--target=".length) || "Cristhyam";

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

/** Día de negocio (Caracas) como YYYY-MM-DD, igual que dayKeyFromIso en la app. */
function businessDay(iso) {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Caracas" });
}

function sourceFileName(source, day) {
  const file = String(source || "").replace(/^Excel\s*·\s*/i, "").trim();
  if (file && file !== source?.trim()) return `${file.replace(/\.[^.]+$/, "")}.txt`;
  if (file && /\.(xlsx|xls|csv)$/i.test(file)) return `${file.replace(/\.[^.]+$/, "")}.txt`;
  return `${day} leads.txt`;
}

function fold(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

const targets = await fetchAll("report_targets", "id, name, slug, active, assigned_agent_id");
const matches = targets.filter(
  (t) => t.active && (fold(t.name) === fold(TARGET_ARG) || t.slug === `reportes-${fold(TARGET_ARG)}`)
);
if (matches.length !== 1) {
  console.error(
    `Perfil «${TARGET_ARG}»: ${matches.length} coincidencias. Activos: ${targets
      .filter((t) => t.active)
      .map((t) => t.name)
      .join(", ")}`
  );
  process.exit(1);
}
const target = matches[0];

const profiles = await fetchAll("profiles", "id, full_name, role, status");
const admins = profiles.filter((p) => p.role === "admin" && p.status === "activo");
const uploader =
  admins.find((p) => fold(p.full_name) === "abloody") || admins.sort((a, b) => a.id.localeCompare(b.id))[0];
if (!uploader) {
  console.error("No hay un admin activo para firmar los reportes");
  process.exit(1);
}
const assignee = profiles.find((p) => p.id === target.assigned_agent_id);

const leads = await fetchAll("leads", "id, first_name, last_name, lead_number, source, status, created_at");
const existing = await fetchAll("report_entries", "id, target_id, type, report_date, file_name");
const alreadyPublished = new Set(
  existing
    .filter((e) => e.target_id === target.id && e.type === "leads")
    .map((e) => `${e.report_date}|${e.file_name}`)
);

const groups = new Map();
for (const l of leads) {
  const day = businessDay(l.created_at);
  const fileName = sourceFileName(l.source, day);
  const key = `${day}|${fileName}`;
  const g = groups.get(key) || { day, fileName, leads: [] };
  g.leads.push(l);
  groups.set(key, g);
}

const plan = [...groups.entries()]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([key, g]) => {
    g.leads.sort(
      (a, b) => (a.lead_number || 0) - (b.lead_number || 0) || a.created_at.localeCompare(b.created_at)
    );
    const names = g.leads.map((l) => `${l.first_name || ""} ${l.last_name || ""}`.trim()).filter(Boolean);
    const createdAt = g.leads.reduce((m, l) => (l.created_at > m ? l.created_at : m), g.leads[0].created_at);
    return { key, ...g, names, createdAt, skip: alreadyPublished.has(key) };
  });

console.log(
  `Perfil: ${target.name} (#${target.slug}) · asignado a ${assignee?.full_name || "nadie"} · firmado por ${uploader.full_name}`
);
console.log(`Leads en la base: ${leads.length} · lotes: ${plan.length}`);
for (const p of plan) {
  const done = p.leads.filter((l) => l.status === "realizado").length;
  console.log(
    `  ${p.skip ? "YA EXISTE " : "NUEVO     "} ${p.day} · ${p.fileName} · ${p.names.length} personas (${done} realizados)`
  );
}

const pending = plan.filter((p) => !p.skip && p.names.length);
if (!APPLY) {
  console.log(`\nVista previa: se publicarían ${pending.length} reporte(s). Ejecuta con --apply para guardar.`);
  process.exit(0);
}

const created = [];
for (const p of pending) {
  const id = randomUUID();
  const { error } = await sb.from("report_entries").insert({
    id,
    target_id: target.id,
    type: "leads",
    title: `Leads Nuevos de ${p.names.length} Persona${p.names.length === 1 ? "" : "s"}`,
    report_date: p.day,
    uploaded_by: uploader.id,
    file_name: p.fileName,
    file_content: p.names.join("\n"),
    created_at: p.createdAt,
  });
  if (error) {
    console.error(`Error en ${p.key}:`, error.message);
    process.exit(1);
  }
  const { error: namesError } = await sb.from("report_entry_names").insert(
    p.names.map((full_name, sort_order) => ({ entry_id: id, full_name, sort_order }))
  );
  if (namesError) {
    await sb.from("report_entries").delete().eq("id", id);
    console.error(`Error en nombres de ${p.key}:`, namesError.message);
    process.exit(1);
  }
  created.push(id);
  console.log(`  ✓ ${p.day} · ${p.fileName} · ${p.names.length} personas`);
}

if (created.length) {
  const total = pending.reduce((s, p) => s + p.names.length, 0);
  await sb.from("history_events").insert({
    id: randomUUID(),
    at: new Date().toISOString(),
    actor_id: uploader.id,
    actor_name: uploader.full_name,
    actor_role: uploader.role,
    module: "reports",
    type: "report_uploaded",
    summary: `${uploader.full_name} (admin) cargó ${created.length} reporte(s) de leads nuevos (${total} personas) → ${target.name} · carga inicial`,
    entity_type: "report",
    meta: { targetId: target.id, count: created.length, reportType: "leads", backfill: true },
  });
}
console.log(`\nListo: ${created.length} reporte(s) publicados en ${target.name}. IDs: ${created.join(", ")}`);
