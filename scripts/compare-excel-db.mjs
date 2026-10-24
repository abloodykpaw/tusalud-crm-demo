/**
 * Compara orden/nombres del Excel vs leads en Supabase.
 * Uso: node scripts/compare-excel-db.mjs [xlsx]
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

console.log("Excel rows:", excelRows.length);
console.log("Excel headers:", Object.keys(excelRows[0] || {}).join(" | "));
console.log("\nExcel first 10:");
excelRows.slice(0, 10).forEach((r, i) => {
  console.log(
    `${i + 1}. ${r["Nombre Completo"]} | ${r.Email} | ${r["Teléfono"] || r.Telefono}`
  );
});

const sb = createClient(url, key, { auth: { persistSession: false } });
const { data: dbRows, error } = await sb
  .from("leads")
  .select("lead_number, first_name, last_name, email, phone, source, raw_data, created_at")
  .order("lead_number", { ascending: true });

if (error) {
  console.error(error);
  process.exit(1);
}

console.log("\nDB count:", dbRows.length);
console.log("DB first 10 by lead_number:");
dbRows.slice(0, 10).forEach((r) => {
  console.log(
    `#${r.lead_number} ${r.first_name} ${r.last_name} | ${r.email} | ${r.phone} | ${r.source}`
  );
});

let mism = 0;
const samples = [];
for (let i = 0; i < Math.min(dbRows.length, excelRows.length); i++) {
  const en = String(excelRows[i]["Nombre Completo"] || "").trim();
  const dn = `${dbRows[i].first_name} ${dbRows[i].last_name}`.trim();
  if (en !== dn) {
    mism += 1;
    if (samples.length < 8) samples.push({ i: i + 1, excel: en, db: dn, leadNumber: dbRows[i].lead_number });
  }
}
console.log("\nName mismatches (excel row i vs db lead_number sort):", mism);
for (const s of samples) console.log(s);

// Check if UI might sort wrong due to missing Number in raw_data
const emptyNumber = dbRows.filter((r) => !(r.raw_data?.Number || "").toString().trim()).length;
console.log("DB rows with empty raw_data.Number:", emptyNumber);

// Sources
const sources = {};
for (const r of dbRows) sources[r.source] = (sources[r.source] || 0) + 1;
console.log("Sources:", sources);
