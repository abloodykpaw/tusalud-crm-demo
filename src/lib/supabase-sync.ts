import type {
  AppData,
  HistoryEvent,
  Lead,
  Profile,
  ReportEntry,
  ReportTarget,
  WeeklyPayment,
  WeeklyTask,
} from "./types";
import { WEEK_NUMBER, WEEK_START } from "./seed";
import { rollWeekForward } from "./weekCalendar";
import { getSupabase } from "./supabase";
import { businessDayUtcRange, todayKey } from "./dayFolders";
import { mapPool, REPORT_UPLOAD_CONCURRENCY } from "./reportUpload";
import { normalizeTaskGoalType } from "./taskGoals";

const LEAD_UPSERT_CHUNK = 40;

/**
 * PostgREST no falla cuando RLS deja un UPDATE/DELETE en 0 filas:
 * pedimos el id de vuelta y lo tratamos como error de permiso.
 */
async function expectRows(
  query: PromiseLike<{ data: unknown[] | null; error: unknown }>
): Promise<void> {
  const { data, error } = await query;
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("Sin permiso o fila inexistente");
}
/** PostgREST suele limitar a 1000 filas; paginamos para no cortar ni reordenar mal. */
const LEAD_PULL_PAGE = 500;

function leadToDbRow(l: Lead) {
  return {
    id: l.id,
    lead_number: l.leadNumber,
    first_name: l.firstName,
    last_name: l.lastName,
    phone: l.phone || null,
    email: l.email || null,
    city: l.city || null,
    source: l.source || "manual",
    status: l.status,
    assigned_agent_id: l.assignedAgentId || null,
    report_target_id: l.reportTargetId || null,
    notes: l.notes || null,
    raw_data: {
      ...(l.rawData || {}),
      ...(l.columnOrder?.length ? { _columnOrder: l.columnOrder } : {}),
    },
    created_at: l.createdAt,
    updated_at: new Date().toISOString(),
  };
}

export async function fetchNextLeadNumber(): Promise<number> {
  return fetchNextLeadNumberForDay(todayKey());
}

/** Siguiente # del día de negocio (reinicia en 1 cada día Caracas). */
export async function fetchNextLeadNumberForDay(dayKey: string): Promise<number> {
  const sb = getSupabase();
  const range = businessDayUtcRange(dayKey);
  let query = sb.from("leads").select("lead_number").order("lead_number", { ascending: false }).limit(1);
  if (range) {
    query = query.gte("created_at", range.start).lt("created_at", range.end);
  }
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data?.lead_number != null ? Number(data.lead_number) + 1 : 1;
}

/** Reserva `count` números consecutivos del día en la base (sin choques entre importaciones). */
export async function reserveLeadNumbers(dayKey: string, count: number): Promise<number> {
  const sb = getSupabase();
  const { data, error } = await sb.rpc("reserve_lead_numbers", { p_day: dayKey, p_count: count });
  if (error) throw error;
  return Number(data) || 1;
}

/** Sube leads nuevos en lotes (INSERT/upsert). Solo staff: agentes no tienen INSERT en leads. */
export async function pushLeadsRows(leads: Lead[]) {
  if (!leads.length) return;
  const sb = getSupabase();
  const rows = leads.map(leadToDbRow);
  for (let i = 0; i < rows.length; i += LEAD_UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + LEAD_UPSERT_CHUNK);
    const { error } = await sb.from("leads").upsert(chunk, { onConflict: "id" });
    if (error) throw error;
  }
}

/** Trae todos los leads en páginas, orden Excel (#1 → #N). */
const PULL_PAGE = 1000;

/** PostgREST corta en 1000 filas: trae todas las páginas (el orden debe ser estable). */
async function pullAllPages<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>
): Promise<{ data: T[]; error: null }> {
  const all: T[] = [];
  for (let from = 0; ; from += PULL_PAGE) {
    const { data, error } = await page(from, from + PULL_PAGE - 1);
    if (error) throw error;
    const chunk = data || [];
    all.push(...chunk);
    if (chunk.length < PULL_PAGE) break;
  }
  return { data: all, error: null };
}

