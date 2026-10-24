import { useEffect, useState } from "react";
import type { ReportType, ViewId } from "@/lib/types";
import { useStore } from "@/lib/store";
import { agentHasAssignedReports } from "@/lib/reportTargets";
import { useI18n, type MsgKey } from "@/lib/i18n";
import { LoginScreen } from "@/components/LoginScreen";
import { AppShell } from "@/components/AppShell";
import { DashboardView } from "@/views/DashboardView";
import { ReportesView, ReporteDetalleView } from "@/views/ReportesView";
import { LeadsView, ImportView } from "@/views/LeadsView";
import { AgentesView, AgenteDetalleView } from "@/views/AgentesView";
import { TareasView } from "@/views/TareasView";
import { PagosView } from "@/views/PagosView";
import { UsuariosView } from "@/views/UsuariosView";
import { HistorialView } from "@/views/HistorialView";
import { AccionesRequeridasView } from "@/views/AccionesRequeridasView";

const TITLE_KEYS: Partial<Record<ViewId, MsgKey>> = {
  dashboard: "nav.dashboard",
  reportes: "nav.reportes",
  "reporte-detalle": "shell.reportDetail",
  leads: "nav.leads",
  acciones: "nav.acciones",
  agentes: "nav.agentes",
  "agente-detalle": "shell.agentProfile",
  tareas: "nav.tareas",
  pagos: "nav.pagos",
  usuarios: "nav.usuarios",
  importar: "nav.importar",
  historial: "nav.historial",
};

export default function App() {
  const { user, viewUser, isStaff, canManageUsers, ready, data } = useStore();
  const { t } = useI18n();
  const [view, setView] = useState<ViewId>("dashboard");
  const [targetId, setTargetId] = useState<string | null>(null);
  const [agentId, setAgentId] = useState<string | null>(null);
  const [reportTab, setReportTab] = useState<ReportType>("leads");

  const agentCanSeeReports =
    !viewUser ||
    viewUser.role !== "agente" ||
    agentHasAssignedReports(data.reportTargets, viewUser.id);

  useEffect(() => {
    if (!ready || !viewUser) return;
    if (!agentCanSeeReports && (view === "reportes" || view === "reporte-detalle")) {
      setView("dashboard");
      setTargetId(null);
    }
  }, [agentCanSeeReports, view, ready, viewUser]);

  if (!ready) {
    return (
      <div className="boot-loading" role="status" aria-live="polite">
        Cargando TuSalud CRM…
      </div>
    );
  }

  if (!user || !viewUser) return <LoginScreen />;

  const current = viewUser;

  function navigate(
    id: ViewId,
    opts?: { agentId?: string; targetId?: string; reportTab?: ReportType }
  ) {
    if ((id === "reportes" || id === "reporte-detalle") && !agentCanSeeReports) {
      setView("dashboard");
      return;
    }
    if (id === "historial" && current.role === "agente") {
      setView("dashboard");
      return;
    }
    if (id === "importar" && current.role === "agente") {
      setView("leads");
      return;
    }
    if (id === "importar" && current.role === "nomina") {
      setView("dashboard");
      return;
    }
    if (id === "acciones" && current.role === "nomina") {
      setView("dashboard");
      return;
    }
    if (id === "agentes" && !isStaff) {
      setAgentId(current.id);
      setView("agente-detalle");
      return;
    }
    if (opts?.agentId) setAgentId(opts.agentId);
    if (opts?.targetId) setTargetId(opts.targetId);
    if (opts?.reportTab) setReportTab(opts.reportTab);
    else if (id === "reporte-detalle" && !opts?.reportTab) setReportTab("leads");
    setView(id);
  }

  const title =
    view === "reporte-detalle"
      ? t("nav.reportes")
      : view === "agente-detalle"
        ? t("shell.profile")
        : view === "historial" && current.role === "nomina"
          ? t("nav.historialPagos")
          : view === "usuarios"
            ? canManageUsers
              ? t("nav.usuarios")
              : current.role === "agente"
                ? t("shell.account")
                : t("shell.team")
            : TITLE_KEYS[view]
              ? t(TITLE_KEYS[view]!)
              : "TuSalud";

  const breadcrumb = `TuSalud CRM / ${title}`;

  return (
    <AppShell view={view} title={title} breadcrumb={breadcrumb} onNavigate={navigate}>
      {view === "dashboard" && <DashboardView onNavigate={navigate} />}
      {view === "reportes" && agentCanSeeReports && (
        <ReportesView
          onOpenTarget={(id) => {
            setTargetId(id);
            setView("reporte-detalle");
          }}
        />
      )}
      {view === "reporte-detalle" && targetId && agentCanSeeReports && (
        <ReporteDetalleView
          targetId={targetId}
          initialTab={reportTab}
          onBack={() => setView("reportes")}
        />
      )}
      {view === "leads" && <LeadsView onImport={() => setView("importar")} />}
      {view === "acciones" && <AccionesRequeridasView onNavigate={navigate} />}
      {view === "importar" && <ImportView onDone={() => setView("leads")} />}
      {view === "agentes" && (
        <AgentesView
          onOpenAgent={(id) => {
            setAgentId(id);
            setView("agente-detalle");
          }}
        />
      )}
      {view === "agente-detalle" && agentId && (
        <AgenteDetalleView
          agentId={agentId}
          onBack={() => setView("agentes")}
          onNavigate={navigate}
        />
      )}
      {view === "tareas" && <TareasView />}
      {view === "pagos" && <PagosView />}
      {view === "historial" && <HistorialView />}
      {view === "usuarios" && <UsuariosView />}
    </AppShell>
  );
}
