import { useMemo, useState } from "react";
import type { ReportType, ViewId } from "@/lib/types";
import { useStore } from "@/lib/store";
import {
  groupRequiredActionsByReport,
  type RequiredAction,
  type RequiredActionKind,
  type ReportActionGroup,
} from "@/lib/requiredActions";
import { CartaLinkPicker } from "@/components/CartaLinkPicker";
import { Icons } from "@/components/Icons";

type Navigate = (
  id: ViewId,
  opts?: { agentId?: string; targetId?: string; reportTab?: ReportType }
) => void;

const KIND_LABEL: Record<RequiredActionKind, string> = {
  carta_sin_lead: "Carta sin lead",
  homonimo_pendiente: "Homónimo pendiente",
  realizado_sin_carta: "Realizado sin carta",
  duplicado_real: "Duplicado real",
  tarea_vencida: "Tarea vencida",
};

type Props = {
  onNavigate: Navigate;
};

function ActionRow({
  a,
  isStaff,
  agentName,
  onNavigate,
  goReport,
}: {
  a: RequiredAction;
  isStaff: boolean;
  agentName: (id?: string | null) => string | null;
  onNavigate: Navigate;
  goReport: (targetId?: string | null) => void;
}) {
  return (
    <li className={`acciones-row severity-${a.severity}`}>
      <div className="acciones-row-main">
        <strong>{a.title}</strong>
        <span className="acciones-row-detail">
          <span className="acciones-kind">{KIND_LABEL[a.kind]}</span>
          {" · "}
          {a.detail}
        </span>
        <div className="acciones-row-meta">
          {a.leadNumber != null && <span className="sync-tag warn">#{a.leadNumber}</span>}
          {agentName(a.agentId) && (
            <span className="acciones-chip">Agente · {agentName(a.agentId)}</span>
          )}
        </div>
        {a.kind === "carta_sin_lead" && isStaff && a.entryId && a.personKey && (
          <div className="acciones-inline-fix">
            <CartaLinkPicker entryId={a.entryId} personKey={a.personKey} />
          </div>
        )}
      </div>
      <div className="acciones-row-actions">
        {a.kind === "carta_sin_lead" && (
          <button type="button" className="btn btn-sm" onClick={() => goReport(a.targetId)}>
            {Icons.reports}
            Ir a Cartas
          </button>
        )}
        {(a.kind === "homonimo_pendiente" || a.kind === "realizado_sin_carta") && (
          <>
            <button type="button" className="btn btn-sm" onClick={() => goReport(a.targetId)}>
              {Icons.consent}
              Subir carta
            </button>
            <button type="button" className="btn btn-sm" onClick={() => onNavigate("leads")}>
              {Icons.leads}
              Leads
            </button>
          </>
        )}
        {a.kind === "duplicado_real" && (
          <button type="button" className="btn btn-sm" onClick={() => onNavigate("leads")}>
            {Icons.leads}
            Ver en Leads
          </button>
        )}
        {a.kind === "tarea_vencida" && (
          <button type="button" className="btn btn-sm" onClick={() => onNavigate("tareas")}>
            {Icons.tasks}
            Ir a Tareas
          </button>
        )}
      </div>
    </li>
  );
}

function ReportGroupCard({
  group,
  isStaff,
  agentName,
  onNavigate,
  goReport,
  defaultOpen,
}: {
  group: ReportActionGroup;
  isStaff: boolean;
  agentName: (id?: string | null) => string | null;
  onNavigate: Navigate;
  goReport: (targetId?: string | null) => void;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const pending = group.actions.length;

  return (
    <section className={`acciones-report ${group.allOk ? "is-ok" : "is-warn"}`}>
      <button
        type="button"
        className="acciones-report-head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="sync-dot" />
        <div className="acciones-report-title">
          <strong>{group.title}</strong>
          <span>{group.subtitle}</span>
          {!group.allOk && pending > 0 && (
            <span className="acciones-report-pending">
              {pending} acción{pending === 1 ? "" : "es"} pendiente{pending === 1 ? "" : "s"}
            </span>
          )}
          {group.allOk && group.kind === "report" && (
            <span className="acciones-report-ok">Todo en orden</span>
          )}
        </div>
        {group.kind === "report" && <div className="acciones-report-pct">{group.pct}%</div>}
        {group.kind !== "report" && pending > 0 && (
          <div className="acciones-report-pct warn">{pending}</div>
        )}
        <span className={`acciones-chevron${open ? " open" : ""}`}>{Icons.chevronDown}</span>
      </button>

      {group.kind === "report" && (
        <div className="acciones-report-bar">
          <div className="acciones-report-bar-fill" style={{ width: `${group.pct}%` }} />
        </div>
      )}

      {open && (
        <div className="acciones-report-body">
          {group.checks.length > 0 && (
            <div className="acciones-checks">
              {group.checks.map((c) => {
                const ok = c.done >= c.total;
                return (
                  <div key={c.id} className={`acciones-check ${ok ? "ok" : "warn"}`}>
                    <span>{c.label}</span>
                    <strong>
                      {c.total ? `${c.done}/${c.total}` : "—"}
                    </strong>
                    <em>{ok ? c.okText : `${c.total - c.done} por revisar`}</em>
                  </div>
                );
              })}
            </div>
          )}

          {group.actions.length > 0 ? (
            <ul className="acciones-list">
              {group.actions.map((a) => (
                <ActionRow
                  key={a.id}
                  a={a}
                  isStaff={isStaff}
                  agentName={agentName}
                  onNavigate={onNavigate}
                  goReport={goReport}
                />
              ))}
            </ul>
          ) : group.kind === "report" ? (
            <p className="acciones-empty-ok">Sin acciones pendientes en este perfil.</p>
          ) : null}

          {group.targetId && (
            <div className="acciones-report-footer">
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => goReport(group.targetId)}
              >
                {Icons.reports}
                Abrir reporte
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export function AccionesRequeridasView({ onNavigate }: Props) {
  const { data, syncHealth, viewUser, isStaff } = useStore();
  const scopeAgentId = viewUser?.role === "agente" ? viewUser.id : null;

  const groups = useMemo(
    () =>
      groupRequiredActionsByReport({
        leads: data.leads,
        reportEntries: data.reportEntries,
        reportTargets: data.reportTargets,
        tasks: data.tasks,
        syncHealth,
        scopeAgentId,
        profileName: (id) =>
          (id && data.profiles.find((p) => p.id === id)?.fullName) || "",
      }),
    [
      data.leads,
      data.reportEntries,
      data.reportTargets,
      data.tasks,
      data.profiles,
      syncHealth,
      scopeAgentId,
    ]
  );

  const totalPending = useMemo(
    () => groups.reduce((s, g) => s + g.actions.length, 0),
    [groups]
  );
  const reportGroups = groups.filter((g) => g.kind === "report");
  const okReports = reportGroups.filter((g) => g.allOk).length;

  const agentName = (id?: string | null) =>
    (id && data.profiles.find((p) => p.id === id)?.fullName) || null;

  const goReport = (targetId?: string | null) => {
    if (targetId) onNavigate("reporte-detalle", { targetId, reportTab: "consent" });
    else onNavigate("reportes");
  };

  if (!groups.length) {
    return (
      <div className="acciones-page">
        <div className="acciones-hero is-ok">
          <span className="sync-dot" />
          <div>
            <strong>Todo en orden</strong>
            <p>
              {scopeAgentId
                ? "No tienes perfiles de reporte ni tareas pendientes."
                : "No hay perfiles de reporte activos ni tareas pendientes."}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="acciones-page">
      <div className={`acciones-hero ${totalPending ? "is-warn" : "is-ok"}`}>
        <span className="sync-dot" />
        <div>
          <strong>{totalPending ? "Acciones requeridas" : "Todo en orden"}</strong>
          <p>
            {reportGroups.length
              ? `${okReports}/${reportGroups.length} perfiles al 100%`
              : "Sin perfiles"}
            {totalPending
              ? ` · ${totalPending} acción${totalPending === 1 ? "" : "es"} pendiente${totalPending === 1 ? "" : "s"}`
              : ""}
            {scopeAgentId ? " en tu asignación" : ""}
          </p>
        </div>
        {totalPending > 0 && <div className="acciones-count">{totalPending}</div>}
      </div>

      {groups.map((g) => (
        <ReportGroupCard
          key={g.key}
          group={g}
          isStaff={isStaff}
          agentName={agentName}
          onNavigate={onNavigate}
          goReport={goReport}
          defaultOpen={!g.allOk}
        />
      ))}
    </div>
  );
}