export async function pullAllLeadsRows() {
  const sb = getSupabase();
  const all: Record<string, unknown>[] = [];
  for (let from = 0; ; from += LEAD_PULL_PAGE) {
    const to = from + LEAD_PULL_PAGE - 1;
    const { data, error } = await sb
      .from("leads")
      .select("*")
      .order("lead_number", { ascending: true })
      .order("created_at", { ascending: true })
      .range(from, to);
    if (error) throw error;
    const chunk = data || [];
    all.push(...chunk);
    if (chunk.length < LEAD_PULL_PAGE) break;
  }
  return all;
}

/** Actualiza un lead existente (agentes solo tienen UPDATE, no INSERT/upsert). */
export async function updateLeadRow(lead: Lead) {
  const sb = getSupabase();
  const row = leadToDbRow(lead);
  await expectRows(
    sb
      .from("leads")
      .update({
        lead_number: row.lead_number,
        first_name: row.first_name,
        last_name: row.last_name,
        phone: row.phone,
        email: row.email,
        city: row.city,
        source: row.source,
        status: row.status,
        assigned_agent_id: row.assigned_agent_id,
        notes: row.notes,
        raw_data: row.raw_data,
        updated_at: row.updated_at,
      })
      .eq("id", lead.id)
      .select("id")
  );
}

/** Mueve leads a otro perfil de reporte (solo staff: el trigger lo ignora para agentes). */
export async function updateLeadsReportTarget(ids: string[], targetId: string | null) {
  if (!ids.length) return;
  const sb = getSupabase();
  const updatedAt = new Date().toISOString();
  for (let i = 0; i < ids.length; i += LEAD_UPSERT_CHUNK) {
    const chunk = ids.slice(i, i + LEAD_UPSERT_CHUNK);
    await expectRows(
      sb
        .from("leads")
        .update({ report_target_id: targetId, updated_at: updatedAt })
        .in("id", chunk)
        .select("id")
    );
  }
}

/**
 * Actualiza leads existentes en lotes (status, asignación, etc.).
 * Usar esto para agentes: RLS solo permite UPDATE, no upsert/INSERT.
 */
export async function updateLeadsRows(leads: Lead[]) {
  if (!leads.length) return;
  for (let i = 0; i < leads.length; i += LEAD_UPSERT_CHUNK) {
    const chunk = leads.slice(i, i + LEAD_UPSERT_CHUNK);
    await Promise.all(chunk.map((lead) => updateLeadRow(lead)));
  }
}

function taskToDbRow(task: WeeklyTask) {
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    assigned_to: task.assignedTo,
    created_by: task.createdBy,
    week_start: task.weekStart,
    due_date: task.dueDate || null,
    status: task.status,
    proofs_validated: task.proofsValidated,
    goal_type: task.goalType || "none",
    goal_target: task.goalTarget || 0,
    goal_current: task.goalCurrent || 0,
  };
}

/** Crea/actualiza tarea (staff). */
export async function upsertTaskRow(task: WeeklyTask) {
  const sb = getSupabase();
  const { error } = await sb.from("weekly_tasks").upsert(taskToDbRow(task), { onConflict: "id" });
  if (error) throw error;
}

/** Elimina una tarea (staff). Los avances se borran en cascada. */
export async function deleteTaskRow(id: string) {
  const sb = getSupabase();
  await expectRows(sb.from("weekly_tasks").delete().eq("id", id).select("id"));
}

/** Estado y validación de una tarea (la meta la calcula la base). */
export async function updateTaskRow(task: WeeklyTask) {
  const sb = getSupabase();
  await expectRows(
    sb
      .from("weekly_tasks")
      .update({
        status: task.status,
        proofs_validated: task.proofsValidated,
      })
      .eq("id", task.id)
      .select("id")
  );
}

export async function insertTaskProgressNote(
  taskId: string,
  note: { at: string; notes: string; by: string }
) {
  const sb = getSupabase();
  const { error } = await sb.from("task_progress").insert({
    task_id: taskId,
    submitted_by: note.by,
    notes: note.notes,
    submitted_at: note.at,
  });
  if (error) throw error;
}

