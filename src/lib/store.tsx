import { createContext, useContext, useEffect, useMemo, useState, useCallback, useRef, type ReactNode } from "react";
import type {
  AppData,
  HistoryEvent,
  HistoryEventType,
  HistoryModule,
  Lead,
  LeadStatus,
  Profile,
  ReportEntry,
  ReportType,
  Role,
  SessionUser,
  WeeklyTask,
  TaskStatus,
  TaskGoalType,
  WeeklyPayment,
  ZellePaymentData,
} from "./types";
import { PAYMENT_METHOD } from "./types";
import { loadData, saveData, resetData, uid, WEEK_START, WEEK_NUMBER } from "./seed";
import {
  evaluateAgentWeekTasks,
  getPaymentPhase,
  mondayOfDate,
  operativeWeekStartFor,
  taskEffectiveWeekStart,
  tasksInWeek,
} from "./weekCalendar";
import { HISTORY_MAX } from "./history";
import { buildReportTitle, getReportManageAccess, isPdfDataUrl } from "./reportUpload";
import { authEmailForUsername, isValidUsername, MIN_PASSWORD_LENGTH, normalizeUsername } from "./auth";
import { assignableProfilesForRole, canAssignReportToProfile, slugifyReportName } from "./reportTargets";
import { clearRememberedLogin, saveRememberedLogin } from "./remember-login";
import { getSupabase, isSupabaseEnabled } from "./supabase";
import {
  adminCreateUser,
  deleteReportEntryRow,
  fetchProfile,
  fetchReportEntryFileContent,
  insertHistoryEvents,
  insertTaskProgressNote,
  patchReportEntryLinks,
  pullAppData,
  pullReportEntries,
  pushAppSettings,
  pushLeadsRows,
  pushReportEntries,
  reserveLeadNumbers,
  signedReceiptUrl,
  updateLeadRow,
  updateLeadsReportTarget,
  updateLeadsRows,
  updatePaymentRow,
  updateProfileRow,
  updateReportEntryRow,
  updateTaskRow,
  upsertPaymentRow,
  upsertReportTargetRow,
  upsertTaskRow,
  deleteTaskRow,
  uploadPaymentReceipt,
} from "./supabase-sync";
import { DEFAULT_WEEKLY_AMOUNT, formatUsd, RECEIPT_MAX_BYTES, RECEIPT_TYPES } from "./money";
import {
  applyCartaLinkRepairs,
  filterDuplicateConsentUploads,
  consentContentHash,
  CONSENT_DUPLICATE_LABEL,
  type ConsentUploadFilterResult,
  personKeyFromConsentInput,
  planConsentLeadSync,
  validateLeadCartaIntegrity,
  type ConsentSyncPlan,
  type LeadCartaIntegrity,
} from "./cartaLeadSync";
import { dayKeyFromIso, todayKey } from "./dayFolders";
import { leadMatchKey, leadSortNumber } from "./lead-dependents";
import { bumpConsentRealizadoGoals, taskHasCompletionEvidence } from "./taskGoals";

/** IDs compatibles con columnas uuid de Supabase. */
function newEntityId(prefix: string) {
  return isSupabaseEnabled ? crypto.randomUUID() : uid(prefix);
}

/** Extrae mensaje legible de errores de Supabase / PostgREST (no siempre son instanceof Error). */
function cloudErrorMessage(err: unknown, fallback = "Error al guardar en la nube"): string {
  if (err instanceof Error && err.message.trim()) return err.message;
  if (err && typeof err === "object" && "message" in err) {
    const msg = (err as { message?: unknown }).message;
    if (typeof msg === "string" && msg.trim()) return msg;
  }
  return fallback;
}

function emptyAppData(): AppData {
  return {
    profiles: [],
    reportTargets: [],
    reportEntries: [],
    leads: [],
    tasks: [],
    payments: [],
    historyEvents: [],
    forcePaymentWindow: false,
    currentWeekStart: WEEK_START,
    weekNumber: WEEK_NUMBER,
  };
}

const DEMO_CREDENTIALS: Record<string, { username: string; password: string }> = isSupabaseEnabled
  ? {}
  : {
      admin: { username: "abloody", password: "TuSalud2026!" },
      abloody: { username: "abloody", password: "TuSalud2026!" },
      kennedy: { username: "kennedy", password: "TuSalud2026!" },
      jesmary: { username: "jesmary", password: "TuSalud2026!" },
      cynthia: { username: "cynthia", password: "TuSalud2026!" },
      nomina: { username: "cynthia", password: "TuSalud2026!" },
    };

type StoreCtx = {
  data: AppData;
  /** Sesión real (quien inició sesión) */
  user: SessionUser | null;
  /** Identidad efectiva para UI y datos (respeta vista previa del admin) */
  viewUser: SessionUser | null;
  /** Rol efectivo de la UI */
  viewRole: Role | null;
  /** Vista previa activa (solo admin); null = rol real */
  viewAs: Role | null;
  /** Agente que se previsualiza cuando viewAs === "agente". */
  previewAgentId: string | null;
  setViewAs: (role: Role | null, agentId?: string | null) => void;
  /** Último error al guardar en la nube (la UI lo muestra como toast). */
  syncError: { id: string; message: string } | null;
  login: (
    username: string,
    password: string,
    options?: { remember?: boolean }
  ) => Promise<{ ok: boolean; error?: string }>;
  loginAs: (roleOrId: string) => void;
  logout: () => void;
  reset: () => void;
  agents: Profile[];
  isStaff: boolean;
  isPayroll: boolean;
  canAssignTasks: boolean;
  canAssignReports: boolean;
  canManageUsers: boolean;
  canDownloadReports: boolean;
  isAdmin: boolean;
  currentWeekStart: string;
  weekNumber: number;
  /** @deprecated Prefer isDataWindowOpen / isPayWindowOpen */
  isPaymentWindowOpen: boolean;
  isDataWindowOpen: boolean;
  isPayWindowOpen: boolean;
  isSundayAssign: boolean;
  setForcePaymentWindow: (v: boolean) => void;
  addReportEntry: (input: {
    targetId: string;
    type: ReportType;
    names: string[];
    fileName?: string;
    fileContent?: string;
    /** ISO opcional: útil para lotes (orden #1…N en el día). */
    createdAt?: string;
    /** YYYY-MM-DD de negocio (Caracas); si no, se deriva de createdAt. */
    reportDate?: string;
  }) => Promise<{ ok: boolean; error?: string }>;
  addReportEntries: (
    items: {
      targetId: string;
      type: ReportType;
      names: string[];
      fileName?: string;
      fileContent?: string;
      createdAt?: string;
      reportDate?: string;
    }[]
  ) => Promise<{
    ok: boolean;
    inserted: number;
    skippedDuplicates?: number;
    duplicateDetails?: string[];
    markedRealizado?: number;
    tasksProgressed?: number;
    tasksAutoCompleted?: number;
    syncCounts?: ConsentSyncPlan["counts"];
    syncNeedsAttention?: number;
    error?: string;
  }>;
  updateReportEntry: (
    id: string,
    input: { names: string[]; fileName?: string; fileContent?: string }
  ) => Promise<{ ok: boolean; error?: string }>;
  deleteReportEntry: (id: string) => Promise<{ ok: boolean; error?: string }>;
  refreshReports: () => Promise<void>;
  assignReportTarget: (
    targetId: string,
    agentId: string | null
  ) => { ok: boolean; error?: string };
  createReportTarget: (
    name: string,
    assignedAgentId?: string | null
  ) => { ok: boolean; error?: string };
  addLeads: (leads: Omit<Lead, "id" | "createdAt" | "leadNumber">[]) => Promise<number>;
  upsertLeads: (
    leads: Omit<Lead, "id" | "createdAt" | "leadNumber">[]
  ) => Promise<{ inserted: number; updated: number }>;
  updateLead: (id: string, patch: Partial<Lead>) => void;
  markLeadsRealizado: (leadIds: string[]) => number;
  /** Vincula a mano una carta dudosa a un lead (homónimos). Solo staff. */
  linkCartaToLead: (entryId: string, leadId: string) => Promise<{ ok: boolean; error?: string }>;
  assignLead: (leadId: string, agentId: string | null) => void;
  assignLeads: (leadIds: string[], agentId: string | null) => number;
  /** Mueve leads a otro perfil de reporte. Solo admin/encargado. */
  setLeadsReportTarget: (leadIds: string[], targetId: string | null) => number;
  addTask: (input: {
    title: string;
    description: string;
    assignedTo: string;
    dueDate: string;
    goalType?: TaskGoalType;
    goalTarget?: number;
  }) => void;
  editTask: (
    id: string,
    input: {
      title: string;
      description: string;
      assignedTo: string;
      dueDate: string;
      goalType: TaskGoalType;
      goalTarget: number;
    }
  ) => { ok: boolean; error?: string };
  /** Elimina una tarea vencida del historial. Solo admin/encargado. */
  deleteTask: (id: string) => Promise<{ ok: boolean; error?: string }>;
  updateTaskStatus: (id: string, status: TaskStatus) => { ok: boolean; error?: string };
  addTaskProgress: (
    taskId: string,
    notes: string,
    markDone?: boolean
  ) => { ok: boolean; error?: string; autoCompleted?: boolean };
  validateTaskProofs: (taskId: string, validated: boolean) => Promise<{ ok: boolean; error?: string }>;
  getAgentStats: (agentId: string) => {
    leads: number;
    closed: number;
    tasksTotal: number;
    tasksDone: number;
    progress: number;
    proofsOk: boolean;
    paymentEligible: boolean;
    dataEligible: boolean;
    thruThursdayOk: boolean;
    fullWeekOk: boolean;
    thruThursdayDone: number;
    thruThursdayTotal: number;
    fridayDone: number;
    fridayTotal: number;
  };
  getOrCreatePayment: (agentId: string) => WeeklyPayment;
  getAgentPaymentHistory: (agentId: string) => WeeklyPayment[];
  /** Solo admin; no deja adelantar más allá de la semana del calendario. */
  canAdvanceWeek: boolean;
  advanceWeek: () => { ok: boolean; error?: string };
  defaultWeeklyAmount: number;
  requestPaymentData: (agentId: string) => Promise<{ ok: boolean; error?: string }>;
  submitZelleData: (
    agentId: string,
    data: Omit<ZellePaymentData, "method" | "submittedAt">
  ) => Promise<{ ok: boolean; error?: string }>;
  markPaymentSent: (
    agentId: string,
    input: { receipt: File | null; paidAmount: number; paidByName: string }
  ) => Promise<{ ok: boolean; error?: string }>;
  /** URL firmada (temporal) del comprobante de pago. */
  getReceiptUrl: (payment: WeeklyPayment) => Promise<string | null>;
  createUser: (input: {
    fullName: string;
    username: string;
    role: import("./types").Role;
    password: string;
    phone?: string;
    email?: string;
  }) => Promise<{ ok: boolean; error?: string }>;
  updateUserRole: (id: string, role: import("./types").Role) => void;
  updateUserStatus: (id: string, status: "activo" | "inactivo") => void;
  updateOwnAccount: (input: {
    fullName: string;
    phone?: string;
    password?: string;
  }) => Promise<{ ok: boolean; error?: string }>;
  /** Salud cartas↔leads (validador continuo). */
  syncHealth: LeadCartaIntegrity | null;
  ready: boolean;
};

const Ctx = createContext<StoreCtx | null>(null);
const SESSION_KEY = "tusalud-session";

function toSession(p: Profile): SessionUser {
  const { password: _, ...rest } = p;
  return rest;
}

function withHistory(
  prev: AppData,
  actor: SessionUser | null | undefined,
  partial: {
    module: HistoryModule;
    type: HistoryEventType;
    summary: string;
    entityType?: HistoryEvent["entityType"];
    entityId?: string;
    meta?: HistoryEvent["meta"];
  }
): AppData {
  if (!actor) return prev;
  const events = prev.historyEvents || [];
  const ev: HistoryEvent = {
    id: uid("hx"),
    at: new Date().toISOString(),
    actorId: actor.id,
    actorName: actor.fullName,
    actorRole: actor.role,
    ...partial,
  };
  return { ...prev, historyEvents: [ev, ...events].slice(0, HISTORY_MAX) };
}

