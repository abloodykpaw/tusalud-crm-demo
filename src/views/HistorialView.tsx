import { useMemo, useState } from "react";
import { useStore, formatDate } from "@/lib/store";
import type { HistoryModule } from "@/lib/types";
import {
  HISTORY_MODULE_LABELS,
  filterHistoryEvents,
  historyModulesForRole,
  historyTypeLabel,
} from "@/lib/history";
import { Icons } from "@/components/Icons";

function formatDateTime(iso: string) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return formatDate(iso);
  return d.toLocaleString("es-VE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function moduleTone(mod: HistoryModule) {
  const map: Record<HistoryModule, string> = {
    payments: "green",
    tasks: "amber",
    leads: "blue",
    reports: "teal",
    users: "blue",
    auth: "teal",
    system: "amber",
  };
  return map[mod] || "teal";
}

export function HistorialView() {
  const { data, viewRole } = useStore();
  const role = viewRole || "agente";
  const modules = historyModulesForRole(role);
  const [moduleFilter, setModuleFilter] = useState<HistoryModule | "all">("all");
  const [q, setQ] = useState("");

  const events = useMemo(() => {
    const base = filterHistoryEvents(data.historyEvents || [], role, moduleFilter);
    const query = q.trim().toLowerCase();
    if (!query) return base;
    return base.filter(
      (ev) =>
        ev.summary.toLowerCase().includes(query) ||
        ev.actorName.toLowerCase().includes(query) ||
        historyTypeLabel(ev.type).toLowerCase().includes(query) ||
        HISTORY_MODULE_LABELS[ev.module].toLowerCase().includes(query)
    );
  }, [data.historyEvents, role, moduleFilter, q]);

  if (modules.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-icon">{Icons.history}</div>
        <h4>Sin acceso al historial</h4>
        <p>Tu rol no tiene un apartado de auditoría.</p>
      </div>
    );
  }

  const subtitle =
    role === "admin"
      ? "Todos los módulos y cambios del sistema"
      : role === "encargado"
        ? "Operación: leads, reportes, tareas, pagos y equipo"
        : "Pagos Zelle y validación de pruebas de tareas";

  return (
    <div className="historial-view">
      <div className="week-strip">
        <div>
          <div className="label">Auditoría</div>
          <div className="value">{subtitle}</div>
        </div>
        <div className="live-dot">{events.length} eventos</div>
      </div>

      <div className="historial-toolbar">
        <div className="tabs historial-tabs">
          <button
            type="button"
            className={`tab${moduleFilter === "all" ? " active" : ""}`}
            onClick={() => setModuleFilter("all")}
          >
            Todo
          </button>
          {modules.map((m) => (
            <button
              key={m}
              type="button"
              className={`tab${moduleFilter === m ? " active" : ""}`}
              onClick={() => setModuleFilter(m)}
            >
              {HISTORY_MODULE_LABELS[m]}
            </button>
          ))}
        </div>
        <div className="search-box historial-search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por actor, módulo o detalle…"
          />
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h3>
            {role === "nomina" ? "Historial de pagos" : "Historial de cambios"}
          </h3>
        </div>
        <div className="panel-body">
          {events.length === 0 ? (
            <div className="empty-state" style={{ padding: "48px 20px" }}>
              <div className="empty-icon">{Icons.history}</div>
              <h4>Sin eventos</h4>
              <p>Cuando haya cambios en los módulos visibles, aparecerán aquí.</p>
            </div>
          ) : (
            <div className="history-timeline">
              {events.map((ev) => (
                <article key={ev.id} className="history-item">
                  <div className={`history-dot ${moduleTone(ev.module)}`} />
                  <div className="history-body">
                    <div className="history-top">
                      <span className={`history-module badge-${moduleTone(ev.module)}`}>
                        {HISTORY_MODULE_LABELS[ev.module]}
                      </span>
                      <span className="history-type">{historyTypeLabel(ev.type)}</span>
                      <time className="history-time" dateTime={ev.at}>
                        {formatDateTime(ev.at)}
                      </time>
                    </div>
                    <p className="history-summary">{ev.summary}</p>
                    <div className="history-meta">
                      <span>
                        Por <strong>{ev.actorName}</strong>
                      </span>
                      <span className="history-role">{ev.actorRole}</span>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
