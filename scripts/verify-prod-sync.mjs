import { readFileSync } from "node:fs";

function has(file, needle) {
  return readFileSync(file, "utf8").includes(needle);
}

const checks = [
  ["Caracas TZ", has("src/lib/dayFolders.ts", 'BUSINESS_TIMEZONE = "America/Caracas"')],
  ["dayKey business formatter", has("src/lib/dayFolders.ts", "formatBusinessDayKey")],
  ["updateLeadRow API", has("src/lib/supabase-sync.ts", "export async function updateLeadRow")],
  ["upsertPaymentRow API", has("src/lib/supabase-sync.ts", "export async function upsertPaymentRow")],
  ["non-destructive pushAppData", has("src/lib/supabase-sync.ts", "Upsert-only")],
  ["no wipe-all leads", !has("src/lib/supabase-sync.ts", 'delete().neq("id", "00000000-0000-0000-0000-000000000000")')],
  ["auto refresh 12s", has("src/lib/store.tsx", "setInterval(refreshFromCloud, 12000)")],
  ["focus refresh", has("src/lib/store.tsx", 'window.addEventListener("focus"')],
  ["cloudSafe helper", has("src/lib/store.tsx", "const cloudSafe")],
  ["lead update -> DB", has("src/lib/store.tsx", "updateLeadRow(updated")],
  ["task progress -> DB", has("src/lib/store.tsx", "insertTaskProgressNote")],
  ["payment -> DB", has("src/lib/store.tsx", "upsertPaymentRow(nextPayment")],
  ["no mass pushAppData debounce", !has("src/lib/store.tsx", "pushAppData(data)")],
  ["Excel preserves row order", has("src/views/LeadsView.tsx", "blankrows: false")],
  ["addLeads numbers by index", has("src/lib/store.tsx", "leadNumber: start + i")],
  ["upsert assigns leadNumber", has("src/lib/store.tsx", "const leadNumber = nextNumber++")],
  ["migration payments insert", has("supabase/migrations/011_payments_agent_insert.sql", "payments_agent_insert")],
  ["migration profiles staff", has("supabase/migrations/011_payments_agent_insert.sql", "profiles_update_staff")],
];

let ok = 0;
let fail = 0;
for (const [name, pass] of checks) {
  console.log(`${pass ? "OK" : "FAIL"}  ${name}`);
  if (pass) ok++;
  else fail++;
}
console.log("---");
console.log(`${ok} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
