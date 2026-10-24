import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type Locale = "es" | "en";

const dict = {
  es: {
    "login.headline": "Centraliza tu operación de salud en un solo lugar",
    "login.lead":
      "Reportes por nombre, leads, agentes y tareas semanales — sin depender de Discord ni Excel sueltos.",
    "login.feature.reports": "Reportes: leads y cartas por nombre",
    "login.feature.import": "Importación de leads Excel",
    "login.feature.tasks": "Tareas semanales con progreso",
    "login.feature.mobile": "Acceso desde cualquier dispositivo",
    "login.mobileTagline": "CRM de operaciones · accesible en móvil",
    "login.welcome": "Bienvenido",
    "login.subtitle": "Ingresa con tu usuario y contraseña",
    "login.username": "Usuario",
    "login.email": "Correo electrónico",
    "login.password": "Contraseña",
    "login.submit": "Iniciar sesión",
    "login.remember": "Recordar en este sitio",
    "login.quickAccess": "Acceso rápido",
    "login.quickAccessHint": "solo ingresa tu contraseña",
    "login.notYou": "Usar otra cuenta",
    "login.error.credentials": "Credenciales incorrectas",
    "login.error.inactive": "Usuario inactivo",
    "login.error.generic": "Error",
    "login.theme": "Cambiar tema",
    "login.theme.light": "Modo claro",
    "login.theme.dark": "Modo oscuro",
    "login.lang": "Cambiar idioma",
    "login.lang.toEn": "English",
    "login.lang.toEs": "Español",

    "nav.dashboard": "Dashboard",
    "nav.reportes": "Reportes",
    "nav.leads": "Leads",
    "nav.acciones": "Acciones requeridas",
    "nav.agentes": "Agentes",
    "nav.tareas": "Tareas",
    "nav.pagos": "Pagos",
    "nav.historial": "Historial",
    "nav.historialPagos": "Historial de pagos",
    "nav.usuarios": "Usuarios",
    "nav.equipo": "Equipo",
    "nav.importar": "Importar",
    "nav.perfil": "Perfil",
    "nav.cuenta": "Cuenta",
    "nav.pagosSemanales": "Pagos semanales",
    "nav.short.inicio": "Inicio",
    "nav.short.acciones": "Acciones",
    "nav.short.pagos": "Pagos",
    "nav.short.historial": "Historial",
    "nav.section.principal": "Principal",
    "nav.section.operacion": "Operación",
    "nav.section.admin": "Admin",
    "nav.section.datos": "Datos",
    "nav.section.equipo": "Equipo",

    "role.admin": "Administrador",
    "role.encargado": "Encargado",
    "role.nomina": "Nómina",
    "role.agente": "Agente",

    "shell.logout": "Cerrar sesión",
    "shell.theme": "Tema",
    "shell.theme.light": "Claro",
    "shell.theme.dark": "Oscuro",
    "shell.reset": "Reset datos demo",
    "shell.viewAs": "Ver como",
    "shell.changeRole": "Cambiar vista por rol",
    "shell.realSession": "Sesión real",
    "shell.preview": "Vista previa como",
    "shell.previewAgent": "con datos de",
    "shell.backAdmin": "Volver a Admin",
    "shell.nav": "Navegación",
    "shell.account": "Mi cuenta",
    "shell.team": "Equipo",
    "shell.profile": "Perfil",
    "shell.reportDetail": "Detalle de reporte",
    "shell.agentProfile": "Perfil de agente",
  },
  en: {
    "login.headline": "Centralize your health operations in one place",
    "login.lead":
      "Reports by name, leads, agents, and weekly tasks — without relying on Discord or scattered spreadsheets.",
    "login.feature.reports": "Reports: leads and consent letters by name",
    "login.feature.import": "Excel leak import",
    "login.feature.tasks": "Weekly tasks with progress",
    "login.feature.mobile": "Access from any device",
    "login.mobileTagline": "Operations CRM · mobile-friendly",
    "login.welcome": "Welcome",
    "login.subtitle": "Sign in with your username and password",
    "login.username": "Username",
    "login.email": "Email",
    "login.password": "Password",
    "login.submit": "Sign in",
    "login.remember": "Remember on this site",
    "login.quickAccess": "Quick access",
    "login.quickAccessHint": "enter your password only",
    "login.notYou": "Use another account",
    "login.error.credentials": "Invalid credentials",
    "login.error.inactive": "Inactive user",
    "login.error.generic": "Error",
    "login.theme": "Toggle theme",
    "login.theme.light": "Light mode",
    "login.theme.dark": "Dark mode",
    "login.lang": "Switch language",
    "login.lang.toEn": "English",
    "login.lang.toEs": "Español",

    "nav.dashboard": "Dashboard",
    "nav.reportes": "Reports",
    "nav.leads": "Leads",
    "nav.acciones": "Required actions",
    "nav.agentes": "Agents",
    "nav.tareas": "Tasks",
    "nav.pagos": "Payments",
    "nav.historial": "History",
    "nav.historialPagos": "Payment history",
    "nav.usuarios": "Users",
    "nav.equipo": "Team",
    "nav.importar": "Import",
    "nav.perfil": "Profile",
    "nav.cuenta": "Account",
    "nav.pagosSemanales": "Weekly payments",
    "nav.short.inicio": "Home",
    "nav.short.acciones": "Actions",
    "nav.short.pagos": "Pay",
    "nav.short.historial": "History",
    "nav.section.principal": "Main",
    "nav.section.operacion": "Operations",
    "nav.section.admin": "Admin",
    "nav.section.datos": "Data",
    "nav.section.equipo": "Team",

    "role.admin": "Administrator",
    "role.encargado": "Manager",
    "role.nomina": "Payroll",
    "role.agente": "Agent",

    "shell.logout": "Sign out",
    "shell.theme": "Theme",
    "shell.theme.light": "Light",
    "shell.theme.dark": "Dark",
    "shell.reset": "Reset demo data",
    "shell.viewAs": "View as",
    "shell.changeRole": "Switch role view",
    "shell.realSession": "Real session",
    "shell.preview": "Preview as",
    "shell.previewAgent": "with data from",
    "shell.backAdmin": "Back to Admin",
    "shell.nav": "Navigation",
    "shell.account": "My account",
    "shell.team": "Team",
    "shell.profile": "Profile",
    "shell.reportDetail": "Report detail",
    "shell.agentProfile": "Agent profile",
  },
} as const;

export type MsgKey = keyof typeof dict.es;

type I18nCtx = {
  locale: Locale;
  t: (key: MsgKey) => string;
  setLocale: (l: Locale) => void;
  toggleLocale: () => void;
};

const I18nContext = createContext<I18nCtx | null>(null);
const STORAGE_KEY = "tusalud-locale";

function readStoredLocale(): Locale {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "en" || v === "es") return v;
  } catch {
    /* ignore */
  }
  return "es";
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => readStoredLocale());

  useEffect(() => {
    document.documentElement.lang = locale;
    try {
      localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      /* ignore */
    }
  }, [locale]);

  const value = useMemo<I18nCtx>(
    () => ({
      locale,
      setLocale: setLocaleState,
      toggleLocale: () => setLocaleState((l) => (l === "es" ? "en" : "es")),
      t: (key) => dict[locale][key] ?? dict.es[key] ?? key,
    }),
    [locale]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}

/** Map store Spanish errors to i18n keys */
export function loginErrorKey(error?: string): MsgKey {
  if (error === "Credenciales incorrectas") return "login.error.credentials";
  if (error === "Usuario inactivo") return "login.error.inactive";
  return "login.error.generic";
}
