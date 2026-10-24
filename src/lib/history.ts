import type { HistoryEvent, HistoryEventType, HistoryModule, Role } from "./types";

export const HISTORY_MAX = 400;

export const HISTORY_MODULE_LABELS: Record<HistoryModule, string> = {
  leads: "Leads",
  tasks: "Tareas",
  reports: "Reportes",
  payments: "Pagos",
  users: "Usuarios",
  auth: "Sesión",
  system: "Sistema",
};

/** Módulos visibles por rol (admin = todos) */
export function historyModulesForRole(role: Role): HistoryModule[] {
  if (role === "admin") {
    return ["payments", "tasks", "leads", "reports", "users", "auth", "system"];
  }
  if (role === "encargado") {
    // Operación: sin sesión/sistema ni gestión admin pura
    return ["leads", "tasks", "reports", "payments", "users"];
  }
  if (role === "nomina") {
    // Nómina: pagos + validación de pruebas (gate de pago)
    return ["payments", "tasks"];
  }
  return [];
}

export function canSeeHistoryEvent(role: Role, ev: HistoryEvent): boolean {
  if (role === "admin") return true;
  if (role === "encargado") {
    return ["leads", "tasks", "reports", "payments", "users"].includes(ev.module);
  }
  if (role === "nomina") {
    if (ev.module === "payments") return true;
    if (ev.module === "tasks" && ev.type === "task_proofs_validated") return true;
    return false;
  }
  return false;
}

export function historyTypeLabel(type: HistoryEventType): string {
  const map: Record<HistoryEventType, string> = {
    login: "Inicio de sesión",
    logout: "Cierre de sesión",
    leads_imported: "Importación de leads",
    lead_updated: "Lead actualizado",
    lead_assigned: "Lead asignado",
    task_created: "Tarea creada",
    task_edited: "Tarea editada",
    task_status_changed: "Estado de tarea",
    task_progress_added: "Progreso de tarea",
    task_proofs_validated: "Pruebas validadas",
    task_deleted: "Tarea eliminada",
    report_uploaded: "Reporte cargado",
    report_updated: "Reporte editado",
    report_deleted: "Reporte eliminado",
    report_assigned: "Reporte asignado",
    report_target_created: "Nombre de reporte creado",
    payment_data_requested: "Datos Zelle solicitados",
    zelle_submitted: "Datos Zelle enviados",
    payment_sent: "Pago marcado enviado",
    payment_window_forced: "Ventana de pago",
    user_created: "Usuario creado",
    user_role_changed: "Rol actualizado",
    user_status_changed: "Estado de usuario",
    account_updated: "Cuenta actualizada",
    week_advanced: "Nueva semana",
    data_reset: "Reset de datos",
  };
  return map[type] || type;
}

export function filterHistoryEvents(
  events: HistoryEvent[],
  role: Role,
  moduleFilter: HistoryModule | "all"
): HistoryEvent[] {
  return events.filter((ev) => {
    if (!canSeeHistoryEvent(role, ev)) return false;
    if (moduleFilter === "all") return true;
    return ev.module === moduleFilter;
  });
}
