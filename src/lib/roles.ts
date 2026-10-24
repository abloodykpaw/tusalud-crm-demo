import type { Role } from "./types";

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Administrador",
  encargado: "Encargado",
  nomina: "Nómina",
  agente: "Agente",
};

export const ROLE_MODULES: Record<Role, string[]> = {
  encargado: [
    "Dashboard de equipo",
    "Reportes",
    "Asignar nombres de reporte",
    "Leads + importar",
    "Agentes",
    "Tareas (asignar y validar)",
    "Pagos Zelle",
    "Historial de operación",
    "Equipo (solo lectura)",
  ],
  nomina: [
    "Dashboard",
    "Tareas (validar pruebas)",
    "Pagos Zelle (solicitar / registrar)",
    "Historial de pagos",
    "Agentes (consulta)",
    "Equipo (solo lectura)",
  ],
  admin: [
    "Dashboard global",
    "Reportes (todos los nombres)",
    "Asignar nombres de reporte",
    "Leads + importar Excel",
    "Agentes",
    "Tareas (asignar y validar)",
    "Pagos (solicitar Zelle y registrar)",
    "Historial completo",
    "Usuarios (crear y roles)",
  ],
  agente: [
    "Mi semana",
    "Cargar reportes",
    "Mis leads",
    "Mis tareas + progreso",
    "Mi pago (enviar Zelle si se pide)",
    "Mi perfil / Mi cuenta",
  ],
};
