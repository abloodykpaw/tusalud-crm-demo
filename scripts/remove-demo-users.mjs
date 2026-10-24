/**
 * Elimina usuarios demo (@tusalud.com) de Supabase y datos que los referencian.
 * Requiere: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY en .env
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function loadEnv() {
  const path = resolve(process.cwd(), ".env");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    const key = m[1].trim();
    const val = m[2].trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnv();

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error("Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en .env");
  process.exit(1);
}

const sb = createClient(url, serviceKey, { auth: { persistSession: false } });

const DEMO_IDS = new Set([
  "11111111-1111-1111-1111-111111111101",
  "11111111-1111-1111-1111-111111111102",
  "11111111-1111-1111-1111-111111111103",
  "11111111-1111-1111-1111-111111111104",
  "11111111-1111-1111-1111-111111111105",
  "11111111-1111-1111-1111-111111111106",
]);

const KEEP_IDS = new Set([
  "22222222-2222-2222-2222-222222222201",
  "22222222-2222-2222-2222-222222222202",
  "22222222-2222-2222-2222-222222222203",
  "22222222-2222-2222-2222-222222222204",
]);

function isDemoUser(user) {
  if (KEEP_IDS.has(user.id)) return false;
  if (DEMO_IDS.has(user.id)) return true;
  const email = (user.email || "").toLowerCase();
  return email.endsWith("@tusalud.com");
}

async function listAllUsers() {
  const users = [];
  let page = 1;
  while (true) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    users.push(...data.users);
    if (data.users.length < 200) break;
    page += 1;
  }
  return users;
}

async function purgeReferences(userId) {
  const { data: tasks } = await sb
    .from("weekly_tasks")
    .select("id")
    .or(`assigned_to.eq.${userId},created_by.eq.${userId}`);
  const taskIds = (tasks || []).map((t) => t.id);

  if (taskIds.length) {
    await sb.from("task_progress").delete().in("task_id", taskIds);
    await sb.from("weekly_tasks").delete().in("id", taskIds);
  }

  await sb.from("task_progress").delete().eq("submitted_by", userId);
  await sb
    .from("weekly_payments")
    .delete()
    .or(`agent_id.eq.${userId},data_requested_by.eq.${userId},paid_by_user_id.eq.${userId}`);

  const { data: entries } = await sb.from("report_entries").select("id").eq("uploaded_by", userId);
  if (entries?.length) {
    await sb.from("report_entries").delete().in(
      "id",
      entries.map((e) => e.id)
    );
  }

  await sb.from("lead_documents").delete().eq("uploaded_by", userId);
  await sb.from("leads").update({ assigned_agent_id: null }).eq("assigned_agent_id", userId);
  await sb.from("history_events").delete().eq("actor_id", userId);
}

async function removeUser(user) {
  await purgeReferences(user.id);
  const { error } = await sb.auth.admin.deleteUser(user.id);
  if (error) throw error;
}

async function main() {
  const all = await listAllUsers();
  const targets = all.filter(isDemoUser);

  if (!targets.length) {
    console.log("No hay cuentas demo (@tusalud.com) para eliminar.");
    return;
  }

  console.log(`Eliminando ${targets.length} cuenta(s) demo...`);
  for (const user of targets) {
    console.log(`  ${user.email || user.id}`);
    await removeUser(user);
  }

  console.log("\nListo. Usuarios restantes:");
  const remaining = (await listAllUsers()).filter((u) => !isDemoUser(u));
  for (const u of remaining) {
    const meta = u.user_metadata || {};
    console.log(`  ${meta.username ? `@${meta.username}` : u.email} (${meta.role || "?"})`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
