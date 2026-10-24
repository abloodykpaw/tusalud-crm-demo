export type Role = "admin" | "encargado" | "nomina" | "agente";
export type LeadStatus =
  | "nuevo"
  | "contactado"
  | "cotizado"
  | "cerrado"
  | "perdido"
  | "realizado";
export type TaskStatus = "pendiente" | "en_progreso" | "completada";

/** Meta automática de una tarea semanal. */
export type TaskGoalType = "none" | "consent_realizado";
export type ReportType = "leads" | "consent";
export type PaymentStatus = "ready" | "awaiting_data" | "data_received" | "sent";
export type ViewId =
  | "dashboard"
  | "reportes"
  | "reporte-detalle"
  | "leads"
  | "acciones"
  | "agentes"
  | "agente-detalle"
  | "tareas"
  | "pagos"
  | "usuarios"
  | "importar"
  | "historial";

export type HistoryModule =
  | "leads"
  | "tasks"
  | "reports"
  | "payments"
  | "users"
  | "auth"
  | "system";

export type HistoryEventType =
  | "login"
  | "logout"
  | "leads_imported"
  | "lead_updated"
  | "lead_assigned"
  | "task_created"
  | "task_edited"
  | "task_status_changed"
  | "task_progress_added"
  | "task_proofs_validated"
  | "task_deleted"
  | "report_uploaded"
  | "report_updated"
  | "report_deleted"
  | "report_assigned"
  | "report_target_created"
  | "payment_data_requested"
  | "zelle_submitted"
  | "payment_sent"
  | "payment_window_forced"
  | "user_created"
  | "user_role_changed"
  | "user_status_changed"
  | "account_updated"
  | "week_advanced"
  | "data_reset";

export type HistoryEvent = {
  id: string;
  at: string;
  actorId: string;
  actorName: string;
  actorRole: Role;
  module: HistoryModule;
  type: HistoryEventType;
  summary: string;
  entityType?: "user" | "lead" | "task" | "payment" | "report" | "report_target" | "session";
  entityId?: string;
  meta?: Record<string, string | number | boolean | null>;
};

export type Profile = {
  id: string;
  fullName: string;
  username: string;
  email: string;
  role: Role;
  phone?: string;
  status: "activo" | "inactivo";
  password: string;
  lastAccess?: string;
};

export type ReportTarget = {
  id: string;
  name: string;
  slug: string;
  active: boolean;
  assignedAgentId?: string | null;
};

export type ReportEntry = {
  id: string;
  targetId: string;
  type: ReportType;
  title: string;
  reportDate: string;
  uploadedBy: string;
  agentName: string;
  fileName?: string;
  fileContent?: string;
  names: string[];
  createdAt: string;
  /** Nombre normalizado de persona (cartas consent). */
  personKey?: string;
  /** Lead vinculado al subir la carta. */
  linkedLeadId?: string | null;
  /** SHA-256 del PDF (cartas consent); anti-duplicado por archivo. */
  contentHash?: string;
};

export type Lead = {
  id: string;
  /** Número del día (#1…N en la carpeta del día, hora Caracas). */
  leadNumber: number;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  city: string;
  source: string;
  status: LeadStatus;
  assignedAgentId: string | null;
  /** Perfil de reporte del lote importado (Cynthia, Valeria…). */
  reportTargetId?: string | null;
  notes: string;
  /** Columnas originales del Excel (header → valor). */
  rawData?: Record<string, string>;
  /** Orden de columnas del archivo importado. */
  columnOrder?: string[];
  createdAt: string;
};

export type WeeklyTask = {
  id: string;
  title: string;
  description: string;
  assignedTo: string;
  createdBy: string;
  weekStart: string;
  dueDate: string;
  status: TaskStatus;
  proofsValidated: boolean;
  progressNotes: { at: string; notes: string; by: string }[];
  /** none = solo manual / frase; consent_realizado = +1 por carta→realizado */
  goalType: TaskGoalType;
  goalTarget: number;
  goalCurrent: number;
};

/** Único método de pago soportado por ahora */
export const PAYMENT_METHOD = "Zelle" as const;

export type ZellePaymentData = {
  method: typeof PAYMENT_METHOD;
  holder: string;
  zelleEmailOrPhone: string;
  contact: string;
  notes?: string;
  submittedAt: string;
};

export type WeeklyPayment = {
  id: string;
  agentId: string;
  weekStart: string;
  status: PaymentStatus;
  zelleData: ZellePaymentData | null;
  dataRequestedAt?: string;
  dataRequestedBy?: string;
  screenshotName?: string;
  /** Ruta del comprobante en Storage (bucket payment-receipts). */
  screenshotPath?: string;
  /** Monto en USD. */
  paidAmount?: number;
  paidByName?: string;
  paidAt?: string;
  paidByUserId?: string;
};

export type AppData = {
  profiles: Profile[];
  reportTargets: ReportTarget[];
  reportEntries: ReportEntry[];
  leads: Lead[];
  tasks: WeeklyTask[];
  payments: WeeklyPayment[];
  historyEvents: HistoryEvent[];
  /** Demo: fuerza ventanas de datos (jueves) y pago (viernes) */
  forcePaymentWindow: boolean;
  /** Semana operativa actual (lunes de la semana lun–vie) */
  currentWeekStart: string;
  weekNumber: number;
  /** Monto semanal sugerido (app_settings.default_weekly_amount). */
  defaultWeeklyAmount?: number;
};

export type SessionUser = Omit<Profile, "password">;
