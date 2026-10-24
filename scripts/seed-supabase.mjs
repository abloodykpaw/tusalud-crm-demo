/**
 * Seed de usuarios ficticios para un proyecto Supabase DEMO (nunca producción).
 * Requiere: SUPABASE_URL / VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const AUTH_EMAIL_DOMAIN = "auth.demo.local";
const DEFAULT_PASSWORD = "Demo2026!";

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

function normalizeUsername(value) {
  return value.trim().toLowerCase().replace(/\s+/g, "");
}

function authEmailForUsername(username) {
  return `${normalizeUsername(username)}@${AUTH_EMAIL_DOMAIN}`;
}

loadEnv();

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error("Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en .env");
  process.exit(1);
}

const sb = createClient(url, serviceKey, { auth: { persistSession: false } });

const USERS = [
  { id: "33333333-3333-3333-3333-333333333301", username: "admin", full_name: "Alex Rivera", role: "admin" },
  { id: "33333333-3333-3333-3333-333333333302", username: "maria", full_name: "María López", role: "agente" },
  { id: "33333333-3333-3333-3333-333333333303", username: "carlos", full_name: "Carlos Ruiz", role: "agente" },
  { id: "33333333-3333-3333-3333-333333333304", username: "elena", full_name: "Elena Vargas", role: "nomina" },
];

async function ensureUser(user) {
  const username = normalizeUsername(user.username);
  const authEmail = authEmailForUsername(username);
  const { data: existing } = await sb.auth.admin.getUserById(user.id).catch(() => ({ data: null }));

  if (existing?.user) {
    await sb.auth.admin.updateUserById(user.id, {
      email: authEmail,
      password: DEFAULT_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: user.full_name, role: user.role, username },
    });
    console.log(`  Actualizado: @${username}`);
  } else {
    const { error } = await sb.auth.admin.createUser({
      id: user.id,
      email: authEmail,
      password: DEFAULT_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: user.full_name, role: user.role, username },
    });
    if (error) throw error;
    console.log(`  Creado: @${username}`);
  }

  await sb.from("profiles").upsert({
    id: user.id,
    full_name: user.full_name,
    username,
    email: null,
    role: user.role,
    status: "activo",
  });
}

async function main() {
  console.log("Creando usuarios DEMO...");
  for (const user of USERS) await ensureUser(user);
  console.log("\nLogin: usuario + Demo2026!");
  for (const u of USERS) console.log(`  @${u.username} (${u.role})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