function restoreLeads(prev: AppData, originals: Lead[]): AppData {
  if (!originals.length) return prev;
  const byId = new Map(originals.map((l) => [l.id, l]));
  return { ...prev, leads: prev.leads.map((l) => byId.get(l.id) ?? l) };
}

function restoreTask(prev: AppData, original: WeeklyTask | undefined, removeId?: string): AppData {
  if (removeId) return { ...prev, tasks: prev.tasks.filter((t) => t.id !== removeId) };
  if (!original) return prev;
  return { ...prev, tasks: prev.tasks.map((t) => (t.id === original.id ? original : t)) };
}

/** Compat: ventana de datos (jueves noche) o forzada. */
export function checkPaymentWindow(force: boolean, now = new Date()) {
  return getPaymentPhase(force, now).isDataWindowOpen;
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<AppData>(() =>
    isSupabaseEnabled ? emptyAppData() : loadData()
  );
  const [ready, setReady] = useState(!isSupabaseEnabled);
  const [user, setUser] = useState<SessionUser | null>(() => {
    if (isSupabaseEnabled) return null;
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      return raw ? (JSON.parse(raw) as SessionUser) : null;
    } catch {
      return null;
    }
  });
  const [viewAs, setViewAsState] = useState<Role | null>(null);
  const [previewAgentId, setPreviewAgentId] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<{ id: string; message: string } | null>(null);
  const skipPullUntilRef = useRef(0);
  const [syncHealth, setSyncHealth] = useState<LeadCartaIntegrity | null>(null);
  const dataRef = useRef(data);
  dataRef.current = data;
  const repairFingerprintRef = useRef("");
  const repairingRef = useRef(false);
  const userRoleRef = useRef<Role | null>(null);
  userRoleRef.current = user?.role ?? null;

  const markLocalWrite = useCallback(() => {
    skipPullUntilRef.current = Date.now() + 12000;
  }, []);

  const reportSyncError = useCallback((label: string, err: unknown) => {
    console.error(`[sync] ${label}:`, err);
    setSyncError({ id: crypto.randomUUID(), message: `No se guardó: ${cloudErrorMessage(err)}` });
  }, []);

  /**
   * Escritura en la nube en segundo plano. Si falla: revierte con `rollback`
   * (si se da), vuelve a pedir datos y avisa en un toast de error.
   */
  const cloudSafe = useCallback(
    (label: string, fn: () => Promise<void>, rollback?: (prev: AppData) => AppData) => {
      if (!isSupabaseEnabled) return;
      markLocalWrite();
      fn().catch((err) => {
        reportSyncError(label, err);
        if (rollback) {
          const next = rollback(dataRef.current);
          dataRef.current = next;
          setData(next);
        }
        skipPullUntilRef.current = 0;
        void pullAppData()
          .then((fresh) => setData(fresh))
          .catch((e) => console.error("[sync] pull tras error:", e));
      });
    },
    [markLocalWrite, reportSyncError]
  );

  /** Igual que cloudSafe pero esperando el resultado (para botones que muestran ok/error). */
  const cloudAwait = useCallback(
    async (
      fn: () => Promise<void>,
      rollback?: (prev: AppData) => AppData
    ): Promise<{ ok: boolean; error?: string }> => {
      if (!isSupabaseEnabled) return { ok: true };
      markLocalWrite();
      try {
        await fn();
        return { ok: true };
      } catch (err) {
        console.error("[sync]", err);
        if (rollback) {
          const next = rollback(dataRef.current);
          dataRef.current = next;
          setData(next);
        }
        skipPullUntilRef.current = 0;
        void pullAppData()
          .then((fresh) => setData(fresh))
          .catch((e) => console.error("[sync] pull tras error:", e));
        return { ok: false, error: `No se guardó: ${cloudErrorMessage(err)}` };
      }
    },
    [markLocalWrite]
  );

  useEffect(() => {
    if (!isSupabaseEnabled) return;
    const sb = getSupabase();

    async function bootstrap() {
      const { data: sessionData } = await sb.auth.getSession();
      if (sessionData.session?.user) {
        const profile = await fetchProfile(sessionData.session.user.id);
        if (profile && profile.status === "activo") {
          setUser(toSession(profile));
          setReady(true);
          try {
            const appData = await pullAppData();
            setData(appData);
          } catch (err) {
            console.error("[sync] bootstrap pull:", err);
          }
          return;
        }
        await sb.auth.signOut();
      }
      setReady(true);
    }

    bootstrap().catch((err) => {
      console.error(err);
      setReady(true);
    });

    const { data: sub } = sb.auth.onAuthStateChange((_event, session) => {
      if (!session?.user) {
        setUser(null);
        setViewAsState(null);
      }
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  // Refresco automático + Realtime: todos ven la misma DB sin F5.
  useEffect(() => {
    if (!isSupabaseEnabled || !ready || !user) return;
    let cancelled = false;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const sb = getSupabase();

    async function refreshFromCloud() {
      if (cancelled) return;
      if (Date.now() < skipPullUntilRef.current) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      try {
        const next = await pullAppData();
        if (cancelled) return;
        if (Date.now() < skipPullUntilRef.current) return;
        setData(next);
      } catch (err) {
        console.error("[sync] refresh:", err);
      }
    }

    function scheduleRefresh() {
      if (cancelled) return;
      if (Date.now() < skipPullUntilRef.current) return;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        void refreshFromCloud();
      }, 700);
    }

    const interval = setInterval(refreshFromCloud, 20000);
    const onFocus = () => {
      void refreshFromCloud();
    };
    const onVis = () => {
      if (document.visibilityState === "visible") void refreshFromCloud();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);

    const channel = sb
      .channel(`crm-live:${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "leads" }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "report_entries" }, scheduleRefresh)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "report_entry_names" },
        scheduleRefresh
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "report_targets" }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "weekly_tasks" }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "task_progress" }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "weekly_payments" }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "history_events" }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "app_settings" }, scheduleRefresh)
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          void refreshFromCloud();
        }
      });

    return () => {
      cancelled = true;
      clearInterval(interval);
      if (debounceTimer) clearTimeout(debounceTimer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
      void sb.removeChannel(channel);
    };
  }, [ready, user?.id]);

  useEffect(() => {
    if (isSupabaseEnabled) {
      // En nube el guardado es por entidad (leads/tareas/pagos/reportes).
      // No hacemos pushAppData masivo: borraba o pisaba datos entre roles.
      return;
    }
    saveData(data);
  }, [data, user, ready]);

  useEffect(() => {
    if (!isSupabaseEnabled) {
      if (user) localStorage.setItem(SESSION_KEY, JSON.stringify(user));
      else localStorage.removeItem(SESSION_KEY);
    }
  }, [user]);

  /**
   * El updater corre una sola vez, de inmediato, sobre el estado más reciente:
   * las acciones leen variables que asigna dentro (`updated`, `blocked`) justo
   * después para decidir qué guardar en Supabase. Los eventos de historial
   * nuevos se envían a la nube.
   */
  const persist = useCallback(
    (updater: (prev: AppData) => AppData) => {
      const base = dataRef.current;
      const next = updater(base);
      if (next === base) return;
      dataRef.current = next;
      setData(next);

      if (isSupabaseEnabled && next.historyEvents !== base.historyEvents) {
        const known = new Set(base.historyEvents.map((e) => e.id));
        const fresh = next.historyEvents.filter((e) => !known.has(e.id));
        if (fresh.length) {
          insertHistoryEvents(fresh).catch((err) => console.error("[sync] history:", err));
        }
      }
    },
    []
  );

  /**
   * Validador continuo: siempre verifica vínculos carta→lead_id,
   * repara links seguros y reporta duplicados de nombre.
   */
  useEffect(() => {
    if (!ready || !user) return;
    let cancelled = false;
    let debounce: ReturnType<typeof setTimeout> | null = null;

    async function runIntegrityPass() {
      if (cancelled || repairingRef.current) return;
      const snapshot = dataRef.current;
      if (!snapshot.leads.length && !snapshot.reportEntries.length) {
        setSyncHealth(null);
        return;
      }

      const report = validateLeadCartaIntegrity(snapshot.reportEntries, snapshot.leads);
      setSyncHealth(report);

      // Reparar vínculos usa la RPC link_carta_to_lead (solo admin/encargado).
      const role = userRoleRef.current;
      if (role !== "admin" && role !== "encargado") return;
      if (!report.repairs.length) return;

      const fp = report.repairs
        .map((r) => `${r.entryId}:${r.leadId}:${r.personKey}`)
        .sort()
        .join("|");
      if (fp === repairFingerprintRef.current) return;
      repairFingerprintRef.current = fp;

      repairingRef.current = true;
      try {
        const { entries: nextEntries, changed } = applyCartaLinkRepairs(
          snapshot.reportEntries,
          report.repairs
        );
        if (!changed.length) return;

        persist((prev) => ({ ...prev, reportEntries: nextEntries }));
        setSyncHealth(validateLeadCartaIntegrity(nextEntries, snapshot.leads));

        if (isSupabaseEnabled) {
          markLocalWrite();
          await patchReportEntryLinks(
            changed.map((e) => ({
              id: e.id,
              linkedLeadId: e.linkedLeadId!,
              personKey: e.personKey,
            }))
          );
        }
      } catch (err) {
        console.error("[sync] integrity repair:", err);
        repairFingerprintRef.current = "";
      } finally {
        repairingRef.current = false;
      }
    }

    function schedule() {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        void runIntegrityPass();
      }, 900);
    }

    schedule();
    const interval = setInterval(() => {
      void runIntegrityPass();
    }, 45000);

    return () => {
      cancelled = true;
      if (debounce) clearTimeout(debounce);
      clearInterval(interval);
    };
  }, [ready, user?.id, data.leads.length, data.reportEntries.length, persist, markLocalWrite]);

  const setViewAs = useCallback(
    (role: Role | null, agentId?: string | null) => {
      if (!user || user.role !== "admin") return;
      setViewAsState(role === "admin" ? null : role);
      setPreviewAgentId(role === "agente" ? agentId ?? null : null);
    },
    [user]
  );

  const login = useCallback(
    async (usernameInput: string, password: string, options?: { remember?: boolean }) => {
      const username = normalizeUsername(usernameInput);
      if (!isValidUsername(username)) {
        return { ok: false, error: "Usuario inválido" };
      }

      const rememberLogin = (session: SessionUser) => {
        if (options?.remember) {
          saveRememberedLogin({
            username,
            fullName: session.fullName,
            role: session.role,
          });
        } else if (options?.remember === false) {
          clearRememberedLogin();
        }
      };

      if (isSupabaseEnabled) {
        const sb = getSupabase();
        const { data: authData, error } = await sb.auth.signInWithPassword({
          email: authEmailForUsername(username),
          password,
        });
        if (error) return { ok: false, error: "Credenciales incorrectas" };
        const profile = await fetchProfile(authData.user.id);
        if (!profile) return { ok: false, error: "Perfil no encontrado" };
        if (profile.status !== "activo") {
          await sb.auth.signOut();
          return { ok: false, error: "Usuario inactivo" };
        }
        const lastAccess = new Date().toISOString();
        const session = toSession({ ...profile, lastAccess });
        setViewAsState(null);
        setPreviewAgentId(null);
        setUser(session);
        rememberLogin(session);
        updateProfileRow(session.id, { last_access: lastAccess }).catch((err) =>
          console.error("[sync] last_access:", err)
        );
        // No bloquear el login con el pull pesado de 1000 leads: entra ya y carga en fondo.
        void pullAppData()
          .then((appData) => {
            // No pisar cambios locales (p. ej. marcar realizados) hechos justo tras el login.
            if (Date.now() < skipPullUntilRef.current) return;
            dataRef.current = appData;
            setData(appData);
            persist((prev) =>
              withHistory(prev, session, {
                module: "auth",
                type: "login",
                summary: `${session.fullName} inició sesión`,
                entityType: "session",
                entityId: session.id,
              })
            );
          })
          .catch((err) => console.error("[sync] login pull:", err));
        return { ok: true };
      }

      const found = data.profiles.find(
        (p) => normalizeUsername(p.username) === username && p.password === password
      );
      if (!found) return { ok: false, error: "Credenciales incorrectas" };
      if (found.status !== "activo") return { ok: false, error: "Usuario inactivo" };
      const session = toSession({ ...found, lastAccess: new Date().toISOString() });
      persist((prev) => {
        const next = {
          ...prev,
          profiles: prev.profiles.map((p) =>
            p.id === found.id ? { ...p, lastAccess: session.lastAccess } : p
          ),
        };
        return withHistory(next, session, {
          module: "auth",
          type: "login",
          summary: `${session.fullName} inició sesión`,
          entityType: "session",
          entityId: session.id,
        });
      });
      setViewAsState(null);
      setUser(session);
      rememberLogin(session);
      return { ok: true };
    },
    [data.profiles, persist]
  );

  const loginAs = useCallback(
    async (roleOrId: string) => {
      if (isSupabaseEnabled) {
        const creds = DEMO_CREDENTIALS[roleOrId];
        if (creds) {
          await login(creds.username, creds.password);
          return;
        }
      }
      const found =
        data.profiles.find((p) => p.id === roleOrId) ||
        data.profiles.find((p) => normalizeUsername(p.username) === normalizeUsername(roleOrId)) ||
        data.profiles.find((p) => p.role === roleOrId);
      if (found) {
        const session = toSession(found);
        setViewAsState(null);
        setUser(session);
        persist((prev) =>
          withHistory(prev, session, {
            module: "auth",
            type: "login",
            summary: `${session.fullName} entró (acceso demo)`,
            entityType: "session",
            entityId: session.id,
          })
        );
      }
    },
    [data.profiles, persist, login]
  );

  const logout = useCallback(async () => {
    const current = user;
    if (current) {
      const base = dataRef.current;
      const next = withHistory(base, current, {
        module: "auth",
        type: "logout",
        summary: `${current.fullName} cerró sesión`,
        entityType: "session",
        entityId: current.id,
      });
      dataRef.current = next;
      setData(next);
      // Antes del signOut: la RLS exige la sesión del autor.
      if (isSupabaseEnabled && next.historyEvents[0] && next !== base) {
        await insertHistoryEvents([next.historyEvents[0]]).catch((err) =>
          console.error("[sync] history logout:", err)
        );
      }
    }
    setUser(null);
    setViewAsState(null);
    setPreviewAgentId(null);
    if (isSupabaseEnabled) {
      await getSupabase().auth.signOut();
      setData(emptyAppData());
    }
  }, [user]);

  const reset = useCallback(() => {
    const seed = resetData();
    setData(seed);
    setViewAsState(null);
    setUser(null);
  }, []);

  const agents = useMemo(
    () => data.profiles.filter((p) => p.role === "agente" && p.status === "activo"),
    [data.profiles]
  );

  const isAdmin = user?.role === "admin";

  const viewRole: Role | null = user
    ? isAdmin && viewAs
      ? viewAs
      : user.role
    : null;

  const viewUser: SessionUser | null = useMemo(() => {
    if (!user || !viewRole) return null;
    if (isAdmin && viewAs === "agente") {
      const demo =
        (previewAgentId && data.profiles.find((p) => p.id === previewAgentId)) ||
        data.profiles.find((p) => p.role === "agente" && p.status === "activo");
      if (demo) {
        const { password: _, ...rest } = demo;
        return rest;
      }
    }
    if (isAdmin && viewAs && viewAs !== "admin") {
      return { ...user, role: viewAs };
    }
    return user;
  }, [user, viewRole, isAdmin, viewAs, previewAgentId, data.profiles]);

  const isStaff =
    viewRole === "admin" || viewRole === "encargado" || viewRole === "nomina";
  const isPayroll = isStaff;
  const canAssignTasks = viewRole === "admin" || viewRole === "encargado";
  const canAssignReports = canAssignTasks;
  const canManageUsers = !!isAdmin && (!viewAs || viewAs === "admin");
  const canDownloadReports = viewRole === "admin" || viewRole === "encargado";

  const paymentPhase = getPaymentPhase(data.forcePaymentWindow);
  const isDataWindowOpen = paymentPhase.isDataWindowOpen;
  const isPayWindowOpen = paymentPhase.isPayWindowOpen;
  const isSundayAssign = paymentPhase.isSundayAssign;
  /** Compat con UI antigua: “ventana abierta” = datos (jueves). */
  const isPaymentWindowOpen = isDataWindowOpen;

  const setForcePaymentWindow = useCallback(
    (v: boolean) => {
      if (user?.role !== "admin") return;
      let snapshot = { forcePaymentWindow: v, currentWeekStart: WEEK_START, weekNumber: WEEK_NUMBER };
      persist((prev) => {
        snapshot = {
          forcePaymentWindow: v,
          currentWeekStart: prev.currentWeekStart || WEEK_START,
          weekNumber: prev.weekNumber ?? WEEK_NUMBER,
        };
        return withHistory(
          { ...prev, forcePaymentWindow: v },
          user,
          {
            module: "payments",
            type: "payment_window_forced",
            summary: v
              ? "Ventana de pago forzada (demo ON)"
              : "Ventana de pago forzada desactivada",
            meta: { forced: v },
          }
        );
      });
      cloudSafe("settings", () => pushAppSettings(snapshot), (prev) => ({
        ...prev,
        forcePaymentWindow: !v,
      }));
    },
    [persist, user, cloudSafe]
  );

  const addReportEntries: StoreCtx["addReportEntries"] = useCallback(
    async (items) => {
      const sessionUser = user;
      if (!sessionUser) return { ok: false, inserted: 0, error: "Sesión no válida" };
      if (!items.length) return { ok: true, inserted: 0 };

      const leadItems = items.filter((i) => i.type === "leads");
      const consentItems = await Promise.all(
        items
          .filter((i) => i.type === "consent")
          .map(async (i) => ({ ...i, contentHash: await consentContentHash(i.fileContent) }))
      );
      let skippedDuplicates = 0;
      const duplicateDetails: string[] = [];
      let consentAccepted: ConsentUploadFilterResult["accepted"] = [];

      if (consentItems.length) {
        const filtered = filterDuplicateConsentUploads(
          consentItems,
          dataRef.current.reportEntries,
          dataRef.current.leads
        );
        skippedDuplicates = filtered.skippedDuplicates.length;
        for (const d of filtered.skippedDuplicates) {
          duplicateDetails.push(
            `${d.fileName || d.personKey}: ${CONSENT_DUPLICATE_LABEL[d.reason]}${
              d.matchedName ? ` (${d.matchedName})` : ""
            }`
          );
        }
        consentAccepted = filtered.accepted;
      }

      const toInsert = [...leadItems, ...consentAccepted];
      if (!toInsert.length) {
        return {
          ok: true,
          inserted: 0,
          skippedDuplicates,
          duplicateDetails,
          markedRealizado: 0,
          syncNeedsAttention: 0,
          error:
            skippedDuplicates > 0
              ? `${skippedDuplicates} carta${skippedDuplicates === 1 ? "" : "s"} omitida${skippedDuplicates === 1 ? "" : "s"} (ya existían)`
              : undefined,
        };
      }

      const actor = { id: sessionUser.id, role: sessionUser.role };
      const draftEntries: ReportEntry[] = toInsert.map((input) => {
        const at = input.createdAt || new Date().toISOString();
        const day = input.reportDate || dayKeyFromIso(at) || todayKey();
        const safeDay = day === "sin-fecha" ? todayKey() : day;
        const personKey: string | undefined =
          input.type === "consent"
            ? ("personKey" in input && typeof input.personKey === "string"
                ? input.personKey
                : personKeyFromConsentInput(input)) || undefined
            : undefined;
        return {
          id: newEntityId("re"),
          targetId: input.targetId,
          type: input.type,
          title:
            input.type === "leads"
              ? `Leads Nuevos de ${input.names.length} Persona${input.names.length !== 1 ? "s" : ""}`
              : "CARTAS DE CONSENTIMIENTO",
          reportDate: safeDay,
          uploadedBy: sessionUser.id,
          agentName: sessionUser.fullName,
          fileName:
            input.fileName ||
            (input.type === "leads" ? `${safeDay} leads.txt` : `cartas cc ${safeDay.slice(5)}.txt`),
          fileContent: input.fileContent ?? input.names.join("\n"),
          names: input.names,
          createdAt: at,
          personKey,
          contentHash:
            "contentHash" in input && typeof input.contentHash === "string"
              ? input.contentHash
              : undefined,
        };
      });

      let markedRealizado = 0;
      let markedLeads: Lead[] = [];
      let syncCounts: ConsentSyncPlan["counts"] | undefined;
      let syncNeedsAttention = 0;
      let entries: ReportEntry[] = draftEntries;
      let touchedTasks: WeeklyTask[] = [];
      let tasksAutoCompleted = 0;

      const plan = planConsentLeadSync(
        draftEntries.filter((e) => e.type === "consent"),
        dataRef.current.leads,
        actor,
        dataRef.current.reportEntries
      );
      syncCounts = plan.counts;
      syncNeedsAttention =
        plan.counts.ambiguous + plan.counts.out_of_scope + plan.counts.unmatched;
      for (const e of draftEntries) {
        if (!plan.duplicateEntryIds.has(e.id)) continue;
        skippedDuplicates += 1;
        duplicateDetails.push(`${e.fileName || e.personKey}: ${CONSENT_DUPLICATE_LABEL.same_person}`);
      }
      entries = draftEntries
        .filter((e) => !plan.duplicateEntryIds.has(e.id))
        .map((e) => {
          if (e.type !== "consent") return e;
          const leadId = plan.linkedByEntryId.get(e.id);
          return leadId ? { ...e, linkedLeadId: leadId } : e;
        });

      persist((prev) => {
        if (!entries.length) return prev;
        const targetName =
          prev.reportTargets.find((t) => t.id === entries[0].targetId)?.name ||
          entries[0].targetId;
        const leadPeople = entries.every((e) => e.type === "leads")
          ? entries.reduce((sum, e) => sum + e.names.length, 0)
          : null;
        const uploadedLabel =
          leadPeople !== null
            ? `reporte de leads nuevos (${leadPeople} persona${leadPeople === 1 ? "" : "s"})`
            : `${entries.length} carta${entries.length === 1 ? "" : "s"}`;

        const markIds = new Set(plan.toMark.map((l) => l.id));
        markedRealizado = markIds.size;
        markedLeads = [];
        const leads = markIds.size
          ? prev.leads.map((l) => {
              if (!markIds.has(l.id)) return l;
              const nextLead = { ...l, status: "realizado" as const };
              markedLeads.push(nextLead);
              return nextLead;
            })
          : prev.leads;

        // Vista previa local: la base recalcula la meta (trigger) y el próximo pull la confirma.
        // El crédito es del agente asignado al lead, no de quien sube la carta.
        let nextTasks = prev.tasks;
        touchedTasks = [];
        tasksAutoCompleted = 0;
        const weekStart = prev.currentWeekStart || WEEK_START;
        const byAgentDay = new Map<string, { agentId: string; dueDate: string; count: number }>();
        for (const e of entries) {
          if (e.type !== "consent" || !e.linkedLeadId) continue;
          const agentId = prev.leads.find((l) => l.id === e.linkedLeadId)?.assignedAgentId;
          if (!agentId) continue;
          const dueDate = e.reportDate || weekStart;
          const key = `${agentId}|${dueDate}`;
          const row = byAgentDay.get(key) || { agentId, dueDate, count: 0 };
          row.count += 1;
          byAgentDay.set(key, row);
        }
        for (const { agentId, dueDate, count } of byAgentDay.values()) {
          const bumped = bumpConsentRealizadoGoals(nextTasks, {
            agentId,
            weekStart,
            dueDate,
            count,
            by: sessionUser.id,
          });
          nextTasks = bumped.tasks;
          touchedTasks.push(...bumped.touched);
          tasksAutoCompleted += bumped.autoCompleted;
        }

        let next: AppData = {
          ...prev,
          reportEntries: [...entries, ...prev.reportEntries],
          leads,
          tasks: nextTasks,
        };

        next = withHistory(next, sessionUser, {
          module: "reports",
          type: "report_uploaded",
          summary: `${sessionUser.fullName} (${sessionUser.role}) cargó ${uploadedLabel} → ${targetName}${
            markedRealizado
              ? ` · ${markedRealizado} lead${markedRealizado === 1 ? "" : "s"} → realizado`
              : ""
          }${
            touchedTasks.length
              ? ` · progreso tarea ${touchedTasks.map((t) => `${t.goalCurrent}/${t.goalTarget}`).join(", ")}`
              : ""
          }${
            tasksAutoCompleted
              ? ` · ${tasksAutoCompleted} tarea${tasksAutoCompleted === 1 ? "" : "s"} auto-completada${tasksAutoCompleted === 1 ? "" : "s"}`
              : ""
          }${
            syncNeedsAttention
              ? ` · ${syncNeedsAttention} requieren revisión`
              : ""
          }`,
          entityType: "report",
          meta: {
            targetId: entries[0].targetId,
            count: entries.length,
            reportType: entries[0].type,
            actorRole: sessionUser.role,
            markedRealizado,
            skippedDuplicates,
            syncNeedsAttention,
            syncAuto: plan.counts.auto,
            syncAmbiguous: plan.counts.ambiguous,
            syncUnmatched: plan.counts.unmatched,
            syncOutOfScope: plan.counts.out_of_scope,
            tasksProgressed: touchedTasks.length,
            tasksAutoCompleted,
          },
        });
        return next;
      });

      if (!entries.length) {
        return {
          ok: true,
          inserted: 0,
          skippedDuplicates,
          duplicateDetails,
          markedRealizado: 0,
          error: `${skippedDuplicates} carta${skippedDuplicates === 1 ? "" : "s"} omitida${skippedDuplicates === 1 ? "" : "s"} (ya existían)`,
        };
      }

      if (!isSupabaseEnabled) {
        return {
          ok: true,
          inserted: entries.length,
          skippedDuplicates,
          duplicateDetails,
          markedRealizado,
          tasksProgressed: touchedTasks.length,
          tasksAutoCompleted,
          syncCounts,
          syncNeedsAttention,
        };
      }

      markLocalWrite();
      try {
        await pushReportEntries(entries);
      } catch (err) {
        const failedIds = new Set(
          ((err as Error & { failedIds?: string[] }).failedIds || entries.map((e) => e.id))
        );
        persist((prev) => ({
          ...prev,
          reportEntries: prev.reportEntries.filter((e) => !failedIds.has(e.id)),
        }));
        const inserted = entries.length - failedIds.size;
        const msg = cloudErrorMessage(err);
        return {
          ok: false,
          inserted: Math.max(0, inserted),
          skippedDuplicates,
          duplicateDetails,
          markedRealizado: 0,
          syncCounts,
          syncNeedsAttention,
          error: msg,
        };
      }

      // Cartas ya en la nube: marcar leads con UPDATE (agentes no pueden upsert).
      if (markedLeads.length) {
        try {
          await updateLeadsRows(markedLeads);
        } catch (err) {
          console.error("[sync] marcar realizados tras cartas:", err);
          return {
            ok: true,
            inserted: entries.length,
            skippedDuplicates,
            duplicateDetails,
            markedRealizado: 0,
            syncCounts,
            syncNeedsAttention,
            error: `Cartas guardadas; no se pudo marcar leads: ${cloudErrorMessage(err)}`,
          };
        }
      }
      return {
        ok: true,
        inserted: entries.length,
        skippedDuplicates,
        duplicateDetails,
        markedRealizado,
        tasksProgressed: touchedTasks.length,
        tasksAutoCompleted,
        syncCounts,
        syncNeedsAttention,
      };
    },
    [user, persist, markLocalWrite]
  );

  const addReportEntry: StoreCtx["addReportEntry"] = useCallback(
    async (input) => {
      const batch = await addReportEntries([input]);
      if (!batch.ok) return { ok: false, error: batch.error };
      if (batch.inserted === 0 && (batch.skippedDuplicates || 0) > 0) {
        return { ok: false, error: "Esta carta ya existe para esa persona en el reporte" };
      }
      return { ok: true };
    },
    [addReportEntries]
  );

  const assertReportEditAllowed = useCallback(
    (entry: ReportEntry | undefined) => {
      const actor = user;
      if (!actor) return { ok: false as const, error: "Sesión no válida" };
      if (!entry) return { ok: false as const, error: "Reporte no encontrado" };
      const access = getReportManageAccess(entry, actor);
      if (!access.allowed) {
        if (actor.role === "admin") {
          return { ok: false as const, error: "No se pudo autorizar la acción" };
        }
        if (entry.uploadedBy !== actor.id && actor.role !== "encargado") {
          return {
            ok: false as const,
            error: "Solo puedes corregir o eliminar lo que tú cargaste",
          };
        }
        return {
          ok: false as const,
          error:
            actor.role === "encargado"
              ? "El plazo de 5 minutos del encargado para corregir o eliminar ya expiró"
              : "El plazo de 5 minutos para corregir o eliminar ya expiró",
        };
      }
      return { ok: true as const, entry, actor, access };
    },
    [user]
  );

  const updateReportEntry: StoreCtx["updateReportEntry"] = useCallback(
    async (id, { names, fileName, fileContent }) => {
      if (!names.length) return { ok: false, error: "Agrega al menos un nombre" };
      let resolvedContent = fileContent;
      if (resolvedContent === undefined && isSupabaseEnabled) {
        const current = dataRef.current.reportEntries.find((e) => e.id === id);
        if (current && !isPdfDataUrl(current.fileContent)) {
          const lower = (fileName || current.fileName || "").toLowerCase();
          if (lower.endsWith(".pdf") || current.type === "consent") {
            try {
              resolvedContent = await fetchReportEntryFileContent(id);
            } catch (err) {
              console.error("[sync] fetch report file:", err);
            }
          }
        } else if (isPdfDataUrl(current?.fileContent)) {
          resolvedContent = current?.fileContent;
        }
      }
      let result: { ok: boolean; error?: string } = { ok: false, error: "Reporte no encontrado" };
      let updatedEntry: ReportEntry | null = null;
      persist((prev) => {
        const entry = prev.reportEntries.find((e) => e.id === id);
        const check = assertReportEditAllowed(entry);
        if (!check.ok) {
          result = { ok: false, error: check.error };
          return prev;
        }
        const { entry: current, actor } = check;
        const targetName =
          prev.reportTargets.find((t) => t.id === current.targetId)?.name || current.targetId;
        const kind = current.type === "leads" ? "leads" : "cartas";
        const updated: ReportEntry = {
          ...current,
          names,
          title: buildReportTitle(current.type, names.length),
          fileName: fileName ?? current.fileName,
          fileContent:
            resolvedContent !== undefined
              ? resolvedContent
              : isPdfDataUrl(current.fileContent)
                ? current.fileContent
                : names.join("\n"),
        };
        updatedEntry = updated;
        result = { ok: true };
        return withHistory(
          {
            ...prev,
            reportEntries: prev.reportEntries.map((e) => (e.id === id ? updated : e)),
          },
          actor,
          {
            module: "reports",
            type: "report_updated",
            summary: `${actor.fullName} (${actor.role}) corrigió ${kind} (${names.length}) → ${targetName}`,
            entityType: "report",
            entityId: id,
            meta: {
              targetId: current.targetId,
              count: names.length,
              reportType: current.type,
              actorRole: actor.role,
              unlimited: check.access.unlimited,
            },
          }
        );
      });
      if (result.ok && isSupabaseEnabled && updatedEntry) {
        markLocalWrite();
        try {
          await updateReportEntryRow(updatedEntry);
        } catch (err) {
          const msg = cloudErrorMessage(err);
          return { ok: false, error: msg };
        }
      }
      return result;
    },
    [assertReportEditAllowed, persist, markLocalWrite]
  );

  const deleteReportEntry: StoreCtx["deleteReportEntry"] = useCallback(
    async (id) => {
      let result: { ok: boolean; error?: string } = { ok: false, error: "Reporte no encontrado" };
      let removed: ReportEntry | null = null;
      persist((prev) => {
        const entry = prev.reportEntries.find((e) => e.id === id);
        const check = assertReportEditAllowed(entry);
        if (!check.ok) {
          result = { ok: false, error: check.error };
          return prev;
        }
        const { entry: current, actor } = check;
        removed = current;
        const targetName =
          prev.reportTargets.find((t) => t.id === current.targetId)?.name || current.targetId;
        const kind = current.type === "leads" ? "leads" : "cartas";
        result = { ok: true };
        return withHistory(
          { ...prev, reportEntries: prev.reportEntries.filter((e) => e.id !== id) },
          actor,
          {
            module: "reports",
            type: "report_deleted",
            summary: `${actor.fullName} (${actor.role}) eliminó ${kind} → ${targetName}`,
            entityType: "report",
            entityId: id,
            meta: {
              targetId: current.targetId,
              reportType: current.type,
              actorRole: actor.role,
              unlimited: check.access.unlimited,
            },
          }
        );
      });
      if (result.ok && isSupabaseEnabled) {
        markLocalWrite();
        try {
          await deleteReportEntryRow(id);
        } catch (err) {
          if (removed !== null) {
            const restored: ReportEntry = removed;
            persist((prev) => ({
              ...prev,
              reportEntries: [restored, ...prev.reportEntries.filter((e) => e.id !== restored.id)],
            }));
          }
          const msg = err instanceof Error ? err.message : "Error al eliminar en la nube";
          return { ok: false, error: msg };
        }
      }
      return result;
    },
    [assertReportEditAllowed, persist, markLocalWrite]
  );

  const refreshReports: StoreCtx["refreshReports"] = useCallback(async () => {
    if (!isSupabaseEnabled) return;
    try {
      const entries = await pullReportEntries(dataRef.current.profiles);
      setData((prev) => ({ ...prev, reportEntries: entries }));
    } catch (err) {
      console.error("No se pudieron refrescar reportes:", err);
    }
  }, []);

  const assignReportTarget: StoreCtx["assignReportTarget"] = useCallback(
    (targetId, agentId) => {
      const actor = viewUser;
      if (!actor || !canAssignReports) {
        return { ok: false, error: "No tienes permiso para asignar reportes" };
      }
      const target = data.reportTargets.find((t) => t.id === targetId);
      if (!target) return { ok: false, error: "Nombre de reporte no encontrado" };

      if (agentId) {
        const assignee = data.profiles.find((p) => p.id === agentId);
        if (!assignee) return { ok: false, error: "Usuario no encontrado" };
        if (!canAssignReportToProfile(actor.role, assignee)) {
          return { ok: false, error: "No puedes asignar reportes a este usuario" };
        }
      }

      const assigneeName = agentId
        ? data.profiles.find((p) => p.id === agentId)?.fullName || agentId
        : null;

      persist((prev) =>
        withHistory(
          {
            ...prev,
            reportTargets: prev.reportTargets.map((t) =>
              t.id === targetId ? { ...t, assignedAgentId: agentId } : t
            ),
          },
          user || actor,
          {
            module: "reports",
            type: "report_assigned",
            summary: agentId
              ? `${actor.fullName} asignó «${target.name}» → ${assigneeName}`
              : `${actor.fullName} quitó la asignación de «${target.name}»`,
            entityType: "report_target",
            entityId: targetId,
            meta: { targetId, agentId, targetName: target.name },
          }
        )
      );
      cloudSafe(
        "report_target",
        () => upsertReportTargetRow({ ...target, assignedAgentId: agentId }),
        (prev) => ({
          ...prev,
          reportTargets: prev.reportTargets.map((t) => (t.id === targetId ? target : t)),
        })
      );
      return { ok: true };
    },
    [viewUser, canAssignReports, data.reportTargets, data.profiles, persist, user, cloudSafe]
  );

  const createReportTarget: StoreCtx["createReportTarget"] = useCallback(
    (name, assignedAgentId = null) => {
      const actor = viewUser;
      if (!actor || !canAssignReports) {
        return { ok: false, error: "No tienes permiso para crear nombres de reporte" };
      }
      const trimmed = name.trim();
      if (!trimmed) return { ok: false, error: "Escribe un nombre" };

      const baseSlug = slugifyReportName(trimmed);
      let slug = baseSlug;
      let n = 2;
      while (data.reportTargets.some((t) => t.slug === slug)) {
        slug = `${baseSlug}-${n++}`;
      }

      if (assignedAgentId) {
        const assignee = data.profiles.find((p) => p.id === assignedAgentId);
        if (!assignee) return { ok: false, error: "Usuario no encontrado" };
        if (!canAssignReportToProfile(actor.role, assignee)) {
          return { ok: false, error: "No puedes asignar a este usuario" };
        }
      }

      const target = {
        id: newEntityId("rt"),
        name: trimmed,
        slug,
        active: true,
        assignedAgentId: assignedAgentId || null,
      };

      const assigneeName = assignedAgentId
        ? data.profiles.find((p) => p.id === assignedAgentId)?.fullName
        : null;

      persist((prev) =>
        withHistory(
          { ...prev, reportTargets: [...prev.reportTargets, target] },
          user || actor,
          {
            module: "reports",
            type: "report_target_created",
            summary: assigneeName
              ? `${actor.fullName} creó «${trimmed}» → ${assigneeName}`
              : `${actor.fullName} creó el nombre de reporte «${trimmed}»`,
            entityType: "report_target",
            entityId: target.id,
            meta: { targetId: target.id, agentId: assignedAgentId, targetName: trimmed },
          }
        )
      );
      cloudSafe(
        "report_target",
        () => upsertReportTargetRow(target),
        (prev) => ({ ...prev, reportTargets: prev.reportTargets.filter((t) => t.id !== target.id) })
      );
      return { ok: true };
    },
    [viewUser, canAssignReports, data.reportTargets, data.profiles, persist, user, cloudSafe]
  );

  const addLeads: StoreCtx["addLeads"] = useCallback(
    async (items) => {
      const day = todayKey();
      const needed = items.filter(
        (l) => leadSortNumber({ leadNumber: 0, rawData: l.rawData, columnOrder: l.columnOrder }) <= 0
      ).length;
      let start =
        dataRef.current.leads
          .filter((l) => dayKeyFromIso(l.createdAt) === day)
          .reduce((m, l) => Math.max(m, l.leadNumber || 0), 0) + 1;
      if (isSupabaseEnabled && needed > 0) {
        start = await reserveLeadNumbers(day, needed);
      }
      // leadNumber = # del día (1…N). Si el Excel trae Number, se respeta ese orden.
      const baseMs = Date.now();
      const mapped: Lead[] = items.map((l, i) => {
        const fromExcel = leadSortNumber({
          leadNumber: 0,
          rawData: l.rawData,
          columnOrder: l.columnOrder,
        });
        return {
          ...l,
          leadNumber: fromExcel > 0 ? fromExcel : start + i,
          assignedAgentId: l.assignedAgentId || null,
          id: isSupabaseEnabled ? crypto.randomUUID() : uid("ld"),
          // Timestamps crecientes: el orden del archivo se conserva también por fecha.
          createdAt: new Date(baseMs + i).toISOString(),
        };
      });
      const assigneeId = mapped.find((l) => l.assignedAgentId)?.assignedAgentId || null;
      persist((prev) => {
        const agent = assigneeId ? prev.profiles.find((p) => p.id === assigneeId) : null;
        return withHistory({ ...prev, leads: [...mapped, ...prev.leads] }, user, {
          module: "leads",
          type: "leads_imported",
          summary: agent
            ? `Se importaron ${mapped.length} lead${mapped.length === 1 ? "" : "s"} → ${agent.fullName}`
            : `Se importaron ${mapped.length} lead${mapped.length === 1 ? "" : "s"} (sin asignar)`,
          entityType: "lead",
          meta: { count: mapped.length, agentId: assigneeId },
        });
      });
      if (isSupabaseEnabled) {
        markLocalWrite();
        await pushLeadsRows(mapped);
      }
      return mapped.length;
    },
    [persist, user, markLocalWrite]
  );

  const upsertLeads: StoreCtx["upsertLeads"] = useCallback(
    async (items) => {
      let inserted = 0;
      let updated = 0;
      const snapshotLeads = dataRef.current.leads;
      const byKey = new Map<string, string>();
      for (const lead of snapshotLeads) {
        const key = leadMatchKey(lead);
        if (key && !byKey.has(key)) byKey.set(key, lead.id);
      }

      let nextLeads = [...snapshotLeads];
      const fresh: Lead[] = [];
      const touched: Lead[] = [];

      const needed = items.filter((item) => {
        const key = leadMatchKey(item);
        if (key && byKey.has(key)) return false;
        return leadSortNumber({ leadNumber: 0, rawData: item.rawData, columnOrder: item.columnOrder }) <= 0;
      }).length;
      let start =
        snapshotLeads
          .filter((l) => dayKeyFromIso(l.createdAt) === todayKey())
          .reduce((m, l) => Math.max(m, l.leadNumber || 0), 0) + 1;
      if (isSupabaseEnabled && needed > 0) {
        start = await reserveLeadNumbers(todayKey(), needed);
      }
      // Nuevos: # del día actual. Existentes: conservan su # del día en que se crearon.
      let nextNumber = start;

      for (const item of items) {
        const key = leadMatchKey(item);
        const existingId = key ? byKey.get(key) : undefined;
        if (existingId) {
          let patched: Lead | null = null;
          nextLeads = nextLeads.map((l) => {
            if (l.id !== existingId) return l;
            patched = {
              ...l,
              firstName: item.firstName,
              lastName: item.lastName,
              phone: item.phone,
              email: item.email,
              city: item.city,
              source: item.source,
              assignedAgentId: item.assignedAgentId || l.assignedAgentId,
              // Un lead ya existente conserva el perfil del lote en que entró.
              reportTargetId: l.reportTargetId || item.reportTargetId || null,
              rawData: item.rawData,
              columnOrder: item.columnOrder,
              leadNumber:
                leadSortNumber({
                  leadNumber: 0,
                  rawData: item.rawData,
                  columnOrder: item.columnOrder,
                }) || l.leadNumber,
            };
            return patched;
          });
          if (patched) touched.push(patched);
          updated += 1;
        } else {
          const fromExcel = leadSortNumber({
            leadNumber: 0,
            rawData: item.rawData,
            columnOrder: item.columnOrder,
          });
          const lead: Lead = {
            ...item,
            leadNumber: fromExcel > 0 ? fromExcel : nextNumber++,
            assignedAgentId: item.assignedAgentId || null,
            id: isSupabaseEnabled ? crypto.randomUUID() : uid("ld"),
            createdAt: new Date().toISOString(),
          };
          if (fromExcel <= 0) {
            /* nextNumber already advanced */
          } else if (fromExcel >= nextNumber) {
            nextNumber = fromExcel + 1;
          }
          fresh.push(lead);
          touched.push(lead);
          if (key) byKey.set(key, lead.id);
          inserted += 1;
        }
      }

      persist((prev) =>
        withHistory(
          { ...prev, leads: [...fresh, ...nextLeads] },
          user,
          {
            module: "leads",
            type: "leads_imported",
            summary: `Excel: ${inserted} nuevos, ${updated} actualizados`,
            entityType: "lead",
            meta: { inserted, updated },
          }
        )
      );

      if (isSupabaseEnabled) {
        markLocalWrite();
        await pushLeadsRows(touched);
      }
      return { inserted, updated };
    },
    [persist, user, markLocalWrite]
  );

  const updateLead = useCallback(
    (id: string, patch: Partial<Lead>) => {
      let updated: Lead | null = null;
      const before = dataRef.current.leads.find((l) => l.id === id);
      persist((prev) => {
        const lead = prev.leads.find((l) => l.id === id);
        const name = lead ? `${lead.firstName} ${lead.lastName}` : id;
        const keys = Object.keys(patch).join(", ");
        const toRealizado = patch.status === "realizado" && lead?.status !== "realizado";
        return withHistory(
          {
            ...prev,
            leads: prev.leads.map((l) => {
              if (l.id !== id) return l;
              updated = { ...l, ...patch };
              return updated;
            }),
          },
          user,
          {
            module: "leads",
            type: "lead_updated",
            summary: toRealizado
              ? `${user?.fullName || "Usuario"} marcó como realizado: ${name}`
              : `Lead actualizado: ${name} (${keys})`,
            entityType: "lead",
            entityId: id,
            meta: toRealizado ? { status: "realizado" } : undefined,
          }
        );
      });
      if (updated) {
        cloudSafe("lead", () => updateLeadRow(updated!), (prev) => restoreLeads(prev, before ? [before] : []));
      }
    },
    [persist, user, cloudSafe]
  );

  const markLeadsRealizado: StoreCtx["markLeadsRealizado"] = useCallback(
    (leadIds) => {
      if (!leadIds.length) return 0;
      const idSet = new Set(leadIds);
      const touched: Lead[] = [];
      const statusBefore = new Map(
        dataRef.current.leads.filter((l) => idSet.has(l.id)).map((l) => [l.id, l.status])
      );
      persist((prev) => {
        let next: AppData = {
          ...prev,
          leads: prev.leads.map((l) => {
            if (!idSet.has(l.id) || l.status === "realizado") return l;
            const updated = { ...l, status: "realizado" as const };
            touched.push(updated);
            return updated;
          }),
        };
        for (const lead of touched) {
          const name = `${lead.firstName} ${lead.lastName}`.trim();
          next = withHistory(next, user, {
            module: "leads",
            type: "lead_updated",
            summary: `${user?.fullName || "Usuario"} marcó como realizado: ${name}`,
            entityType: "lead",
            entityId: lead.id,
            meta: { status: "realizado" },
          });
        }

        // Sin carta no hay progreso de meta: solo cuentan cartas vinculadas (trigger en la base).
        return next;
      });
      if (touched.length && isSupabaseEnabled) {
        cloudSafe(
          "leads_realizado",
          () => updateLeadsRows(touched),
          (prev) => ({
            ...prev,
            leads: prev.leads.map((l) => {
              const before = statusBefore.get(l.id);
              return before && touched.some((t) => t.id === l.id) ? { ...l, status: before } : l;
            }),
          })
        );
      }
      return touched.length;
    },
    [persist, user, cloudSafe]
  );

  const linkCartaToLead: StoreCtx["linkCartaToLead"] = useCallback(
    async (entryId, leadId) => {
      if (!user || !["admin", "encargado"].includes(user.role)) {
        return { ok: false, error: "Solo admin o encargado pueden vincular cartas" };
      }
      const snapshot = dataRef.current;
      const entry = snapshot.reportEntries.find((e) => e.id === entryId && e.type === "consent");
      const lead = snapshot.leads.find((l) => l.id === leadId);
      if (!entry || !lead) return { ok: false, error: "Carta o lead no encontrado" };
      const owner = snapshot.reportEntries.find(
        (e) => e.type === "consent" && e.linkedLeadId === leadId && e.id !== entryId
      );
      if (owner) return { ok: false, error: `El lead #${lead.leadNumber} ya tiene carta` };

      const previous = entry.linkedLeadId ?? null;
      const name = `${lead.firstName} ${lead.lastName}`.trim();
      persist((prev) =>
        withHistory(
          {
            ...prev,
            reportEntries: prev.reportEntries.map((e) =>
              e.id === entryId ? { ...e, linkedLeadId: leadId } : e
            ),
          },
          user,
          {
            module: "leads",
            type: "lead_updated",
            summary: `${user.fullName} vinculó la carta ${entry.fileName || entry.personKey || ""} a #${lead.leadNumber} ${name}`,
            entityType: "lead",
            entityId: leadId,
            meta: { entryId, linkedManually: "true" },
          }
        )
      );

      if (isSupabaseEnabled) {
        try {
          markLocalWrite();
          await patchReportEntryLinks([{ id: entryId, linkedLeadId: leadId }]);
        } catch (err) {
          persist((prev) => ({
            ...prev,
            reportEntries: prev.reportEntries.map((e) =>
              e.id === entryId ? { ...e, linkedLeadId: previous } : e
            ),
          }));
          return { ok: false, error: cloudErrorMessage(err) };
        }
      }

      if (lead.status !== "realizado") markLeadsRealizado([leadId]);
      return { ok: true };
    },
    [user, persist, markLeadsRealizado, markLocalWrite]
  );

  const assignLead = useCallback(
    (leadId: string, agentId: string | null) => {
      let updated: Lead | null = null;
      const before = dataRef.current.leads.find((l) => l.id === leadId);
      persist((prev) => {
        const lead = prev.leads.find((l) => l.id === leadId);
        const agent = agentId ? prev.profiles.find((p) => p.id === agentId) : null;
        const name = lead ? `${lead.firstName} ${lead.lastName}` : leadId;
        return withHistory(
          {
            ...prev,
            leads: prev.leads.map((l) => {
              if (l.id !== leadId) return l;
              updated = { ...l, assignedAgentId: agentId };
              return updated;
            }),
          },
          user,
          {
            module: "leads",
            type: "lead_assigned",
            summary: agent
              ? `Lead ${name} asignado a ${agent.fullName}`
              : `Lead ${name} sin asignar`,
            entityType: "lead",
            entityId: leadId,
            meta: { agentId },
          }
        );
      });
      if (updated) {
        cloudSafe(
          "lead_assign",
          () => updateLeadRow(updated!),
          (prev) => restoreLeads(prev, before ? [before] : [])
        );
      }
    },
    [persist, user, cloudSafe]
  );

  const assignLeads: StoreCtx["assignLeads"] = useCallback(
    (leadIds, agentId) => {
      if (!leadIds.length) return 0;
      const idSet = new Set(leadIds);
      const touched: Lead[] = [];
      const before = dataRef.current.leads.filter((l) => idSet.has(l.id));
      persist((prev) => {
        const agent = agentId ? prev.profiles.find((p) => p.id === agentId) : null;
        return withHistory(
          {
            ...prev,
            leads: prev.leads.map((l) => {
              if (!idSet.has(l.id)) return l;
              const next = { ...l, assignedAgentId: agentId };
              touched.push(next);
              return next;
            }),
          },
          user,
          {
            module: "leads",
            type: "lead_assigned",
            summary: agent
              ? `${leadIds.length} lead${leadIds.length === 1 ? "" : "s"} asignado${leadIds.length === 1 ? "" : "s"} a ${agent.fullName}`
              : `${leadIds.length} lead${leadIds.length === 1 ? "" : "s"} sin asignar`,
            entityType: "lead",
            meta: { agentId, count: leadIds.length },
          }
        );
      });
      if (touched.length) {
        cloudSafe("leads_assign", () => updateLeadsRows(touched), (prev) => restoreLeads(prev, before));
      }
      return leadIds.length;
    },
    [persist, user, cloudSafe]
  );

  const setLeadsReportTarget: StoreCtx["setLeadsReportTarget"] = useCallback(
    (leadIds, targetId) => {
      if (!user || !["admin", "encargado"].includes(user.role)) return 0;
      const idSet = new Set(leadIds);
      const before = dataRef.current.leads.filter(
        (l) => idSet.has(l.id) && (l.reportTargetId || null) !== targetId
      );
      if (!before.length) return 0;
      const ids = before.map((l) => l.id);
      const moved = new Set(ids);
      persist((prev) => {
        const target = targetId ? prev.reportTargets.find((t) => t.id === targetId) : null;
        const n = ids.length;
        return withHistory(
          {
            ...prev,
            leads: prev.leads.map((l) => (moved.has(l.id) ? { ...l, reportTargetId: targetId } : l)),
          },
          user,
          {
            module: "leads",
            type: "lead_updated",
            summary: `${user.fullName} movió ${n} lead${n === 1 ? "" : "s"} al perfil de reporte ${
              target ? `«${target.name}»` : "(sin perfil)"
            }`,
            entityType: "lead",
            entityId: n === 1 ? ids[0] : undefined,
            meta: { reportTargetId: targetId, count: n },
          }
        );
      });
      cloudSafe(
        "leads_report_target",
        () => updateLeadsReportTarget(ids, targetId),
        (prev) => restoreLeads(prev, before)
      );
      return ids.length;
    },
    [user, persist, cloudSafe]
  );

  const addTask: StoreCtx["addTask"] = useCallback(
    ({ title, description, assignedTo, dueDate, goalType = "none", goalTarget = 0 }) => {
      const actor = viewUser;
      if (!actor) return;
      // Semana = lunes de la fecha límite (evita mezclar semanas con weekStart viejo)
      const weekStart = mondayOfDate(dueDate) || data.currentWeekStart || WEEK_START;
      const safeTarget =
        goalType === "consent_realizado" ? Math.max(1, Math.floor(goalTarget || 0)) : 0;
      const task: WeeklyTask = {
        id: newEntityId("tk"),
        title,
        description,
        assignedTo,
        createdBy: actor.id,
        weekStart,
        dueDate,
        status: "pendiente",
        proofsValidated: false,
        progressNotes: [],
        goalType: goalType === "consent_realizado" ? "consent_realizado" : "none",
        goalTarget: safeTarget,
        goalCurrent: 0,
      };
      persist((prev) => {
        const assignee = prev.profiles.find((p) => p.id === assignedTo)?.fullName || assignedTo;
        return withHistory({ ...prev, tasks: [task, ...prev.tasks] }, user || actor, {
          module: "tasks",
          type: "task_created",
          summary: `Tarea «${title}» asignada a ${assignee}${
            task.goalType === "consent_realizado" ? ` · meta ${task.goalTarget} cartas→realizado` : ""
          }`,
          entityType: "task",
          entityId: task.id,
        });
      });
      cloudSafe("task_create", () => upsertTaskRow(task), (prev) => restoreTask(prev, undefined, task.id));
    },
    [viewUser, user, persist, cloudSafe, data.currentWeekStart]
  );

  const editTask: StoreCtx["editTask"] = useCallback(
    (id, { title, description, assignedTo, dueDate, goalType, goalTarget }) => {
      const actor = viewUser;
      if (!actor || !canAssignTasks) {
        return { ok: false, error: "Solo admin o encargado puede editar tareas" };
      }
      if (!title.trim() || !assignedTo || !dueDate) {
        return { ok: false, error: "Completa título, agente y fecha" };
      }
      const isGoal = goalType === "consent_realizado";
      const safeTarget = isGoal ? Math.max(1, Math.floor(goalTarget || 0)) : 0;

      let updated: WeeklyTask | null = null;
      let blocked: string | null = null;
      const original = dataRef.current.tasks.find((t) => t.id === id);
      persist((prev) => {
        const task = prev.tasks.find((t) => t.id === id);
        if (!task) {
          blocked = "Tarea no encontrada";
          return prev;
        }
        const next: WeeklyTask = {
          ...task,
          title: title.trim(),
          description,
          assignedTo,
          dueDate,
          weekStart: mondayOfDate(dueDate) || task.weekStart,
          goalType: isGoal ? "consent_realizado" : "none",
          goalTarget: safeTarget,
          goalCurrent: isGoal ? task.goalCurrent : 0,
        };
        updated = next;
        const assignee = prev.profiles.find((p) => p.id === assignedTo)?.fullName || assignedTo;
        return withHistory(
          { ...prev, tasks: prev.tasks.map((t) => (t.id === id ? next : t)) },
          user || actor,
          {
            module: "tasks",
            type: "task_edited",
            summary: `Tarea «${next.title}» editada · ${assignee} · vence ${dueDate}${
              isGoal ? ` · meta ${safeTarget}` : ""
            }`,
            entityType: "task",
            entityId: id,
          }
        );
      });
      if (blocked) return { ok: false, error: blocked };
      if (updated) {
        cloudSafe("task_edit", () => upsertTaskRow(updated!), (prev) => restoreTask(prev, original));
      }
      return { ok: true };
    },
    [viewUser, user, persist, cloudSafe, canAssignTasks]
  );

  const deleteTask: StoreCtx["deleteTask"] = useCallback(
    async (id) => {
      const actor = viewUser;
      if (!actor || !canAssignTasks) {
        return { ok: false, error: "Solo admin o encargado puede eliminar tareas" };
      }
      const currentWeek = dataRef.current.currentWeekStart || WEEK_START;
      const today = todayKey();
      let removed: WeeklyTask | null = null;
      let blocked: string | null = null;
      persist((prev) => {
        const task = prev.tasks.find((t) => t.id === id);
        if (!task) {
          blocked = "Tarea no encontrada";
          return prev;
        }
        const week = taskEffectiveWeekStart(task);
        const overdue = !!task.dueDate && task.dueDate < today;
        const inPastWeek = week < currentWeek;
        if (!overdue && !inPastWeek) {
          blocked = "Solo se pueden eliminar tareas vencidas o de semanas anteriores";
          return prev;
        }
        if (task.status === "completada" && task.proofsValidated) {
          blocked = "No se puede eliminar una tarea completada y validada";
          return prev;
        }
        removed = task;
        const assignee = prev.profiles.find((p) => p.id === task.assignedTo)?.fullName || task.assignedTo;
        return withHistory(
          { ...prev, tasks: prev.tasks.filter((t) => t.id !== id) },
          user || actor,
          {
            module: "tasks",
            type: "task_deleted",
            summary: `${actor.fullName} eliminó la tarea «${task.title}» · ${assignee} · vence ${task.dueDate}`,
            entityType: "task",
            entityId: id,
          }
        );
      });
      if (blocked) return { ok: false, error: blocked };
      if (!removed) return { ok: false, error: "Tarea no encontrada" };
      if (isSupabaseEnabled) {
        markLocalWrite();
        try {
          await deleteTaskRow(id);
        } catch (err) {
          if (removed !== null) {
            const restored: WeeklyTask = removed;
            persist((prev) => ({
              ...prev,
              tasks: [restored, ...prev.tasks.filter((t) => t.id !== restored.id)],
            }));
          }
          return { ok: false, error: cloudErrorMessage(err) };
        }
      }
      return { ok: true };
    },
    [viewUser, user, persist, canAssignTasks, markLocalWrite]
  );

  const updateTaskStatus = useCallback(
    (id: string, status: TaskStatus) => {
      const actor = viewUser;
      if (!actor) return { ok: false, error: "Sesión no válida" };

      let updated: WeeklyTask | null = null;
      let blocked: string | null = null;
      const original = dataRef.current.tasks.find((t) => t.id === id);

      persist((prev) => {
        const task = prev.tasks.find((t) => t.id === id);
        if (!task) {
          blocked = "Tarea no encontrada";
          return prev;
        }

        const isOwner = task.assignedTo === actor.id;
        const staff = actor.role === "admin" || actor.role === "encargado" || actor.role === "nomina";

        if (task.proofsValidated && status !== "completada") {
          if (!staff) {
            blocked = "Tarea validada: solo admin/encargado puede reabrirla";
            return prev;
          }
        }

        if (!staff && status === "completada" && task.status !== "completada") {
          if (!isOwner) {
            blocked = "Solo puedes completar tus tareas";
            return prev;
          }
          if (!taskHasCompletionEvidence(task)) {
            blocked =
              task.goalType === "consent_realizado"
                ? `Falta progreso de meta (${task.goalCurrent}/${task.goalTarget}). Sube cartas con lead → realizado.`
                : "Registra al menos un avance antes de marcarla";
            return prev;
          }
        }

        if (!staff && status !== "completada" && task.status === "completada" && !task.proofsValidated) {
          blocked = "No puedes reabrir una tarea completada. Pide a un admin si hace falta.";
          return prev;
        }

        return withHistory(
          {
            ...prev,
            tasks: prev.tasks.map((t) => {
              if (t.id !== id) return t;
              updated = {
                ...t,
                status,
                proofsValidated: status === "completada" ? t.proofsValidated : false,
              };
              return updated;
            }),
          },
          user || actor,
          {
            module: "tasks",
            type: "task_status_changed",
            summary: `Tarea «${task.title}» → ${status}`,
            entityType: "task",
            entityId: id,
            meta: { status },
          }
        );
      });

      if (blocked) return { ok: false, error: blocked };
      if (updated) {
        cloudSafe("task_status", () => updateTaskRow(updated!), (prev) => restoreTask(prev, original));
      }
      return { ok: true };
    },
    [persist, user, viewUser, cloudSafe]
  );

  const addTaskProgress = useCallback(
    (taskId: string, notes: string, markDone = false) => {
      const actor = viewUser;
      if (!actor) return { ok: false, error: "Sesión no válida" };
      const trimmed = notes.trim();
      if (!trimmed) return { ok: false, error: "Escribe una nota" };

      const progressNote = { at: new Date().toISOString(), notes: trimmed, by: actor.id };
      let updated: WeeklyTask | null = null;
      let blocked: string | null = null;
      let autoCompleted = false;
      const original = dataRef.current.tasks.find((t) => t.id === taskId);

      persist((prev) => {
        const task = prev.tasks.find((t) => t.id === taskId);
        if (!task) {
          blocked = "Tarea no encontrada";
          return prev;
        }
        if (task.proofsValidated) {
          blocked = "Tarea validada: no se puede agregar avance";
          return prev;
        }
        const staff = actor.role === "admin" || actor.role === "encargado" || actor.role === "nomina";
        if (!staff && task.assignedTo !== actor.id) {
          blocked = "Solo puedes registrar avance en tus tareas";
          return prev;
        }
        if (
          markDone &&
          task.goalType === "consent_realizado" &&
          task.goalTarget > 0 &&
          task.goalCurrent < task.goalTarget
        ) {
          blocked = `Meta incompleta (${task.goalCurrent}/${task.goalTarget}): se cierra sola al llegar.`;
          return prev;
        }

        return withHistory(
          {
            ...prev,
            tasks: prev.tasks.map((t) => {
              if (t.id !== taskId) return t;
              const next: WeeklyTask = {
                ...t,
                status: markDone ? "completada" : t.status === "pendiente" ? "en_progreso" : t.status,
                progressNotes: [...t.progressNotes, progressNote],
              };
              if (t.status !== "completada" && next.status === "completada") autoCompleted = true;
              updated = next;
              return next;
            }),
          },
          user || actor,
          {
            module: "tasks",
            type: "task_progress_added",
            summary: `Progreso en «${task.title}»: ${trimmed.slice(0, 80)}${
              autoCompleted ? " · terminada" : ""
            }`,
            entityType: "task",
            entityId: taskId,
          }
        );
      });

      if (blocked) return { ok: false, error: blocked };
      if (updated) {
        cloudSafe(
          "task_progress",
          async () => {
            await insertTaskProgressNote(taskId, progressNote);
            await updateTaskRow(updated!);
          },
          (prev) => restoreTask(prev, original)
        );
      }
      return { ok: true, autoCompleted };
    },
    [viewUser, user, persist, cloudSafe]
  );

  const validateTaskProofs = useCallback(
    async (taskId: string, validated: boolean) => {
      const role = user?.role;
      if (role !== "admin" && role !== "encargado" && role !== "nomina") {
        return { ok: false, error: "Solo admin, encargado o nómina pueden validar pruebas" };
      }
      let updated: WeeklyTask | null = null;
      const original = dataRef.current.tasks.find((t) => t.id === taskId);
      persist((prev) => {
        const task = prev.tasks.find((t) => t.id === taskId);
        const agent = task
          ? prev.profiles.find((p) => p.id === task.assignedTo)?.fullName
          : undefined;
        return withHistory(
          {
            ...prev,
            tasks: prev.tasks.map((t) => {
              if (t.id !== taskId) return t;
              updated = { ...t, proofsValidated: validated };
              return updated;
            }),
          },
          user,
          {
            module: "tasks",
            type: "task_proofs_validated",
            summary: validated
              ? `Pruebas validadas: «${task?.title || taskId}»${agent ? ` (${agent})` : ""}`
              : `Validación retirada: «${task?.title || taskId}»`,
            entityType: "task",
            entityId: taskId,
            meta: { validated },
          }
        );
      });
      if (!updated) return { ok: false, error: "Tarea no encontrada" };
      return cloudAwait(() => updateTaskRow(updated!), (prev) => restoreTask(prev, original));
    },
    [persist, user, cloudAwait]
  );

  const getAgentStats = useCallback(
    (agentId: string) => {
      const leads = data.leads.filter((l) => l.assignedAgentId === agentId);
      const closed = leads.filter((l) => l.status === "cerrado").length;
      const weekStart = data.currentWeekStart || WEEK_START;
      const tasks = tasksInWeek(
        data.tasks.filter((t) => t.assignedTo === agentId),
        weekStart
      );
      const gates = evaluateAgentWeekTasks(tasks);
      const progress = gates.tasksTotal
        ? Math.round((gates.tasksDone / gates.tasksTotal) * 100)
        : 0;
      const proofsOk = gates.fullWeekOk;
      return {
        leads: leads.length,
        closed,
        tasksTotal: gates.tasksTotal,
        tasksDone: gates.tasksDone,
        progress,
        proofsOk,
        paymentEligible: gates.paymentEligible,
        dataEligible: gates.dataEligible,
        thruThursdayOk: gates.thruThursdayOk,
        fullWeekOk: gates.fullWeekOk,
        thruThursdayDone: gates.thruThursdayDone,
        thruThursdayTotal: gates.thruThursdayTotal,
        fridayDone: gates.fridayDone,
        fridayTotal: gates.fridayTotal,
      };
    },
    [data]
  );

  const getOrCreatePayment = useCallback(
    (agentId: string): WeeklyPayment => {
      const weekStart = data.currentWeekStart || WEEK_START;
      const existing = data.payments.find((p) => p.agentId === agentId && p.weekStart === weekStart);
      if (existing) return existing;
      const created: WeeklyPayment = {
        id: newEntityId("pay"),
        agentId,
        weekStart,
        status: "ready",
        zelleData: null,
      };
      return created;
    },
    [data.payments, data.currentWeekStart]
  );

  const getAgentPaymentHistory = useCallback(
    (agentId: string): WeeklyPayment[] => {
      return data.payments
        .filter((p) => p.agentId === agentId && p.status === "sent")
        .sort((a, b) => (b.paidAt || b.weekStart).localeCompare(a.paidAt || a.weekStart));
    },
    [data.payments]
  );

  const canAdvanceWeek =
    user?.role === "admin" &&
    (data.currentWeekStart || WEEK_START) < operativeWeekStartFor();

  const advanceWeek = useCallback(() => {
    if (user?.role !== "admin") return { ok: false, error: "Solo admin puede iniciar una semana" };
    const current = dataRef.current.currentWeekStart || WEEK_START;
    if (current >= operativeWeekStartFor()) {
      return { ok: false, error: "La semana ya está al día con el calendario" };
    }
    let snapshot = {
      forcePaymentWindow: false,
      currentWeekStart: WEEK_START,
      weekNumber: WEEK_NUMBER,
    };
    persist((prev) => {
      const base = new Date(`${prev.currentWeekStart || WEEK_START}T12:00:00`);
      base.setDate(base.getDate() + 7);
      const nextStart = base.toISOString().slice(0, 10);
      const nextNumber = (prev.weekNumber ?? WEEK_NUMBER) + 1;
      snapshot = {
        forcePaymentWindow: false,
        currentWeekStart: nextStart,
        weekNumber: nextNumber,
      };
      return withHistory(
        {
          ...prev,
          currentWeekStart: nextStart,
          weekNumber: nextNumber,
          forcePaymentWindow: false,
        },
        user,
        {
          module: "system",
          type: "week_advanced",
          summary: `Nueva semana operativa · Semana ${nextNumber}`,
          meta: { weekStart: nextStart },
        }
      );
    });
    cloudSafe("advance_week", () => pushAppSettings(snapshot));
    return { ok: true };
  }, [persist, user, cloudSafe]);

  /** Guarda el pago de la semana (UPDATE si existe, INSERT si es nuevo) y espera a la nube. */
  const upsertPayment = useCallback(
    async (
      agentId: string,
      patch: Partial<WeeklyPayment> | ((p: WeeklyPayment) => WeeklyPayment)
    ): Promise<{ ok: boolean; error?: string }> => {
      const weekStart = dataRef.current.currentWeekStart || WEEK_START;
      const original = dataRef.current.payments.find(
        (p) => p.agentId === agentId && p.weekStart === weekStart
      );
      let nextPayment: WeeklyPayment | null = null;
      persist((prev) => {
        const idx = prev.payments.findIndex((p) => p.agentId === agentId && p.weekStart === weekStart);
        const base: WeeklyPayment =
          idx >= 0
            ? prev.payments[idx]
            : {
                id: newEntityId("pay"),
                agentId,
                weekStart,
                status: "ready",
                zelleData: null,
              };
        nextPayment = typeof patch === "function" ? patch(base) : { ...base, ...patch };
        const payments =
          idx >= 0
            ? prev.payments.map((p, i) => (i === idx ? nextPayment! : p))
            : [nextPayment, ...prev.payments];
        return { ...prev, payments };
      });
      if (!nextPayment) return { ok: false, error: "No se pudo preparar el pago" };
      const saved: WeeklyPayment = nextPayment;
      return cloudAwait(
        () => (original ? updatePaymentRow(saved) : upsertPaymentRow(saved)),
        (prev) => ({
          ...prev,
          payments: original
            ? prev.payments.map((p) => (p.id === saved.id ? original : p))
            : prev.payments.filter((p) => p.id !== saved.id),
        })
      );
    },
    [persist, cloudAwait]
  );

  const requestPaymentData = useCallback(
    async (agentId: string) => {
      const actor = viewUser;
      if (!actor) return { ok: false, error: "Sesión no válida" };
      const phase = getPaymentPhase(dataRef.current.forcePaymentWindow);
      if (!phase.isDataWindowOpen) {
        return { ok: false, error: "La ventana de datos (jueves noche) no está abierta" };
      }
      const weekStart = dataRef.current.currentWeekStart || WEEK_START;
      const tasks = tasksInWeek(
        dataRef.current.tasks.filter((t) => t.assignedTo === agentId),
        weekStart
      );
      if (!evaluateAgentWeekTasks(tasks).thruThursdayOk) {
        return { ok: false, error: "El agente no tiene validadas sus tareas hasta el jueves" };
      }
      const res = await upsertPayment(agentId, (p) => ({
        ...p,
        status: "awaiting_data",
        dataRequestedAt: new Date().toISOString(),
        dataRequestedBy: actor.id,
      }));
      if (!res.ok) return res;
      persist((prev) => {
        const agent = prev.profiles.find((p) => p.id === agentId)?.fullName || agentId;
        return withHistory(prev, user || actor, {
          module: "payments",
          type: "payment_data_requested",
          summary: `Datos Zelle solicitados a ${agent}`,
          entityType: "payment",
          entityId: agentId,
        });
      });
      return { ok: true };
    },
    [viewUser, user, upsertPayment, persist]
  );

  const submitZelleData = useCallback(
    async (agentId: string, input: Omit<ZellePaymentData, "method" | "submittedAt">) => {
      if (!input.holder.trim() || !input.zelleEmailOrPhone.trim()) {
        return { ok: false, error: "Completa titular y correo/teléfono Zelle" };
      }
      const zelleData: ZellePaymentData = {
        method: PAYMENT_METHOD,
        holder: input.holder.trim(),
        zelleEmailOrPhone: input.zelleEmailOrPhone.trim(),
        contact: input.contact,
        notes: input.notes,
        submittedAt: new Date().toISOString(),
      };
      const res = await upsertPayment(agentId, (p) => ({
        ...p,
        status: "data_received",
        zelleData,
      }));
      if (!res.ok) return res;
      persist((prev) => {
        const agent = prev.profiles.find((p) => p.id === agentId)?.fullName || agentId;
        return withHistory(prev, user, {
          module: "payments",
          type: "zelle_submitted",
          summary: `${agent} envió datos Zelle (${zelleData.holder})`,
          entityType: "payment",
          entityId: agentId,
        });
      });
      return { ok: true };
    },
    [upsertPayment, persist, user]
  );

  const markPaymentSent = useCallback(
    async (agentId: string, input: { receipt: File | null; paidAmount: number; paidByName: string }) => {
      const actor = viewUser;
      if (!actor) return { ok: false, error: "Sesión no válida" };
      if (actor.role !== "admin" && actor.role !== "encargado" && actor.role !== "nomina") {
        return { ok: false, error: "Solo nómina, encargado o admin registran pagos" };
      }
      const phase = getPaymentPhase(dataRef.current.forcePaymentWindow);
      if (!phase.isPayWindowOpen) {
        return { ok: false, error: "La ventana de pago (viernes) no está abierta" };
      }
      const weekStart = dataRef.current.currentWeekStart || WEEK_START;
      const tasks = tasksInWeek(
        dataRef.current.tasks.filter((t) => t.assignedTo === agentId),
        weekStart
      );
      if (!evaluateAgentWeekTasks(tasks).fullWeekOk) {
        return { ok: false, error: "El agente no tiene la semana completa validada" };
      }
      const amount = Math.round(input.paidAmount * 100) / 100;
      if (!Number.isFinite(amount) || amount <= 0) {
        return { ok: false, error: "Monto inválido" };
      }
      if (!input.paidByName.trim()) return { ok: false, error: "Indica quién pagó" };

      let screenshotPath: string | undefined;
      let screenshotName: string | undefined;
      if (input.receipt) {
        const file = input.receipt;
        if (!RECEIPT_TYPES.includes(file.type)) {
          return { ok: false, error: "Comprobante: solo imagen (PNG/JPG/WEBP/GIF) o PDF" };
        }
        if (file.size > RECEIPT_MAX_BYTES) {
          return { ok: false, error: "Comprobante: máximo 5 MB" };
        }
        screenshotName = file.name;
        if (isSupabaseEnabled) {
          try {
            screenshotPath = await uploadPaymentReceipt(agentId, weekStart, file);
          } catch (err) {
            return { ok: false, error: `No se subió el comprobante: ${cloudErrorMessage(err)}` };
          }
        }
      } else if (isSupabaseEnabled) {
        return { ok: false, error: "Adjunta el comprobante del pago" };
      }

      const res = await upsertPayment(agentId, (p) => ({
        ...p,
        status: "sent",
        screenshotName: screenshotName ?? p.screenshotName,
        screenshotPath: screenshotPath ?? p.screenshotPath,
        paidAmount: amount,
        paidByName: input.paidByName.trim(),
        paidAt: new Date().toISOString(),
        paidByUserId: actor.id,
      }));
      if (!res.ok) return res;
      persist((prev) => {
        const agent = prev.profiles.find((p) => p.id === agentId)?.fullName || agentId;
        return withHistory(prev, user || actor, {
          module: "payments",
          type: "payment_sent",
          summary: `Pago enviado a ${agent}: ${formatUsd(amount)} (Zelle)`,
          entityType: "payment",
          entityId: agentId,
          meta: { amount },
        });
      });
      return { ok: true };
    },
    [viewUser, user, upsertPayment, persist]
  );

  const getReceiptUrl = useCallback(async (payment: WeeklyPayment) => {
    if (!isSupabaseEnabled || !payment.screenshotPath) return null;
    return signedReceiptUrl(payment.screenshotPath);
  }, []);

  const createUser = useCallback(
    async (input: {
      fullName: string;
      username: string;
      role: Role;
      password: string;
      phone?: string;
      email?: string;
    }) => {
      if (!user || user.role !== "admin") return { ok: false, error: "Solo admin" };
      const username = normalizeUsername(input.username);
      const contactEmail = input.email?.trim().toLowerCase() || "";
      if (!input.fullName.trim() || !username || !input.password) {
        return { ok: false, error: "Completa nombre, usuario y contraseña" };
      }
      if (input.password.length < MIN_PASSWORD_LENGTH) {
        return { ok: false, error: `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres` };
      }
      if (!isValidUsername(username)) {
        return { ok: false, error: "Usuario inválido (3-32 caracteres, letras/números)" };
      }
      if (dataRef.current.profiles.some((p) => normalizeUsername(p.username) === username)) {
        return { ok: false, error: "Ese usuario ya existe" };
      }

      if (isSupabaseEnabled) {
        let newId: string;
        try {
          ({ id: newId } = await adminCreateUser({
            fullName: input.fullName.trim(),
            username,
            email: authEmailForUsername(username),
            contactEmail: contactEmail || null,
            role: input.role,
            password: input.password,
            phone: input.phone?.trim() || null,
          }));
        } catch (err) {
          return { ok: false, error: cloudErrorMessage(err) };
        }
        const profile: Profile = {
          id: newId,
          fullName: input.fullName.trim(),
          username,
          email: contactEmail,
          role: input.role,
          phone: input.phone?.trim(),
          status: "activo",
          password: "",
        };
        persist((prev) =>
          withHistory({ ...prev, profiles: [...prev.profiles, profile] }, user, {
            module: "users",
            type: "user_created",
            summary: `Usuario creado: ${profile.fullName} (@${profile.username})`,
            entityType: "user",
            entityId: profile.id,
          })
        );
        return { ok: true };
      }

      const profile: Profile = {
        id: uid("u"),
        fullName: input.fullName.trim(),
        username,
        email: contactEmail,
        role: input.role,
        phone: input.phone?.trim(),
        status: "activo",
        password: input.password,
        lastAccess: undefined,
      };
      persist((prev) =>
        withHistory({ ...prev, profiles: [...prev.profiles, profile] }, user, {
          module: "users",
          type: "user_created",
          summary: `Usuario creado: ${profile.fullName} (@${profile.username})`,
          entityType: "user",
          entityId: profile.id,
        })
      );
      return { ok: true };
    },
    [user, persist]
  );

  const updateUserRole = useCallback(
    (id: string, role: Role) => {
      if (!user || user.role !== "admin") return;
      if (id === user.id && role !== "admin") return;
      const previousRole = dataRef.current.profiles.find((p) => p.id === id)?.role;
      persist((prev) => {
        const target = prev.profiles.find((p) => p.id === id);
        return withHistory(
          {
            ...prev,
            profiles: prev.profiles.map((p) => (p.id === id ? { ...p, role } : p)),
          },
          user,
          {
            module: "users",
            type: "user_role_changed",
            summary: `Rol de ${target?.fullName || id}: ${target?.role || "?"} → ${role}`,
            entityType: "user",
            entityId: id,
            meta: { role },
          }
        );
      });
      cloudSafe(
        "user_role",
        () => updateProfileRow(id, { role }),
        (prev) =>
          previousRole
            ? { ...prev, profiles: prev.profiles.map((p) => (p.id === id ? { ...p, role: previousRole } : p)) }
            : prev
      );
    },
    [user, persist, cloudSafe]
  );

  const updateUserStatus = useCallback(
    (id: string, status: "activo" | "inactivo") => {
      if (!user || user.role !== "admin") return;
      if (id === user.id) return;
      const previousStatus = dataRef.current.profiles.find((p) => p.id === id)?.status;
      persist((prev) => {
        const target = prev.profiles.find((p) => p.id === id);
        return withHistory(
          {
            ...prev,
            profiles: prev.profiles.map((p) => (p.id === id ? { ...p, status } : p)),
          },
          user,
          {
            module: "users",
            type: "user_status_changed",
            summary: `${target?.fullName || id} marcado como ${status}`,
            entityType: "user",
            entityId: id,
            meta: { status },
          }
        );
      });
      cloudSafe(
        "user_status",
        () => updateProfileRow(id, { status }),
        (prev) =>
          previousStatus
            ? {
                ...prev,
                profiles: prev.profiles.map((p) => (p.id === id ? { ...p, status: previousStatus } : p)),
              }
            : prev
      );
    },
    [user, persist, cloudSafe]
  );

  const updateOwnAccount = useCallback(
    async (input: { fullName: string; phone?: string; password?: string }) => {
      if (!user) return { ok: false, error: "Sin sesión" };
      if (!input.fullName.trim()) return { ok: false, error: "Nombre requerido" };

      if (isSupabaseEnabled && input.password?.trim()) {
        const { error } = await getSupabase().auth.updateUser({
          password: input.password.trim(),
        });
        if (error) return { ok: false, error: error.message };
      }

      const fullName = input.fullName.trim();
      const phone = input.phone?.trim() || undefined;

      persist((prev) =>
        withHistory(
          {
            ...prev,
            profiles: prev.profiles.map((p) =>
              p.id === user.id
                ? {
                    ...p,
                    fullName,
                    phone: phone || p.phone,
                    password: input.password?.trim() ? input.password.trim() : p.password,
                  }
                : p
            ),
          },
          user,
          {
            module: "users",
            type: "account_updated",
            summary: `${user.fullName} actualizó su cuenta`,
            entityType: "user",
            entityId: user.id,
          }
        )
      );
      setUser((u) =>
        u
          ? {
              ...u,
              fullName,
              phone: phone || u.phone,
            }
          : u
      );
      if (isSupabaseEnabled) {
        markLocalWrite();
        try {
          await updateProfileRow(user.id, {
            full_name: fullName,
            phone: phone || null,
          });
        } catch (err) {
          console.error("[sync] account:", err);
          return { ok: false, error: "No se pudo guardar el perfil en la nube" };
        }
      }
      return { ok: true };
    },
    [user, persist, markLocalWrite]
  );

  const value: StoreCtx = {
    data,
    user,
    viewUser,
    viewRole,
    viewAs,
    previewAgentId,
    setViewAs,
    syncError,
    login,
    loginAs,
    logout,
    reset,
    agents,
    isStaff: !!isStaff,
    isPayroll: !!isPayroll,
    canAssignTasks: !!canAssignTasks,
    canAssignReports: !!canAssignReports,
    canManageUsers: !!canManageUsers,
    canDownloadReports: !!canDownloadReports,
    isAdmin: !!isAdmin,
    currentWeekStart: data.currentWeekStart || WEEK_START,
    weekNumber: data.weekNumber ?? WEEK_NUMBER,
    isPaymentWindowOpen,
    isDataWindowOpen,
    isPayWindowOpen,
    isSundayAssign,
    setForcePaymentWindow,
    addReportEntry,
    addReportEntries,
    updateReportEntry,
    deleteReportEntry,
    refreshReports,
    assignReportTarget,
    createReportTarget,
    addLeads,
    upsertLeads,
    updateLead,
    markLeadsRealizado,
    linkCartaToLead,
    assignLead,
    assignLeads,
    setLeadsReportTarget,
    addTask,
    editTask,
    deleteTask,
    updateTaskStatus,
    addTaskProgress,
    validateTaskProofs,
    getAgentStats,
    getOrCreatePayment,
    getAgentPaymentHistory,
    canAdvanceWeek,
    advanceWeek,
    defaultWeeklyAmount: data.defaultWeeklyAmount ?? DEFAULT_WEEKLY_AMOUNT,
    requestPaymentData,
    submitZelleData,
    markPaymentSent,
    getReceiptUrl,
    createUser,
    updateUserRole,
    updateUserStatus,
    updateOwnAccount,
    syncHealth,
    ready,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useStore outside provider");
  return ctx;
}

export function leadStatusLabel(s: LeadStatus) {
  const m: Record<LeadStatus, string> = {
    nuevo: "Nuevo",
    contactado: "Contactado",
    cotizado: "Cotizado",
    cerrado: "Cerrado",
    perdido: "Perdido",
    realizado: "Realizado",
  };
  return m[s];
}

export function formatDate(iso: string) {
  if (!iso) return "—";
  const d = iso.slice(0, 10);
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
}

export function formatTime(iso: string) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("es-VE", { hour: "2-digit", minute: "2-digit", hour12: false });
}
