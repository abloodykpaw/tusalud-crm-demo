/**
 * Adapta al formato Cristhyam los leads importados con otro formato de Excel y los
 * renumera #1 → #N en el orden del archivo (como los lotes de Cristhyam).
 * Usa el mismo traductor que la importación de la app (src/lib/leadFormat.ts).
 * Con --apply guarda antes una copia de los datos originales en backups/.
 *
 * Uso:
 *   node scripts/adapt-leads-cristhyam.mjs            (vista previa, no escribe)
 *   node scripts/adapt-leads-cristhyam.mjs --apply    (aplica)
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { adaptRowsToCristhyam, isCristhyamFormat } from "../src/lib/leadFormat.ts";

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

const sb = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

async function fetchAll(table, columns) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from(table)
      .select(columns)
      .order("id")
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

const leads = await fetchAll("leads", "id, source, lead_number, created_at, phone, raw_data");

// Un lote = mismo archivo y mismas columnas.
const batches = new Map();
for (const lead of leads) {
  const headers = lead.raw_data?._columnOrder;
  if (!Array.isArray(headers) || !headers.length) continue;
  const key = `${lead.source}\u0001${headers.join("\u0001")}`;
  const batch = batches.get(key) || { source: lead.source, headers, leads: [] };
  batch.leads.push(lead);
  batches.set(key, batch);
}

const plan = [];
for (const batch of batches.values()) {
  if (isCristhyamFormat(batch.headers)) continue;
  batch.leads.sort(
    (a, b) => (a.lead_number || 0) - (b.lead_number || 0) || a.created_at.localeCompare(b.created_at)
  );
  const rows = batch.leads.map(({ raw_data }) => {
    const { _columnOrder, ...rest } = raw_data;
    return rest;
  });
  const adapted = adaptRowsToCristhyam(rows, batch.headers);
  if (!adapted) {
    console.log(`Sin columna de nombre reconocible, se deja igual: ${batch.source}`);
    continue;
  }
  const updates = batch.leads.map((lead, i) => {
    const row = { ...adapted.rows[i], Number: String(i + 1) };
    return {
      lead,
      lead_number: i + 1,
      phone: row["Teléfono"] || lead.phone,
      raw_data: { ...row, _columnOrder: adapted.columns },
    };
  });
  plan.push({ source: batch.source, from: batch.headers.length, columns: adapted.columns, updates });
}

if (!plan.length) {
  console.log("No hay leads con otro formato: todo está en formato Cristhyam.");
  process.exit(0);
}

const count = (list, fn) => list.reduce((m, x) => ((m[fn(x)] = (m[fn(x)] || 0) + 1), m), {});
for (const p of plan) {
  const raws = p.updates.map((u) => u.raw_data);
  const first = p.updates[0];
  const last = p.updates[p.updates.length - 1];
  console.log(`\n${p.source}: ${p.updates.length} leads · ${p.from} → ${p.columns.length} columnas`);
  console.log(
    `  # ${first.lead.lead_number}…${last.lead.lead_number} → #${first.lead_number}…#${last.lead_number}`
  );
  console.log("  Género:", count(raws, (r) => r["Género"] || "∅"));
  console.log(
    "  Familia:",
    count(raws, (r) =>
      ["Pareja", "Hijo 1", "Hijo 2", "Hijo 3"].filter((s) => r[`Dependiente (${s})`]).join("+") || "solo titular"
    )
  );
  console.log(
    "  Fechas MM/DD/YYYY:",
    raws.filter((r) => /^\d{2}\/\d{2}\/\d{4}$/.test(r["Fecha De Nacimiento"])).length,
    "/",
    raws.length,
    "· Teléfono (xxx) xxx-xxxx:",
    raws.filter((r) => /^\(\d{3}\) \d{3}-\d{4}$/.test(r["Teléfono"])).length,
    "· sin ingreso:",
    raws.filter((r) => !r["Ingreso Estimado Anual"]).length,
    "· sin plan:",
    raws.filter((r) => !r["Nombre Del Plan"]).length
  );
  const sample = { ...first.raw_data };
  delete sample._columnOrder;
  console.log("  Ejemplo #1:", JSON.stringify(sample));
}

if (!APPLY) {
  console.log("\nVista previa: no se escribió nada. Ejecuta con --apply para aplicar.");
  process.exit(0);
}

const all = plan.flatMap((p) => p.updates);
mkdirSync(resolve(process.cwd(), "backups"), { recursive: true });
const backupPath = resolve(
  process.cwd(),
  "backups",
  `leads-antes-de-formato-cristhyam-${new Date().toISOString().replace(/[:.]/g, "-")}.json`
);
writeFileSync(
  backupPath,
  JSON.stringify(
    all.map(({ lead }) => ({
      id: lead.id,
      source: lead.source,
      lead_number: lead.lead_number,
      phone: lead.phone,
      raw_data: lead.raw_data,
    }))
  )
);
console.log(`\nCopia de seguridad: ${backupPath}`);

const updatedAt = new Date().toISOString();
let done = 0;
for (let i = 0; i < all.length; i += 20) {
  await Promise.all(
    all.slice(i, i + 20).map(async (u) => {
      const { data, error } = await sb
        .from("leads")
        .update({ raw_data: u.raw_data, lead_number: u.lead_number, phone: u.phone, updated_at: updatedAt })
        .eq("id", u.lead.id)
        .select("id");
      if (error) throw new Error(`${u.lead.id}: ${error.message}`);
      if (!data?.length) throw new Error(`${u.lead.id}: no se actualizó`);
      done += 1;
    })
  );
}
console.log(`Listo: ${done} leads adaptados al formato Cristhyam y renumerados.`);
