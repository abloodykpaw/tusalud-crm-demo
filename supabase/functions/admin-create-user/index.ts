// Alta de usuarios solo para admin (auditoría F0.1 / F1.1).
// El navegador ya no usa auth.signUp: la sesión del admin no cambia y los
// registros públicos pueden quedar desactivados en Supabase Auth.
import { createClient } from "npm:@supabase/supabase-js@2";

const ROLES = ["admin", "encargado", "agente", "nomina"] as const;
const USERNAME_RE = /^[a-z0-9._-]{3,32}$/;
const MIN_PASSWORD = 10;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authHeader = req.headers.get("Authorization") || "";
  const caller = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: callerUser, error: callerError } = await caller.auth.getUser();
  if (callerError || !callerUser.user) return json({ error: "Sesión no válida" }, 401);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: callerProfile } = await admin
    .from("profiles")
    .select("role, status")
    .eq("id", callerUser.user.id)
    .maybeSingle();
  if (callerProfile?.role !== "admin" || callerProfile?.status !== "activo") {
    return json({ error: "Solo admin puede crear usuarios" }, 403);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "JSON inválido" }, 400);
  }

  const fullName = String(body.fullName || "").trim();
  const username = String(body.username || "").trim().toLowerCase();
  const email = String(body.email || "").trim().toLowerCase();
  const contactEmail = body.contactEmail ? String(body.contactEmail).trim().toLowerCase() : null;
  const role = String(body.role || "");
  const password = String(body.password || "");
  const phone = body.phone ? String(body.phone).trim() : null;

  if (!fullName || !username || !email) return json({ error: "Completa nombre y usuario" }, 400);
  if (!USERNAME_RE.test(username)) {
    return json({ error: "Usuario inválido (3-32 caracteres, letras/números)" }, 400);
  }
  if (!ROLES.includes(role as (typeof ROLES)[number])) return json({ error: "Rol inválido" }, 400);
  if (password.length < MIN_PASSWORD) {
    return json({ error: `La contraseña debe tener al menos ${MIN_PASSWORD} caracteres` }, 400);
  }

  const { data: taken } = await admin
    .from("profiles")
    .select("id")
    .eq("username", username)
    .maybeSingle();
  if (taken) return json({ error: "Ese usuario ya existe" }, 409);

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, username, contact_email: contactEmail },
  });
  if (createError || !created.user) {
    return json({ error: createError?.message || "No se pudo crear el usuario" }, 400);
  }

  const { error: profileError } = await admin
    .from("profiles")
    .update({ role, username, phone, email: contactEmail, full_name: fullName })
    .eq("id", created.user.id);
  if (profileError) {
    await admin.auth.admin.deleteUser(created.user.id);
    return json({ error: profileError.message }, 400);
  }

  return json({ id: created.user.id });
});