/** numeric de Postgres llega como string o number; acepta también "$450.00". */
function parseAmount(raw: unknown): number | undefined {
  if (raw == null || raw === "") return undefined;
  const n = typeof raw === "number" ? raw : Number(String(raw).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

const RECEIPTS_BUCKET = "payment-receipts";

/** Sube el comprobante a Storage (bucket privado) y devuelve la ruta. */
export async function uploadPaymentReceipt(agentId: string, weekStart: string, file: File): Promise<string> {
  const sb = getSupabase();
  const ext = (file.name.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
  const path = `${agentId}/${weekStart}.${ext}`;
  const { error } = await sb.storage
    .from(RECEIPTS_BUCKET)
    .upload(path, file, { upsert: true, contentType: file.type || undefined });
  if (error) throw error;
  return path;
}

export async function signedReceiptUrl(path: string): Promise<string | null> {
  const sb = getSupabase();
  const { data, error } = await sb.storage.from(RECEIPTS_BUCKET).createSignedUrl(path, 300);
  if (error) {
    console.error("[sync] signed url:", error);
    return null;
  }
  return data?.signedUrl ?? null;
}

function paymentToDbRow(p: WeeklyPayment) {
  return {
    id: p.id,
    agent_id: p.agentId,
    week_start: p.weekStart,
    status: p.status,
    zelle_holder: p.zelleData?.holder || null,
    zelle_target: p.zelleData?.zelleEmailOrPhone || null,
    zelle_contact: p.zelleData?.contact || null,
    zelle_notes: p.zelleData?.notes || null,
    zelle_submitted_at: p.zelleData?.submittedAt || null,
    data_requested_at: p.dataRequestedAt || null,
    data_requested_by: p.dataRequestedBy || null,
    screenshot_name: p.screenshotName || null,
    screenshot_path: p.screenshotPath || null,
    paid_amount: p.paidAmount ?? null,
    paid_by_name: p.paidByName || null,
    paid_at: p.paidAt || null,
    paid_by_user_id: p.paidByUserId || null,
  };
}

export async function upsertPaymentRow(payment: WeeklyPayment) {
  const sb = getSupabase();
  const { error } = await sb
    .from("weekly_payments")
    .upsert(paymentToDbRow(payment), { onConflict: "id" });
  if (error) throw error;
}

export async function updatePaymentRow(payment: WeeklyPayment) {
  const sb = getSupabase();
  const row = paymentToDbRow(payment);
  const { id, agent_id, week_start, ...fields } = row;
  await expectRows(sb.from("weekly_payments").update(fields).eq("id", id).select("id"));
}

export async function upsertReportTargetRow(target: ReportTarget) {
  const sb = getSupabase();
  const { error } = await sb.from("report_targets").upsert(
    {
      id: target.id,
      name: target.name,
      slug: target.slug,
      active: target.active,
      assigned_agent_id: target.assignedAgentId || null,
    },
    { onConflict: "id" }
  );
  if (error) throw error;
}

export async function updateProfileRow(
  id: string,
  patch: {
    full_name?: string;
    phone?: string | null;
    role?: Profile["role"];
    status?: string;
    last_access?: string | null;
  }
) {
  const sb = getSupabase();
  await expectRows(sb.from("profiles").update(patch).eq("id", id).select("id"));
}

export async function insertHistoryEvents(events: HistoryEvent[]) {
  if (!events.length) return;
  const sb = getSupabase();
  const { error } = await sb.from("history_events").insert(
    events.map((ev) => ({
      id: ev.id,
      at: ev.at,
      actor_id: ev.actorId || null,
      actor_name: ev.actorName,
      actor_role: ev.actorRole,
      module: ev.module,
      type: ev.type,
      summary: ev.summary,
      entity_type: ev.entityType || null,
      entity_id: ev.entityId || null,
      meta: ev.meta || null,
    }))
  );
  if (error) throw error;
}

/** Alta de usuario con service role (Edge Function): no toca la sesión del admin. */
export async function adminCreateUser(body: {
  fullName: string;
  username: string;
  email: string;
  contactEmail: string | null;
  role: Profile["role"];
  password: string;
  phone: string | null;
}): Promise<{ id: string }> {
  const sb = getSupabase();
  const { data, error } = await sb.functions.invoke("admin-create-user", { body });
  if (error) {
    let message = error.message;
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") {
      try {
        const payload = await ctx.json();
        if (payload?.error) message = String(payload.error);
      } catch {
        /* respuesta sin JSON */
      }
    }
    throw new Error(message);
  }
  if (!data?.id) throw new Error(data?.error || "No se pudo crear el usuario");
  return { id: String(data.id) };
}

export async function pushAppSettings(settings: {
  forcePaymentWindow: boolean;
  currentWeekStart: string;
  weekNumber: number;
}) {
  const sb = getSupabase();
  const rows = [
    { key: "force_payment_window", value: settings.forcePaymentWindow },
    { key: "current_week_start", value: settings.currentWeekStart },
    { key: "week_number", value: settings.weekNumber },
  ];
  const { error } = await sb.from("app_settings").upsert(rows, { onConflict: "key" });
  if (error) throw error;
}

/** Publica un reporte nuevo. */
export async function pushReportEntry(entry: ReportEntry) {
  const sb = getSupabase();
  const { error } = await sb.from("report_entries").insert({
    id: entry.id,
    target_id: entry.targetId,
    type: entry.type,
    title: entry.title,
    report_date: entry.reportDate,
    uploaded_by: entry.uploadedBy,
    file_name: entry.fileName || null,
    file_content: entry.fileContent || null,
    created_at: entry.createdAt,
    person_key: entry.personKey || null,
    linked_lead_id: entry.linkedLeadId || null,
  });
  if (error?.code === "23505") {
    throw new Error(
      `${entry.fileName || entry.personKey || "Carta"}: duplicada (ese PDF o ese lead ya tienen carta)`
    );
  }
  if (error) throw error;

  if (entry.names.length) {
    const { error: namesError } = await sb.from("report_entry_names").insert(
      entry.names.map((name, index) => ({
        entry_id: entry.id,
        full_name: name,
        sort_order: index,
      }))
    );
    if (namesError) throw namesError;
  }
}

/** Publica varios reportes en paralelo (concurrencia limitada). */
export async function pushReportEntries(entries: ReportEntry[]) {
  if (!entries.length) return;
  if (entries.length === 1) {
    await pushReportEntry(entries[0]);
    return;
  }
  const results = await mapPool(entries, REPORT_UPLOAD_CONCURRENCY, async (entry) => {
    try {
      await pushReportEntry(entry);
      return { id: entry.id, ok: true as const };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error al guardar";
      return { id: entry.id, ok: false as const, error: msg };
    }
  });
  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    const detail = failed.map((f) => ("error" in f ? f.error : "")).filter(Boolean).join("; ");
    const error = new Error(
      failed.length === entries.length
        ? detail || "No se pudo guardar ningún reporte"
        : `Se guardaron ${entries.length - failed.length} de ${entries.length}. ${detail}`
    );
    (error as Error & { failedIds?: string[] }).failedIds = failed.map((f) => f.id);
    throw error;
  }
}

/** Corrige un reporte ya publicado (ventana de 5 min del agente). */
export async function updateReportEntryRow(entry: ReportEntry) {
  const sb = getSupabase();
  await expectRows(
    sb
      .from("report_entries")
      .update({
        title: entry.title,
        file_name: entry.fileName || null,
        file_content: entry.fileContent || null,
        person_key: entry.personKey || null,
        linked_lead_id: entry.linkedLeadId || null,
      })
      .eq("id", entry.id)
      .select("id")
  );

  const { error: delNamesError } = await sb
    .from("report_entry_names")
    .delete()
    .eq("entry_id", entry.id);
  if (delNamesError) throw delNamesError;

  if (entry.names.length) {
    const { error: namesError } = await sb.from("report_entry_names").insert(
      entry.names.map((name, index) => ({
        entry_id: entry.id,
        full_name: name,
        sort_order: index,
      }))
    );
    if (namesError) throw namesError;
  }
}

/** Solo actualiza vínculo carta → lead (RPC: admin/encargado, sin ventana de 5 min). */
export async function patchReportEntryLinks(
  patches: Array<{ id: string; linkedLeadId: string; personKey?: string }>
) {
  if (!patches.length) return;
  await mapPool(patches, REPORT_UPLOAD_CONCURRENCY, async (p) => {
    const sb = getSupabase();
    const { error } = await sb.rpc("link_carta_to_lead", {
      p_entry: p.id,
      p_lead: p.linkedLeadId,
      p_person_key: p.personKey ?? null,
    });
    if (error) throw error;
  });
}

const REPORT_ENTRY_LIST_COLUMNS =
  "id, target_id, type, title, report_date, uploaded_by, file_name, created_at, person_key, linked_lead_id, content_hash";

function pullReportEntryRows() {
  const sb = getSupabase();
  return pullAllPages((from, to) =>
    sb
      .from("report_entries")
      .select(REPORT_ENTRY_LIST_COLUMNS)
      .order("created_at", { ascending: false })
      .order("id")
      .range(from, to)
  );
}

function pullReportEntryNameRows() {
  const sb = getSupabase();
  return pullAllPages((from, to) =>
    sb
      .from("report_entry_names")
      .select("*")
      .order("entry_id")
      .order("sort_order")
      .range(from, to)
  );
}

/** Lee reportes desde la nube (sin PDF/base64: se piden al descargar). */
export async function pullReportEntries(
  profiles: Profile[]
): Promise<ReportEntry[]> {
  const sb = getSupabase();
  const [entriesRes, namesRes] = await Promise.all([
    pullReportEntryRows(),
    pullReportEntryNameRows(),
  ]);
  if (entriesRes.error) throw entriesRes.error;
  if (namesRes.error) throw namesRes.error;

  const profileMap = new Map(profiles.map((p) => [p.id, p]));
  const namesByEntry = new Map<string, string[]>();
  for (const row of namesRes.data || []) {
    const list = namesByEntry.get(row.entry_id) || [];
    list.push(row.full_name);
    namesByEntry.set(row.entry_id, list);
  }

  return (entriesRes.data || []).map((row) => {
    const uploader = profileMap.get(row.uploaded_by);
    return {
      id: row.id,
      targetId: row.target_id,
      type: row.type,
      title: row.title,
      reportDate: row.report_date,
      uploadedBy: row.uploaded_by,
      agentName: uploader?.fullName || "Agente",
      fileName: row.file_name || undefined,
      names: namesByEntry.get(row.id) || [],
      createdAt: row.created_at,
      personKey: row.person_key || undefined,
      linkedLeadId: row.linked_lead_id || null,
      contentHash: row.content_hash || undefined,
    };
  });
}

/** Descarga el contenido del archivo de un reporte (PDF/txt) solo cuando hace falta. */
export async function fetchReportEntryFileContent(id: string): Promise<string | undefined> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("report_entries")
    .select("file_content")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data?.file_content || undefined;
}

