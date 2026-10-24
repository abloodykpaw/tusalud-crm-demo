import { useEffect, useMemo, useRef, useState } from "react";
import type { Role, ViewId } from "@/lib/types";
import { useStore } from "@/lib/store";
import { isSupabaseEnabled } from "@/lib/supabase";
import { agentHasAssignedReports } from "@/lib/reportTargets";
import { collectRequiredActions } from "@/lib/requiredActions";
import { useTheme } from "@/lib/theme";
import { useI18n, type MsgKey } from "@/lib/i18n";
import { Icons } from "./Icons";
import { BrandLogo } from "./BrandLogo";

type NavItem = {
  id: ViewId;
  icon: keyof typeof Icons;
  labelKey: MsgKey;
  shortKey?: MsgKey;
  sectionKey?: MsgKey;
  staffOnly?: boolean;
};

const NAV: Record<string, NavItem[]> = {
  admin: [
    { id: "dashboard", icon: "home", labelKey: "nav.dashboard", shortKey: "nav.short.inicio", sectionKey: "nav.section.principal" },
    { id: "reportes", icon: "reports", labelKey: "nav.reportes" },
    { id: "leads", icon: "leads", labelKey: "nav.leads" },
    { id: "acciones", icon: "alert", labelKey: "nav.acciones", shortKey: "nav.short.acciones" },
    { id: "agentes", icon: "agents", labelKey: "nav.agentes", sectionKey: "nav.section.operacion" },
    { id: "tareas", icon: "tasks", labelKey: "nav.tareas" },
    { id: "pagos", icon: "pay", labelKey: "nav.pagos" },
    { id: "historial", icon: "history", labelKey: "nav.historial", sectionKey: "nav.section.admin" },
    { id: "usuarios", icon: "users", labelKey: "nav.usuarios" },
    { id: "importar", icon: "import", labelKey: "nav.importar", sectionKey: "nav.section.datos", staffOnly: true },
  ],
  encargado: [
    { id: "dashboard", icon: "home", labelKey: "nav.dashboard", shortKey: "nav.short.inicio", sectionKey: "nav.section.principal" },
    { id: "reportes", icon: "reports", labelKey: "nav.reportes" },
    { id: "leads", icon: "leads", labelKey: "nav.leads" },
    { id: "acciones", icon: "alert", labelKey: "nav.acciones", shortKey: "nav.short.acciones" },
    { id: "agentes", icon: "agents", labelKey: "nav.agentes", sectionKey: "nav.section.operacion" },
    { id: "tareas", icon: "tasks", labelKey: "nav.tareas" },
    { id: "pagos", icon: "pay", labelKey: "nav.pagos" },
    { id: "historial", icon: "history", labelKey: "nav.historial" },
    { id: "usuarios", icon: "users", labelKey: "nav.equipo" },
    { id: "importar", icon: "import", labelKey: "nav.importar", sectionKey: "nav.section.datos", staffOnly: true },
  ],
  nomina: [
    { id: "dashboard", icon: "home", labelKey: "nav.dashboard", shortKey: "nav.short.inicio", sectionKey: "nav.section.principal" },
    { id: "pagos", icon: "pay", labelKey: "nav.pagosSemanales", shortKey: "nav.short.pagos" },
    { id: "historial", icon: "history", labelKey: "nav.historialPagos", shortKey: "nav.short.historial" },
    { id: "tareas", icon: "tasks", labelKey: "nav.tareas", sectionKey: "nav.section.equipo" },
    { id: "agentes", icon: "agents", labelKey: "nav.agentes" },
    { id: "usuarios", icon: "users", labelKey: "nav.usuarios" },
  ],
  agente: [
    { id: "dashboard", icon: "home", labelKey: "nav.dashboard", shortKey: "nav.short.inicio", sectionKey: "nav.section.principal" },
    { id: "reportes", icon: "reports", labelKey: "nav.reportes" },
    { id: "leads", icon: "leads", labelKey: "nav.leads" },
    { id: "acciones", icon: "alert", labelKey: "nav.acciones", shortKey: "nav.short.acciones" },
    { id: "tareas", icon: "tasks", labelKey: "nav.tareas", sectionKey: "nav.section.operacion" },
    { id: "pagos", icon: "pay", labelKey: "nav.pagos" },
    { id: "agentes", icon: "agents", labelKey: "nav.perfil" },
    { id: "usuarios", icon: "users", labelKey: "nav.cuenta" },
  ],
};

const ROLE_KEYS: Record<Role, MsgKey> = {
  admin: "role.admin",
  encargado: "role.encargado",
  nomina: "role.nomina",
  agente: "role.agente",
};

