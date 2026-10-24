/**
 * Compara celdas clave Excel vs raw_data en BD (no solo nombres).
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import XLSX from "xlsx";

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

const xlsxPath =
  process.argv[2] || "Z:/proyectos/tusalud/LEAD1000_2026-09-02_MMDDYYYY.xlsx";
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

const wb = XLSX.readFile(xlsxPath);
const excelRows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {
  defval: "",
  blankrows: false,
  raw: false,
});
const headers = Object.keys(excelRows[0] || {});

const sb = createClient(url, key, { auth: { persistSession: false } });
const { data: dbRows, error } = await sb
  .from("leads")
  .select("lead_number, raw_data")
  .order("lead_number", { ascending: true });
if (error) throw error;

const byNum = new Map(dbRows.map((r) => [r.lead_number, r.raw_data || {}]));

const colsToCheck = [
  "Nombre Completo",
  "Fecha De Nacimiento",
  "Edad",
  "Email",
  "Teléfono",
  "Dirección",
  "Estado",
  "Condado",
  "Zip Code",
  "Ingreso Estimado Anual",
  "Nombre Del Plan",
];

let cellMism = 0;
for (let i = 0; i < Math.min(20, excelRows.length); i++) {
  const excel = excelRows[i];
  const raw = byNum.get(i + 1) || {};
  for (const col of colsToCheck) {
    const ev = String(excel[col] ?? "").trim();
    const dv = String(raw[col] ?? "").trim();
    if (ev !== dv) {
      cellMism += 1;
      console.log(`Row ${i + 1} COL ${col}:\n  excel=[${ev}]\n  db=[${dv}]`);
    }
  }
}
console.log("\nCell mismatches in first 20 rows (key cols):", cellMism);

// Check if Estado is empty in excel too
const estadoEmptyExcel = excelRows.filter((r) => !String(r.Estado || "").trim()).length;
const estadoEmptyDb = dbRows.filter((r) => !String(r.raw_data?.Estado || "").trim()).length;
console.log("Estado empty excel/db:", estadoEmptyExcel, estadoEmptyDb);
console.log("Sample Estado excel[0]=", JSON.stringify(excelRows[0].Estado));
console.log("Sample Dirección excel[0]=", JSON.stringify(excelRows[0]["Dirección"]));
console.log("Sample Condado excel[0]=", JSON.stringify(excelRows[0].Condado));
console.log("Sample Zip excel[0]=", JSON.stringify(excelRows[0]["Zip Code"]));

// Header parity in raw_data
const rawKeys = Object.keys(dbRows[0]?.raw_data || {}).filter((k) => k !== "_columnOrder");
const missingInDb = headers.filter((h) => !rawKeys.includes(h));
const extraInDb = rawKeys.filter((h) => !headers.includes(h));
console.log("Headers missing in db raw:", missingInDb);
console.log("Extra keys in db raw:", extraInDb);
console.log("_columnOrder length:", (dbRows[0]?.raw_data?._columnOrder || []).length, "excel headers", headers.length);