export async function deleteReportEntryRow(id: string) {
  const sb = getSupabase();
  await expectRows(sb.from("report_entries").delete().eq("id", id).select("id"));
}

type DbProfile = {
  id: string;
  full_name: string;
  username: string | null;
  email: string | null;
  role: Profile["role"];
  phone: string | null;
  status: string;
  last_access: string | null;
};

function toProfile(row: DbProfile): Profile {
  return {
    id: row.id,
    fullName: row.full_name,
    username: row.username || "",
    email: row.email || "",
    role: row.role,
    phone: row.phone || undefined,
    status: row.status === "inactivo" ? "inactivo" : "activo",
    password: "",
    lastAccess: row.last_access || undefined,
  };
}

function toTarget(row: {
  id: string;
  name: string;
  slug: string;
  active: boolean;
  assigned_agent_id?: string | null;
}): ReportTarget {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    active: row.active,
    assignedAgentId: row.assigned_agent_id || null,
  };
}

export async function pullAppData(): Promise<AppData> {
  const sb = getSupabase();

  const [
    profilesRes,
    targetsRes,
    entriesRes,
    namesRes,
    leadsRows,
    tasksRes,
    progressRes,
    paymentsRes,
    historyRes,
    settingsRes,
  ] = await Promise.all([
    sb.from("profiles").select("*").order("full_name"),
    sb.from("report_targets").select("*").order("name"),
    pullReportEntryRows(),
    pullReportEntryNameRows(),
    pullAllLeadsRows(),
    pullAllPages((from, to) =>
      sb.from("weekly_tasks").select("*").order("created_at", { ascending: false }).order("id").range(from, to)
    ),
    pullAllPages((from, to) =>
      sb.from("task_progress").select("*").order("submitted_at").order("id").range(from, to)
    ),
    pullAllPages((from, to) =>
      sb.from("weekly_payments").select("*").order("created_at", { ascending: false }).order("id").range(from, to)
    ),
    sb.from("history_events").select("*").order("at", { ascending: false }).limit(200),
    sb.from("app_settings").select("*"),
  ]);

  for (const res of [
    profilesRes,
    targetsRes,
    entriesRes,
    namesRes,
    tasksRes,
    progressRes,
    paymentsRes,
    historyRes,
    settingsRes,
  ]) {
    if (res.error) throw res.error;
  }

  const profileMap = new Map(
    (profilesRes.data as DbProfile[]).map((p) => [p.id, toProfile(p)])
  );

  const namesByEntry = new Map<string, string[]>();
  for (const row of namesRes.data || []) {
    const list = namesByEntry.get(row.entry_id) || [];
    list.push(row.full_name);
    namesByEntry.set(row.entry_id, list);
  }

  const reportEntries: ReportEntry[] = (entriesRes.data || []).map((row) => {
    const uploader = profileMap.get(row.uploaded_by);
    return {
      id: row.id,
      targetId: row.target_id,
      type: row.type,
      title: row.title,
      reportDate: row.report_date,
      uploadedBy: row.uploaded_by,
      agentName: uploader?.fullName || "Agente",
      fileName: row.file_name || undefined,
      names: namesByEntry.get(row.id) || [],
      createdAt: row.created_at,
      personKey: row.person_key || undefined,
      linkedLeadId: row.linked_lead_id || null,
      contentHash: row.content_hash || undefined,
    };
  });

  const progressByTask = new Map<string, WeeklyTask["progressNotes"]>();
  for (const row of progressRes.data || []) {
    const list = progressByTask.get(row.task_id) || [];
    list.push({ at: row.submitted_at, notes: row.notes || "", by: row.submitted_by });
    progressByTask.set(row.task_id, list);
  }

  const tasks: WeeklyTask[] = (tasksRes.data || []).map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description || "",
    assignedTo: row.assigned_to,
    createdBy: row.created_by,
    weekStart: row.week_start,
    dueDate: row.due_date || "",
    status: row.status,
    proofsValidated: !!row.proofs_validated,
    progressNotes: progressByTask.get(row.id) || [],
    goalType: normalizeTaskGoalType(row.goal_type),
    goalTarget: Number(row.goal_target) || 0,
    goalCurrent: Number(row.goal_current) || 0,
  }));

  const leads: Lead[] = (leadsRows || []).map((row) => {
    const raw = (row.raw_data as Record<string, unknown> | null) || {};
    const columnOrder = Array.isArray(raw._columnOrder) ? (raw._columnOrder as string[]) : undefined;
    const { _columnOrder: _co, ...rest } = raw;
    const rawData =
      Object.keys(rest).length > 0
        ? Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, String(v ?? "")]))
        : undefined;
    return {
      id: row.id as string,
      leadNumber: Number(row.lead_number) || 0,
      firstName: row.first_name as string,
      lastName: (row.last_name as string) || "",
      phone: (row.phone as string) || "",
      email: (row.email as string) || "",
      city: (row.city as string) || "",
      source: (row.source as string) || "manual",
      status: row.status as Lead["status"],
      assignedAgentId: (row.assigned_agent_id as string) || null,
      reportTargetId: (row.report_target_id as string) || null,
      notes: (row.notes as string) || "",
      rawData,
      columnOrder,
      createdAt: row.created_at as string,
    };
  });

  const payments: WeeklyPayment[] = (paymentsRes.data || []).map((row) => ({
    id: row.id,
    agentId: row.agent_id,
    weekStart: row.week_start,
    status: row.status,
    zelleData: row.zelle_holder
      ? {
          method: "Zelle",
          holder: row.zelle_holder,
          zelleEmailOrPhone: row.zelle_target || "",
          contact: row.zelle_contact || "",
          notes: row.zelle_notes || undefined,
          submittedAt: row.zelle_submitted_at || new Date().toISOString(),
        }
      : null,
    dataRequestedAt: row.data_requested_at || undefined,
    dataRequestedBy: row.data_requested_by || undefined,
    screenshotName: row.screenshot_name || undefined,
    screenshotPath: row.screenshot_path || undefined,
    paidAmount: parseAmount(row.paid_amount),
    paidByName: row.paid_by_name || undefined,
    paidAt: row.paid_at || undefined,
    paidByUserId: row.paid_by_user_id || undefined,
  }));

  const historyEvents: HistoryEvent[] = (historyRes.data || []).map((row) => ({
    id: row.id,
    at: row.at,
    actorId: row.actor_id || "",
    actorName: row.actor_name,
    actorRole: row.actor_role,
    module: row.module,
    type: row.type,
    summary: row.summary,
    entityType: row.entity_type || undefined,
    entityId: row.entity_id || undefined,
    meta: row.meta || undefined,
  }));

  const settings = Object.fromEntries((settingsRes.data || []).map((s) => [s.key, s.value]));

  return {
    profiles: [...profileMap.values()],
    reportTargets: (targetsRes.data || []).map(toTarget),
    reportEntries,
    leads,
    tasks,
    payments,
    historyEvents,
    forcePaymentWindow: settings.force_payment_window === true,
    defaultWeeklyAmount: parseAmount(settings.default_weekly_amount),
    ...rollWeekForward({
      currentWeekStart:
        typeof settings.current_week_start === "string"
          ? settings.current_week_start
          : WEEK_START,
      weekNumber:
        typeof settings.week_number === "number" ? settings.week_number : WEEK_NUMBER,
    }),
  };
}