const PREVIEW_ROLES: Role[] = ["admin", "encargado", "nomina", "agente"];

type Props = {
  view: ViewId;
  title: string;
  breadcrumb: string;
  onNavigate: (id: ViewId) => void;
  children: React.ReactNode;
};

export function AppShell({ view, title, breadcrumb, onNavigate, children }: Props) {
  const {
    user,
    viewUser,
    viewRole,
    viewAs,
    setViewAs,
    previewAgentId,
    agents,
    isAdmin,
    logout,
    reset,
    data,
    syncHealth,
  } = useStore();
  const { dark, toggleTheme } = useTheme();
  const { t, locale, toggleLocale } = useI18n();
  const [open, setOpen] = useState(false);
  const [scrollHint, setScrollHint] = useState({ left: false, right: false });
  const menuRef = useRef<HTMLDivElement>(null);
  const bottomNavRef = useRef<HTMLElement>(null);
  const activeBottomRef = useRef<HTMLButtonElement>(null);

  const accionesCount = useMemo(() => {
    if (!viewUser || viewUser.role === "nomina") return 0;
    return collectRequiredActions({
      leads: data.leads,
      reportEntries: data.reportEntries,
      reportTargets: data.reportTargets,
      tasks: data.tasks,
      syncHealth,
      scopeAgentId: viewUser.role === "agente" ? viewUser.id : null,
    }).length;
  }, [viewUser, data.leads, data.reportEntries, data.reportTargets, data.tasks, syncHealth]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const items = useMemo(() => {
    const base = viewRole ? NAV[viewRole] || NAV.agente : NAV.agente;
    if (viewRole === "agente" && viewUser) {
      const hasReports = agentHasAssignedReports(data.reportTargets, viewUser.id);
      if (!hasReports) return base.filter((item) => item.id !== "reportes");
    }
    return base;
  }, [viewRole, viewUser, data.reportTargets]);
  const activeNav =
    view === "reporte-detalle" ? "reportes" : view === "agente-detalle" ? "agentes" : view;

  useEffect(() => {
    const el = bottomNavRef.current;
    if (!el) return;

    function updateHints() {
      if (!el) return;
      const max = el.scrollWidth - el.clientWidth;
      setScrollHint({
        left: el.scrollLeft > 4,
        right: max > 4 && el.scrollLeft < max - 4,
      });
    }

    updateHints();
    el.addEventListener("scroll", updateHints, { passive: true });
    window.addEventListener("resize", updateHints);
    return () => {
      el.removeEventListener("scroll", updateHints);
      window.removeEventListener("resize", updateHints);
    };
  }, [viewRole, items.length]);

  useEffect(() => {
    activeBottomRef.current?.scrollIntoView({
      behavior: "smooth",
      inline: "center",
      block: "nearest",
    });
  }, [activeNav, viewRole]);

  const roleLabel = useMemo(
    () => (role: Role) => t(ROLE_KEYS[role]),
    [t]
  );

  if (!user || !viewUser || !viewRole) return null;

  const initials = viewUser.fullName
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const badgeRole = viewRole;
  const badgeClass = badgeRole === "nomina" ? "encargado" : badgeRole;

  function pickRole(role: Role) {
    setViewAs(role);
    setOpen(false);
    onNavigate("dashboard");
  }

  return (
    <div className="app active">
      <aside className={`sidebar${viewRole === "nomina" ? " sidebar-nomina" : ""}`}>
        <div className="sidebar-brand">
          <BrandLogo size="sm" className="sidebar-logo" />
        </div>
        <nav className="nav">
          {items.map((item, i) => {
            const prev = items[i - 1];
            const showSection = item.sectionKey && item.sectionKey !== prev?.sectionKey;
            const label = t(item.labelKey);
            return (
              <div key={item.id} className="nav-group">
                {showSection && item.sectionKey && (
                  <div className="nav-section-label">{t(item.sectionKey)}</div>
                )}
                <button
                  className={`nav-item${activeNav === item.id ? " active" : ""}`}
                  onClick={() => onNavigate(item.id)}
                >
                  {Icons[item.icon]}
                  {label}
                  {item.id === "acciones" && accionesCount > 0 && (
                    <span className="badge">{accionesCount}</span>
                  )}
                </button>
              </div>
            );
          })}
        </nav>
        <div className="sidebar-footer">
          <div className="sidebar-user-panel">
            <div className="user-card">
              <div className="avatar">{initials}</div>
              <div className="info">
                <div className="name">{viewUser.fullName}</div>
                <div className="role">
                  {roleLabel(viewRole)}
                  {viewAs ? " · preview" : ""}
                </div>
              </div>
            </div>
            <button type="button" className="logout-btn" onClick={logout} title={t("shell.logout")}>
              {Icons.logout}
              <span>{t("shell.logout")}</span>
            </button>
          </div>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div className="topbar-left">
            <h1>{title}</h1>
            <div className="breadcrumb">{breadcrumb}</div>
          </div>
          <div className="topbar-actions">
            {isAdmin ? (
              <div className="role-switcher" ref={menuRef}>
                <button
                  type="button"
                  className={`role-badge ${badgeClass} role-switcher-btn`}
                  onClick={() => setOpen((o) => !o)}
                  title={t("shell.changeRole")}
                >
                  {roleLabel(badgeRole)}
                  <span className="role-caret">▾</span>
                </button>
                {open && (
                  <div className="role-menu">
                    <div className="role-menu-title">{t("shell.viewAs")}</div>
                    {PREVIEW_ROLES.map((r) => (
                      <button
                        key={r}
                        type="button"
                        className={`role-menu-item${(viewAs ?? "admin") === r || (!viewAs && r === "admin") ? " active" : ""}`}
                        onClick={() => pickRole(r)}
                      >
                        <span>{roleLabel(r)}</span>
                        {((!viewAs && r === "admin") || viewAs === r) && <span className="role-check">✓</span>}
                      </button>
                    ))}
                    <div className="role-menu-hint">
                      {t("shell.realSession")}: {user.fullName} (admin)
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <span className={`role-badge ${badgeClass}`}>{roleLabel(badgeRole)}</span>
            )}
            <button
              type="button"
              className="pref-pill lang-pill lang-pill-sm"
              onClick={toggleLocale}
              title={locale === "es" ? t("login.lang.toEn") : t("login.lang.toEs")}
              aria-label={t("login.lang")}
            >
              <span className={locale === "es" ? "is-active" : ""}>ES</span>
              <span className="pref-sep">/</span>
              <span className={locale === "en" ? "is-active" : ""}>EN</span>
            </button>
            <button
              type="button"
              className={`pref-pill theme-pill${dark ? " is-dark" : ""}`}
              onClick={toggleTheme}
              title={t("shell.theme")}
              aria-label={t("shell.theme")}
            >
              <span className="theme-switch" aria-hidden="true">
                <span className="theme-knob">{dark ? Icons.moon : Icons.sun}</span>
              </span>
              <span className="theme-label">{dark ? t("shell.theme.dark") : t("shell.theme.light")}</span>
            </button>
            {!isSupabaseEnabled && (
              <button className="icon-btn desktop-only-btn" onClick={reset} title={t("shell.reset")}>
                ↺
              </button>
            )}
          </div>
          <button
            type="button"
            className="icon-btn logout-mobile-btn"
            onClick={logout}
            title={t("shell.logout")}
          >
            {Icons.logout}
          </button>
        </header>
        {isAdmin && viewAs && (
          <div className="preview-banner-bar">
            {t("shell.preview")} <strong>{roleLabel(viewAs)}</strong>
            {viewAs === "agente" && agents.length > 0 && (
              <>
                {" "}
                {t("shell.previewAgent")}{" "}
                <select
                  className="filter-select"
                  value={previewAgentId || viewUser.id}
                  onChange={(e) => setViewAs("agente", e.target.value)}
                  aria-label={t("shell.previewAgent")}
                >
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.fullName}
                    </option>
                  ))}
                </select>
              </>
            )}{" "}
            ·
            <button type="button" onClick={() => setViewAs(null)}>
              {t("shell.backAdmin")}
            </button>
          </div>
        )}
        <div className="content">{children}</div>
      </main>

      <div
        className={`bottom-nav-wrap${scrollHint.left ? " can-scroll-left" : ""}${scrollHint.right ? " can-scroll-right" : ""}`}
      >
        <nav
          ref={bottomNavRef}
          className="bottom-nav"
          aria-label={`${t("shell.nav")} ${roleLabel(viewRole)}`}
        >
          {items.map((item) => {
            const label = t(item.labelKey);
            const short = item.shortKey ? t(item.shortKey) : label.split(" ")[0];
            const active = activeNav === item.id;
            return (
              <button
                key={item.id}
                ref={active ? activeBottomRef : undefined}
                type="button"
                className={`bottom-nav-item${active ? " active" : ""}`}
                onClick={() => onNavigate(item.id)}
              >
                {Icons[item.icon]}
                {short}
                {item.id === "acciones" && accionesCount > 0 && (
                  <span className="badge">{accionesCount}</span>
                )}
              </button>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