export async function pushAppData(data: AppData) {
  const sb = getSupabase();

  const profileRows = data.profiles.map((p) => ({
    id: p.id,
    full_name: p.fullName,
    username: p.username || null,
    email: p.email || null,
    role: p.role,
    phone: p.phone || null,
    status: p.status,
    last_access: p.lastAccess || null,
  }));

  if (profileRows.length) {
    const { error } = await sb.from("profiles").upsert(profileRows, { onConflict: "id" });
    if (error) throw error;
  }

  const targetRows = data.reportTargets.map((t) => ({
    id: t.id,
    name: t.name,
    slug: t.slug,
    active: t.active,
    assigned_agent_id: t.assignedAgentId || null,
  }));
  if (targetRows.length) {
    const { error } = await sb.from("report_targets").upsert(targetRows, { onConflict: "id" });
    if (error) throw error;
  }

  // Upsert-only: no borrar filas de la nube que no estén en este snapshot (evita wipe entre pestañas).
  for (const entry of data.reportEntries) {
    const { error } = await sb.from("report_entries").upsert(
      {
        id: entry.id,
        target_id: entry.targetId,
        type: entry.type,
        title: entry.title,
        report_date: entry.reportDate,
        uploaded_by: entry.uploadedBy,
        file_name: entry.fileName || null,
        file_content: entry.fileContent || null,
        created_at: entry.createdAt,
        person_key: entry.personKey || null,
        linked_lead_id: entry.linkedLeadId || null,
      },
      { onConflict: "id" }
    );
    if (error) throw error;
  }

  if (data.leads.length) {
    await pushLeadsRows(data.leads);
  }

  for (const task of data.tasks) {
    const { error } = await sb.from("weekly_tasks").upsert(taskToDbRow(task), { onConflict: "id" });
    if (error) throw error;
  }

  if (data.payments.length) {
    const { error } = await sb
      .from("weekly_payments")
      .upsert(data.payments.map(paymentToDbRow), { onConflict: "id" });
    if (error) throw error;
  }

  await pushAppSettings({
    forcePaymentWindow: data.forcePaymentWindow,
    currentWeekStart: data.currentWeekStart,
    weekNumber: data.weekNumber,
  });
}

export async function fetchProfile(userId: string): Promise<Profile | null> {
  const sb = getSupabase();
  const { data, error } = await sb.from("profiles").select("*").eq("id", userId).maybeSingle();
  if (error) throw error;
  return data ? toProfile(data as DbProfile) : null;
}
