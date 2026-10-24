import { Fragment, useEffect, useMemo, useState } from "react";
import { useStore, leadStatusLabel } from "@/lib/store";
import { useToast } from "@/components/Toast";
import { Icons } from "@/components/Icons";
import { DayFolder } from "@/components/DayFolder";
import type { Lead, LeadStatus, ViewId } from "@/lib/types";
import { parseDependents, parseHouseholdSummary, primaryExcelColumns, excelColumnsInOrder, leadSortNumber, leadExcelCellValue, mapLeadFromExcelRow, EXPECTED_DEPENDENT_COLUMNS, leadMatchKey } from "@/lib/lead-dependents";
import { groupByDay, todayKey } from "@/lib/dayFolders";
import { GlobalTotalBadge } from "@/components/GlobalTotalBadge";
import { analyzeConsentLeadDrift } from "@/lib/cartaLeadSync";
import { buildReportFileName, fileStem } from "@/lib/reportUpload";
import { adaptRowsToCristhyam } from "@/lib/leadFormat";

const ACTIVE_STATUSES: LeadStatus[] = [
  "nuevo",
  "contactado",
  "cotizado",
  "cerrado",
  "perdido",
];
const STATUSES: LeadStatus[] = [...ACTIVE_STATUSES, "realizado"];
const PAGE_SIZE = 20;
/** Sección de leads sin perfil de reporte (lotes viejos o perfil desactivado). */
const NO_PROFILE = "sin-perfil";
/** Sección de leads sin agente asignado (vista «Todos los agentes»). */
const UNASSIGNED = "sin-agente";

function compareLeadNumber(a: Lead, b: Lead) {
  const an = a.leadNumber || leadSortNumber(a);
  const bn = b.leadNumber || leadSortNumber(b);
  if (an !== bn) return an - bn;
  return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}

/** Carpetas por día con el # de cada lead dentro de su día. */
function bucketLeadsByDay(rows: Lead[]) {
  return groupByDay(rows, (l) => l.createdAt).map((b) => ({
    ...b,
    items: [...b.items].sort(compareLeadNumber).map((item, i) => ({
      ...item,
      dayNumber: item.leadNumber || leadSortNumber(item) || i + 1,
    })),
  }));
}

function profileInitials(name: string) {
  const words = name.split(/[\s/]+/).filter(Boolean);
  return (words.length > 1 ? words[0][0] + words[1][0] : name.slice(0, 2)).toUpperCase();
}

function statusPillClass(s: LeadStatus) {
  if (s === "nuevo") return "new";
  if (s === "realizado") return "done";
  if (s === "contactado") return "contact";
  if (s === "cotizado") return "quote";
  if (s === "cerrado") return "closed";
  return "late";
}

function leadExcelColumns(rows: { columnOrder?: string[]; rawData?: Record<string, string> }[]) {
  // Misma secuencia de columnas que el Excel (incl. plan, ingreso, dependientes).
  return excelColumnsInOrder(rows);
}

function LeadDetailPanel({
  lead,
  dayNumber,
  canManageLeads,
  canEdit,
  agentLabel,
  reportTargetLabel,
  onClose,
  onStatusChange,
  onAssign,
  onReportTargetChange,
  onNotesChange,
  agents,
  reportTargets,
}: {
  lead: Lead;
  dayNumber?: number | null;
  canManageLeads: boolean;
  canEdit: boolean;
  agentLabel: string;
  reportTargetLabel: string;
  onClose: () => void;
  onStatusChange: (status: LeadStatus) => void;
  onAssign: (agentId: string | null) => void;
  onReportTargetChange: (targetId: string | null) => void;
  onNotesChange: (notes: string) => void;
  agents: { id: string; fullName: string }[];
  reportTargets: { id: string; name: string }[];
}) {
  const parsed = parseDependents(lead.rawData, lead.columnOrder);
  const dependents = parsed.groups;
  const household = parseHouseholdSummary(lead.rawData);
  const titularFields = primaryExcelColumns([lead]).map((col) => ({
    label: col,
    value: lead.rawData?.[col] || "—",
  }));
  const displayNumber = dayNumber || lead.leadNumber || "—";

  return (
    <aside className="drawer leads-overlay-drawer" onClick={(e) => e.stopPropagation()}>
      <div className="leads-side-head">
        <div>
          <div className="leads-side-eyebrow">Titular · Lead #{displayNumber}</div>
          <h3>
            {lead.firstName} {lead.lastName}
          </h3>
        </div>
        <button className="btn-text" type="button" onClick={onClose} aria-label="Cerrar panel">
          Cerrar
        </button>
      </div>

      <div className="leads-side-body">
        <div className="drawer-section">
          <h4>Estado y asignación</h4>
          <div className="field">
            <label>Estado CRM</label>
            <select
              className="filter-select"
              style={{ width: "100%" }}
              value={lead.status}
              onChange={(e) => onStatusChange(e.target.value as LeadStatus)}
              disabled={!canEdit}
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {leadStatusLabel(s)}
                </option>
              ))}
            </select>
          </div>
          {canManageLeads && (
            <div className="field">
              <label>Agente</label>
              <select
                className="filter-select"
                style={{ width: "100%" }}
                value={lead.assignedAgentId || ""}
                onChange={(e) => onAssign(e.target.value || null)}
              >
                <option value="">Sin asignar</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.fullName}
                  </option>
                ))}
              </select>
            </div>
          )}
          {!canManageLeads && (
            <div className="detail-item">
              <label>Agente</label>
              <span>{agentLabel}</span>
            </div>
          )}
          {canManageLeads ? (
            <div className="field">
              <label>Perfil de reporte</label>
              <select
                className="filter-select"
                style={{ width: "100%" }}
                value={lead.reportTargetId || ""}
                onChange={(e) => onReportTargetChange(e.target.value || null)}
              >
                <option value="">Sin perfil</option>
                {reportTargets.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="detail-item">
              <label>Perfil de reporte</label>
              <span>{reportTargetLabel}</span>
            </div>
          )}
        </div>

        {!!titularFields.length && (
          <div className="drawer-section">
            <h4>Datos del titular</h4>
            <div className="detail-grid">
              {titularFields.map((f) => (
                <div className="detail-item" key={f.label}>
                  <label>{f.label}</label>
                  <span>{f.value}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {!titularFields.length && (
          <div className="drawer-section">
            <h4>Contacto</h4>
            <div className="detail-grid">
              <div className="detail-item">
                <label>Teléfono</label>
                <span>{lead.phone || "—"}</span>
              </div>
              <div className="detail-item">
                <label>Email</label>
                <span>{lead.email || "—"}</span>
              </div>
              <div className="detail-item">
                <label>Ciudad</label>
                <span>{lead.city || "—"}</span>
              </div>
            </div>
          </div>
        )}

        <div className="drawer-section">
          <h4>
            Dependientes ({parsed.hasPersonDetails ? dependents.length : parsed.expectedCount})
          </h4>
          {!!household.length && (
            <div className="household-summary">
              {household.map((f) => (
                <div className="detail-item" key={f.label}>
                  <label>{f.label}</label>
                  <span>{f.value}</span>
                </div>
              ))}
            </div>
          )}
          {parsed.hasPersonDetails ? (
            <div className="dependents-stack">
              {dependents.map((dep) => (
                <div className="dependent-card" key={dep.index}>
                  <div className="dependent-card-head">{dep.label}</div>
                  <div className="detail-grid">
                    {dep.fields.map((f) => (
                      <div className="detail-item" key={f.label}>
                        <label>{f.label}</label>
                        <span>{f.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : parsed.expectedCount > 0 ? (
            <p className="leads-side-empty">
              Este Excel solo trae el número de dependientes ({parsed.expectedCount}), no nombre, fecha
              de nacimiento, edad ni sexo de cada persona. Recarga el archivo con columnas como{" "}
              <code>Dependiente (Pareja)</code>, <code>Dependiente (Hijo 1)</code>,{" "}
              <code>Fecha de nacimiento (Hijo 1)</code>, <code>Edad (Hijo 1)</code> y{" "}
              <code>Sexo (Hijo 1)</code>.
            </p>
          ) : (
            <p className="leads-side-empty">
              {lead.rawData
                ? "Este lead no registra dependientes en el Excel."
                : "Sin datos del Excel. Reimporta el archivo."}
            </p>
          )}
        </div>

        <div className="drawer-section">
          <h4>Notas</h4>
          <textarea
            className="report-textarea"
            rows={4}
            value={lead.notes}
            onChange={(e) => onNotesChange(e.target.value)}
            disabled={!canEdit}
            placeholder="Agregar notas del seguimiento…"
          />
        </div>

        <div className="drawer-section">
          <h4>Fuente</h4>
          <p className="leads-side-source">{lead.source || "—"}</p>
        </div>
      </div>
    </aside>
  );
}

export function LeadsView({ onImport }: { onImport: () => void }) {
  const {
    data,
    viewUser: user,
    agents,
    updateLead,
    assignLead,
    assignLeads,
    markLeadsRealizado,
    setLeadsReportTarget,
  } = useStore();
  const { toast } = useToast();
  const [q, setQ] = useState("");
  const [listMode, setListMode] = useState<"en_curso" | "realizados" | "sin_carta">("en_curso");
  const [filter, setFilter] = useState<LeadStatus | "all">("all");
  const [agentFilter, setAgentFilter] = useState<string>("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [bulkAgent, setBulkAgent] = useState("");
  const [openDays, setOpenDays] = useState<Set<string>>(() => new Set([todayKey()]));
  const [visibleByDay, setVisibleByDay] = useState<Record<string, number>>({});

  /** Admin/encargado ven todos; agentes solo los suyos. */
  const canManageLeads = user?.role === "admin" || user?.role === "encargado";
  const canSelectLeads = canManageLeads || user?.role === "agente";

  const scopedLeads = useMemo(() => {
    let rows = [...data.leads];
    if (user?.role === "agente") {
      rows = rows.filter((l) => l.assignedAgentId === user.id);
    } else if (!canManageLeads) {
      rows = [];
    }
    if (canManageLeads && agentFilter === "unassigned") {
      rows = rows.filter((l) => !l.assignedAgentId);
    } else if (canManageLeads && agentFilter !== "all") {
      rows = rows.filter((l) => l.assignedAgentId === agentFilter);
    }
    if (q) {
      const s = q.toLowerCase();
      rows = rows.filter((l) => {
        const base =
          `${l.firstName} ${l.lastName}`.toLowerCase().includes(s) ||
          l.phone.includes(s) ||
          l.email.toLowerCase().includes(s) ||
          String(l.leadNumber || "").includes(s);
        if (base) return true;
        if (!l.rawData) return false;
        return Object.values(l.rawData).some((v) => v.toLowerCase().includes(s));
      });
    }
    return rows;
  }, [data.leads, q, user, canManageLeads, agentFilter]);

  const enCursoCount = useMemo(
    () => scopedLeads.filter((l) => l.status !== "realizado").length,
    [scopedLeads]
  );
  const realizadosCount = useMemo(
    () => scopedLeads.filter((l) => l.status === "realizado").length,
    [scopedLeads]
  );

  const drift = useMemo(
    () =>
      analyzeConsentLeadDrift(data.reportEntries, data.leads, undefined, {
        profiles: data.profiles,
        historyEvents: data.historyEvents,
      }),
    [data.reportEntries, data.leads, data.profiles, data.historyEvents]
  );

  const sinCartaInScope = useMemo(() => {
    const scopedIds = new Set(scopedLeads.map((l) => l.id));
    return drift.realizadosSinCarta.filter((r) => scopedIds.has(r.leadId));
  }, [drift.realizadosSinCarta, scopedLeads]);

  const sinCartaIds = useMemo(
    () => new Set(sinCartaInScope.map((r) => r.leadId)),
    [sinCartaInScope]
  );

  const list = useMemo(() => {
    let rows =
      listMode === "sin_carta"
        ? scopedLeads.filter((l) => sinCartaIds.has(l.id))
        : listMode === "realizados"
          ? scopedLeads.filter((l) => l.status === "realizado")
          : scopedLeads.filter((l) => l.status !== "realizado");
    if (listMode === "en_curso" && filter !== "all") {
      rows = rows.filter((l) => l.status === filter);
    }
    // Orden ascendente estricto por # del Excel/CRM (1 → N).
    rows.sort(compareLeadNumber);
    return rows;
  }, [scopedLeads, listMode, filter, sinCartaIds]);

  const dayBuckets = useMemo(() => bucketLeadsByDay(list), [list]);

  const targetsById = useMemo(
    () => new Map(data.reportTargets.map((t) => [t.id, t])),
    [data.reportTargets]
  );

  /** Con «Todos los agentes», cada agente lleva su propia sección (y dentro, sus perfiles). */
  const showAgentSections = canManageLeads && agentFilter === "all";

  /**
   * Agentes con sus perfiles de reporte y contadores sobre todos sus leads.
   * Perfiles: primero los asignados al agente, luego otros, al final «Sin perfil».
   */
  const agentGroups = useMemo(() => {
    const profileKeyOf = (l: Lead) =>
      l.reportTargetId && targetsById.has(l.reportTargetId) ? l.reportTargetId : NO_PROFILE;
    const stats = new Map<string, Map<string, { total: number; done: number }>>();
    for (const l of scopedLeads) {
      const agentKey = l.assignedAgentId || UNASSIGNED;
      const byProfile = stats.get(agentKey) || new Map<string, { total: number; done: number }>();
      stats.set(agentKey, byProfile);
      const key = profileKeyOf(l);
      const s = byProfile.get(key) || { total: 0, done: 0 };
      s.total += 1;
      if (l.status === "realizado") s.done += 1;
      byProfile.set(key, s);
    }
    const groups = [...stats.entries()].map(([agentKey, byProfile]) => {
      const own = new Set(
        data.reportTargets
          .filter((t) => t.active && t.assignedAgentId === agentKey)
          .map((t) => t.id)
      );
      const rank = (key: string) => (key === NO_PROFILE ? 2 : own.has(key) ? 0 : 1);
      const profiles = [...byProfile.entries()].map(([key, s]) => ({
        key,
        name: key === NO_PROFILE ? "Sin perfil de reporte" : targetsById.get(key)?.name || "—",
        ...s,
      }));
      profiles.sort((x, y) => rank(x.key) - rank(y.key) || x.name.localeCompare(y.name));
      return {
        key: agentKey,
        name:
          agentKey === UNASSIGNED
            ? "Sin asignar"
            : data.profiles.find((p) => p.id === agentKey)?.fullName || "—",
        total: profiles.reduce((n, x) => n + x.total, 0),
        done: profiles.reduce((n, x) => n + x.done, 0),
        profiles,
      };
    });
    groups.sort(
      (x, y) =>
        Number(x.key === UNASSIGNED) - Number(y.key === UNASSIGNED) || x.name.localeCompare(y.name)
    );
    return { profileKeyOf, groups };
  }, [scopedLeads, data.reportTargets, data.profiles, targetsById]);

  /** Lista visible repartida: agente → perfil de reporte → carpetas por día. */
  const agentSections = useMemo(() => {
    const { profileKeyOf, groups } = agentGroups;
    return groups
      .map((agent) => {
        const agentRows = list.filter((l) => (l.assignedAgentId || UNASSIGNED) === agent.key);
        const profiles = agent.profiles
          .map((profile) => {
            const rows = agentRows.filter((l) => profileKeyOf(l) === profile.key);
            return {
              key: `${agent.key}|${profile.key}`,
              profile,
              // Columnas por carpeta: cada tabla usa las de su propio Excel.
              buckets: bucketLeadsByDay(rows).map((bucket) => ({
                ...bucket,
                columns: leadExcelColumns(bucket.items),
              })),
              count: rows.length,
            };
          })
          .filter((section) => section.count > 0);
        return { key: agent.key, agent, profiles, count: agentRows.length };
      })
      .filter((section) => section.count > 0);
  }, [agentGroups, list]);

  const globalLeadTotal = scopedLeads.length;

  const activeDayNumber = useMemo(() => {
    if (!selected) return null;
    for (const agentSection of agentSections) {
      for (const section of agentSection.profiles) {
        for (const bucket of section.buckets) {
          const found = bucket.items.find((l) => l.id === selected);
          if (found) return found.dayNumber;
        }
      }
    }
    return null;
  }, [selected, agentSections]);

  useEffect(() => {
    setOpenDays((prev) => {
      const todayFolders = agentSections.flatMap((a) =>
        a.profiles.map((s) => folderKey(s.key, todayKey()))
      );
      if (todayFolders.every((k) => prev.has(k))) return prev;
      const next = new Set(prev);
      todayFolders.forEach((k) => next.add(k));
      return next;
    });
  }, [agentSections]);

  const active = data.leads.find((l) => l.id === selected);

  useEffect(() => {
    if (!selected) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setSelected(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  function canEditLead(leadId: string) {
    const lead = data.leads.find((l) => l.id === leadId);
    if (!lead) return false;
    if (canManageLeads) return true;
    return user?.role === "agente" && lead.assignedAgentId === user.id;
  }

  function agentName(id: string | null) {
    if (!id) return "—";
    return data.profiles.find((p) => p.id === id)?.fullName || "—";
  }

  function reportTargetName(id: string | null | undefined) {
    return (id && targetsById.get(id)?.name) || "Sin perfil";
  }

  /** Perfiles activos para mover un lead (más el actual, aunque esté desactivado). */
  function assignableReportTargets(currentId: string | null | undefined) {
    return data.reportTargets
      .filter((t) => t.active || t.id === currentId)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Clave de carpeta: agente + perfil + día (cada sección abre y pagina por separado). */
  function folderKey(sectionKey: string, dayKey: string) {
    return `${sectionKey}|${dayKey}`;
  }

  function toggleCheck(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllVisible(dayLeads: Lead[]) {
    const editable = dayLeads.filter((l) => canEditLead(l.id));
    if (!editable.length) return;
    if (editable.every((l) => checked.has(l.id))) {
      setChecked((prev) => {
        const next = new Set(prev);
        editable.forEach((l) => next.delete(l.id));
        return next;
      });
      return;
    }
    setChecked((prev) => {
      const next = new Set(prev);
      editable.forEach((l) => next.add(l.id));
      return next;
    });
  }

  function toggleDay(dayKey: string) {
    setOpenDays((prev) => {
      const next = new Set(prev);
      if (next.has(dayKey)) next.delete(dayKey);
      else next.add(dayKey);
      return next;
    });
  }

  function visibleForDay(dayKey: string, total: number) {
    return Math.min(visibleByDay[dayKey] ?? PAGE_SIZE, total);
  }

  function showMoreForDay(dayKey: string) {
    setVisibleByDay((prev) => ({
      ...prev,
      [dayKey]: (prev[dayKey] ?? PAGE_SIZE) + PAGE_SIZE,
    }));
  }

  function applyBulkAssign() {
    if (!checked.size) {
      toast("Selecciona al menos un lead");
      return;
    }
    if (!bulkAgent) {
      toast("Elige un agente para asignar");
      return;
    }
    const n = assignLeads([...checked], bulkAgent);
    const name = agentName(bulkAgent);
    toast(`${n} lead${n === 1 ? "" : "s"} → ${name}`);
    setChecked(new Set());
    setBulkAgent("");
  }

  function applyBulkRealizado() {
    const ids = [...checked].filter((id) => canEditLead(id));
    if (!ids.length) {
      toast("Selecciona al menos un lead");
      return;
    }
    const n = markLeadsRealizado(ids);
    if (!n) {
      toast("Los seleccionados ya estaban realizados");
      return;
    }
    toast(`${n} lead${n === 1 ? "" : "s"} marcado${n === 1 ? "" : "s"} como realizado`);
    setChecked(new Set());
    setSelected(null);
  }

  return (
    <>
      <div className="week-strip">
        <div>
          <div className="label">Leads</div>
          <div className="value">
            {canManageLeads
              ? "Carpetas por día · importa Excel y asígnalos a un agente"
              : "Carpetas por día · solo ves los leads asignados a ti"}
          </div>
        </div>
        <div className="live-dot">
          {listMode === "en_curso"
            ? "En curso"
            : listMode === "sin_carta"
              ? "Sin carta"
              : "Realizados"}{" "}
          · {list.length} · {dayBuckets.length} día
          {dayBuckets.length === 1 ? "" : "s"}
        </div>
      </div>

      {sinCartaInScope.length > 0 && listMode !== "sin_carta" && (
        <div className="consent-drift-panel leads-sin-carta-banner">
          <div>
            <strong>
              {sinCartaInScope.length} realizado{sinCartaInScope.length === 1 ? "" : "s"} sin carta de
              consentimiento
            </strong>
            <p className="consent-drift-meta">
              {sinCartaInScope
                .slice(0, 3)
                .map((r) => {
                  const who = r.markedBy
                    ? `marcado por ${r.markedBy}`
                    : r.assignedAgent
                      ? `asignado a ${r.assignedAgent}`
                      : null;
                  return `#${r.leadNumber} ${r.name}${who ? ` (${who})` : ""}`;
                })
                .join(" · ")}
              {sinCartaInScope.length > 3 ? ` · +${sinCartaInScope.length - 3} más` : ""}
            </p>
          </div>
          <button
            className="btn btn-primary-sm"
            type="button"
            onClick={() => {
              setListMode("sin_carta");
              setFilter("all");
              setVisibleByDay({});
            }}
          >
            Ver lista
          </button>
        </div>
      )}

      <div className="toolbar">
        <div className="search-box">
          {Icons.search}
          <input
            placeholder="Buscar por nombre, teléfono o email..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        {canManageLeads && (
          <button className="btn" onClick={onImport}>
            {Icons.import} Importar Excel
          </button>
        )}
      </div>

      <div className="filter-row">
        <button
          className={`filter-chip${listMode === "en_curso" ? " active" : ""}`}
          onClick={() => {
            setListMode("en_curso");
            setVisibleByDay({});
          }}
        >
          En curso <b style={{ marginLeft: 4 }}>{enCursoCount}</b>
        </button>
        <button
          className={`filter-chip${listMode === "realizados" ? " active" : ""}`}
          onClick={() => {
            setListMode("realizados");
            setFilter("all");
            setVisibleByDay({});
          }}
        >
          Realizados <b style={{ marginLeft: 4 }}>{realizadosCount}</b>
        </button>
        {sinCartaInScope.length > 0 && (
          <button
            className={`filter-chip filter-chip-warn${listMode === "sin_carta" ? " active" : ""}`}
            onClick={() => {
              setListMode("sin_carta");
              setFilter("all");
              setVisibleByDay({});
            }}
          >
            Sin carta <b style={{ marginLeft: 4 }}>{sinCartaInScope.length}</b>
          </button>
        )}
        {listMode === "en_curso" && (
          <>
            <button
              className={`filter-chip${filter === "all" ? " active" : ""}`}
              onClick={() => {
                setFilter("all");
                setVisibleByDay({});
              }}
              style={{ marginLeft: 8 }}
            >
              Todos
            </button>
            {ACTIVE_STATUSES.map((s) => (
              <button
                key={s}
                className={`filter-chip${filter === s ? " active" : ""}`}
                onClick={() => {
                  setFilter(s);
                  setVisibleByDay({});
                }}
              >
                {leadStatusLabel(s)}
              </button>
            ))}
          </>
        )}
        {canManageLeads && (
          <select
            className="filter-select"
            value={agentFilter}
            onChange={(e) => {
              setAgentFilter(e.target.value);
              setVisibleByDay({});
            }}
            style={{ marginLeft: 8 }}
          >
            <option value="all">Todos los agentes</option>
            <option value="unassigned">Sin asignar</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.fullName}
              </option>
            ))}
          </select>
        )}
      </div>

      {canSelectLeads && checked.size > 0 && (
        <div className="leads-bulk-bar">
          <strong>{checked.size} seleccionado{checked.size === 1 ? "" : "s"}</strong>
          {listMode === "en_curso" && (
            <button className="btn btn-primary-sm" type="button" onClick={applyBulkRealizado}>
              Marcar realizados
            </button>
          )}
          {canManageLeads && (
            <>
              <select
                className="filter-select"
                value={bulkAgent}
                onChange={(e) => setBulkAgent(e.target.value)}
              >
                <option value="">Asignar a…</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.fullName}
                  </option>
                ))}
              </select>
              <button className="btn btn-primary-sm" type="button" onClick={applyBulkAssign} disabled={!bulkAgent}>
                Asignar
              </button>
            </>
          )}
          <button className="btn-text" type="button" onClick={() => setChecked(new Set())}>
            Limpiar
          </button>
        </div>
      )}

      <div className="day-folders">
        {!list.length ? (
          <div className="panel day-folders-empty">
            {listMode === "sin_carta"
              ? "No hay realizados sin carta de consentimiento"
              : user?.role === "agente"
              ? "No tienes leads asignados aún"
              : "No se encontraron leads"}
          </div>
        ) : (
          agentSections.map((agentSection) => {
            const profileGroups = agentSection.profiles.map((section) => {
              const folders = section.buckets.map((bucket) => {
                const fKey = folderKey(section.key, bucket.key);
                const limit = visibleForDay(fKey, bucket.items.length);
                const dayVisible = bucket.items.slice(0, limit);
                const dayHasMore = limit < bucket.items.length;
                const excelColumns = bucket.columns;
                const hasExcelColumns = excelColumns.length > 0;
                return (
                  <DayFolder
                    key={fKey}
                    dayKey={bucket.key}
                    label={bucket.label}
                    count={bucket.items.length}
                    countLabel={bucket.items.length === 1 ? "lead" : "leads"}
                    open={openDays.has(fKey)}
                    isToday={bucket.isToday}
                    onToggle={() => toggleDay(fKey)}
                    subtitle={
                      bucket.items.length
                        ? `Numeración del día · #1 → #${bucket.items.length}`
                        : `Carpeta automática · ${bucket.key}`
                    }
                  >
                    <div className="panel leads-main" style={{ margin: 0, boxShadow: "none", border: "none" }}>
                      <div className="panel-body leads-table-scroll">
                        <table className="data-table leads-table-wide">
                          <thead>
                            <tr>
                              <th style={{ width: 56 }}>#</th>
                              {canSelectLeads && (
                                <th style={{ width: 36 }}>
                                  <input
                                    type="checkbox"
                                    checked={
                                      !!dayVisible.filter((l) => canEditLead(l.id)).length &&
                                      dayVisible.filter((l) => canEditLead(l.id)).every((l) => checked.has(l.id))
                                    }
                                    onChange={() => toggleAllVisible(dayVisible)}
                                    aria-label={`Seleccionar leads del ${bucket.key}`}
                                  />
                                </th>
                              )}
                              {hasExcelColumns ? (
                                excelColumns.map((col) => <th key={col}>{col}</th>)
                              ) : (
                                <>
                                  <th>Lead</th>
                                  <th>Teléfono</th>
                                  <th>Email</th>
                                </>
                              )}
                              <th>Estado</th>
                              {canManageLeads && <th>Agente</th>}
                              <th>Fuente</th>
                            </tr>
                          </thead>
                          <tbody>
                            {dayVisible.map((l) => (
                              <tr
                                key={l.id}
                                className={[
                                  selected === l.id ? "row-selected" : "",
                                  sinCartaIds.has(l.id) ? "row-warn-sin-carta" : "",
                                ]
                                  .filter(Boolean)
                                  .join(" ") || undefined}
                                onClick={() => setSelected(l.id)}
                              >
                                <td>
                                  <span className="lead-number-pill">{l.dayNumber || "—"}</span>
                                </td>
                                {canSelectLeads && (
                                  <td
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (canEditLead(l.id)) toggleCheck(l.id);
                                    }}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={checked.has(l.id)}
                                      disabled={!canEditLead(l.id)}
                                      onChange={() => {
                                        if (canEditLead(l.id)) toggleCheck(l.id);
                                      }}
                                      aria-label={`Seleccionar ${l.firstName}`}
                                    />
                                  </td>
                                )}
                                {hasExcelColumns ? (
                                  excelColumns.map((col) => (
                                    <td key={col}>{leadExcelCellValue(l, col)}</td>
                                  ))
                                ) : (
                                  <>
                                    <td>
                                      <span className="cell-name">
                                        {l.firstName} {l.lastName}
                                      </span>
                                      <div className="cell-sub">{l.city}</div>
                                    </td>
                                    <td>{l.phone}</td>
                                    <td>{l.email}</td>
                                  </>
                                )}
                                <td onClick={(e) => e.stopPropagation()}>
                                  <div className="leads-status-cell">
                                    {canEditLead(l.id) ? (
                                      <select
                                        className="filter-select leads-status-select"
                                        value={l.status}
                                        onChange={(e) => {
                                          const next = e.target.value as LeadStatus;
                                          updateLead(l.id, { status: next });
                                          if (next === "realizado") {
                                            toast(`#${l.dayNumber} marcado como realizado`);
                                            if (selected === l.id) setSelected(null);
                                          }
                                        }}
                                      >
                                        {STATUSES.map((s) => (
                                          <option key={s} value={s}>
                                            {leadStatusLabel(s)}
                                          </option>
                                        ))}
                                      </select>
                                    ) : (
                                      <span className={`status-pill ${statusPillClass(l.status)}`}>
                                        {leadStatusLabel(l.status)}
                                      </span>
                                    )}
                                    {sinCartaIds.has(l.id) && (
                                      <span className="lead-sin-carta-badge" title="Realizado sin carta de consentimiento">
                                        Sin carta
                                      </span>
                                    )}
                                  </div>
                                </td>
                                {canManageLeads && <td>{agentName(l.assignedAgentId)}</td>}
                                <td className="cell-truncate">{l.source}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {dayHasMore && (
                          <div className="leads-load-more">
                            <button
                              className="btn"
                              type="button"
                              onClick={() => showMoreForDay(fKey)}
                            >
                              Ver más (+{PAGE_SIZE})
                            </button>
                            <span className="leads-load-more-hint">
                              Mostrando {dayVisible.length} de {bucket.items.length}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  </DayFolder>
                );
              });
              const p = section.profile;
              const isNone = p.key === NO_PROFILE;
              return (
                <section className="lead-profile-group" key={section.key}>
                  <header className="lead-profile-head">
                    <span className={`avatar lead-profile-avatar${isNone ? " is-none" : ""}`} aria-hidden>
                      {isNone ? "?" : profileInitials(p.name)}
                    </span>
                    <div className="lead-profile-title">
                      <span className="lead-profile-eyebrow">Perfil de reporte</span>
                      <strong>{p.name}</strong>
                      {isNone && canManageLeads && (
                        <span className="lead-profile-hint">Abre cada lead y elige su perfil</span>
                      )}
                    </div>
                    <div className="lead-profile-stats">
                      <span className="status-pill new">
                        {section.count} {section.count === 1 ? "lead" : "leads"}
                      </span>
                      <span className={`status-pill ${p.done ? "done" : "pending"}`}>
                        {p.done}/{p.total} realizados
                      </span>
                    </div>
                  </header>
                  <div className="day-folders">{folders}</div>
                </section>
              );
            });
            if (!showAgentSections) {
              return <Fragment key={agentSection.key}>{profileGroups}</Fragment>;
            }
            const a = agentSection.agent;
            const isUnassigned = a.key === UNASSIGNED;
            return (
              <section className="lead-agent-group" key={agentSection.key}>
                <header className="lead-agent-head">
                  <span
                    className={`avatar lead-agent-avatar${isUnassigned ? " is-none" : ""}`}
                    aria-hidden
                  >
                    {isUnassigned ? "?" : profileInitials(a.name)}
                  </span>
                  <div className="lead-profile-title">
                    <span className="lead-profile-eyebrow">{isUnassigned ? "Leads" : "Agente"}</span>
                    <strong>{a.name}</strong>
                    <span className="lead-agent-sub">
                      {a.profiles.length === 1 ? "Perfil" : "Perfiles"}:{" "}
                      {a.profiles.map((x) => x.name).join(" · ")}
                    </span>
                  </div>
                  <div className="lead-profile-stats">
                    <span className="status-pill new">
                      {agentSection.count} {agentSection.count === 1 ? "lead" : "leads"}
                    </span>
                    <span className={`status-pill ${a.done ? "done" : "pending"}`}>
                      {a.done}/{a.total} realizados
                    </span>
                  </div>
                </header>
                <div className="lead-agent-body">{profileGroups}</div>
              </section>
            );
          })
        )}
      </div>

      {active && (
        <div
          className="drawer-overlay open"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelected(null);
          }}
        >
          <LeadDetailPanel
            lead={active}
            dayNumber={activeDayNumber}
            canManageLeads={canManageLeads}
            canEdit={canEditLead(active.id)}
            agentLabel={agentName(active.assignedAgentId)}
            reportTargetLabel={reportTargetName(active.reportTargetId)}
            onClose={() => setSelected(null)}
            onStatusChange={(status) => {
              updateLead(active.id, { status });
              if (status === "realizado") {
                toast(`#${activeDayNumber || active.leadNumber} marcado como realizado`);
                if (listMode === "en_curso") setSelected(null);
              }
            }}
            onAssign={(agentId) => {
              assignLead(active.id, agentId);
              toast(agentId ? `Asignado a ${agentName(agentId)}` : "Lead sin asignar");
            }}
            onReportTargetChange={(targetId) => {
              if (setLeadsReportTarget([active.id], targetId)) {
                toast(targetId ? `Movido al perfil ${reportTargetName(targetId)}` : "Lead sin perfil de reporte");
              }
            }}
            onNotesChange={(notes) => updateLead(active.id, { notes })}
            agents={agents}
            reportTargets={assignableReportTargets(active.reportTargetId)}
          />
        </div>
      )}

      <GlobalTotalBadge
        label={canManageLeads ? "Total leads global" : "Tus leads (global)"}
        total={globalLeadTotal}
      />
    </>
  );
}

export function ImportView({ onDone }: { onDone: () => void }) {
  const { addLeads, upsertLeads, addReportEntries, agents, data } = useStore();
  const { toast } = useToast();
  const [preview, setPreview] = useState<
    {
      firstName: string;
      lastName: string;
      phone: string;
      email: string;
      city: string;
      rawData: Record<string, string>;
      ok: boolean;
    }[]
  >([]);
  const [columnOrder, setColumnOrder] = useState<string[]>([]);
  /** Columnas del archivo original cuando se adaptó al formato Cristhyam. */
  const [adaptedFrom, setAdaptedFrom] = useState<number | null>(null);
  const [fileName, setFileName] = useState("");
  const [assignTo, setAssignTo] = useState("");
  const [targetId, setTargetId] = useState("");
  const [skipDupes, setSkipDupes] = useState(true);
  const [updateExisting, setUpdateExisting] = useState(false);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    if (assignTo || !agents.length) return;
    const kennedy = agents.find((a) => a.username.toLowerCase() === "kennedy");
    setAssignTo(kennedy?.id || agents[0].id);
  }, [agents, assignTo]);

  const validCount = preview.filter((p) => p.ok).length;
  const invalidCount = preview.length - validCount;
  const assignee = agents.find((a) => a.id === assignTo);
  const reportTargets = useMemo(
    () => data.reportTargets.filter((t) => t.active).sort((a, b) => a.name.localeCompare(b.name)),
    [data.reportTargets]
  );
  const target = reportTargets.find((t) => t.id === targetId);
  const targetAssignee = target?.assignedAgentId
    ? data.profiles.find((p) => p.id === target.assignedAgentId)
    : null;

  function onTargetChange(id: string) {
    setTargetId(id);
    // El agente asignado al perfil es quien ve ese reporte: se propone por defecto.
    const next = data.reportTargets.find((t) => t.id === id);
    if (next?.assignedAgentId && agents.some((a) => a.id === next.assignedAgentId)) {
      setAssignTo(next.assignedAgentId);
    }
  }
  const dependentHeaderCount = columnOrder.filter((h) =>
    /dependiente\s*\(|dependiente\s*\d|hijo\s*\d|pareja/i.test(h)
  ).length;

  function parseFile(file: File) {
    const reader = new FileReader();
    reader.onload = async (e) => {
      const dataAb = e.target?.result;
      if (!dataAb) return;
      const XLSX = await import("xlsx");
      const wb = XLSX.read(dataAb, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      // Orden de filas = orden del Excel (arriba → abajo). blankrows omite vacías sin reordenar.
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
        defval: "",
        blankrows: false,
        raw: false,
      });
      const fileHeaders = rows.length ? Object.keys(rows[0]) : [];
      // Cualquier otro formato se adapta al de Cristhyam (el del CRM) antes de guardarse.
      const adapted = adaptRowsToCristhyam(rows, fileHeaders);
      const headers = adapted ? adapted.columns : fileHeaders;
      const mapped = (adapted ? adapted.rows : rows).map((r) => mapLeadFromExcelRow(r));
      setColumnOrder(headers);
      setAdaptedFrom(adapted ? fileHeaders.length : null);
      setPreview(mapped);
      setFileName(file.name);
      const depCols = headers.filter((h) => /dependiente\s*\(|hijo\s*\d|pareja/i.test(h)).length;
      toast(
        adapted
          ? `${mapped.length} filas · formato adaptado al de Cristhyam (${fileHeaders.length} → ${headers.length} columnas)`
          : depCols
            ? `${mapped.length} filas · ${depCols} columnas de dependientes detectadas`
            : `${mapped.length} filas leídas · sin columnas de dependientes por persona`
      );
    };
    reader.readAsArrayBuffer(file);
  }

  /** Publica en el perfil de reporte los leads que entraron como nuevos. */
  async function publishLeadsReport(names: string[]): Promise<string> {
    if (!target || !names.length) return "";
    try {
      const result = await addReportEntries([
        {
          targetId: target.id,
          type: "leads",
          names,
          fileName: fileName ? `${fileStem(fileName)}.txt` : buildReportFileName("leads"),
          fileContent: names.join("\n"),
          reportDate: todayKey(),
        },
      ]);
      if (!result.ok) {
        toast(
          `Leads guardados, pero no se pudo publicar el reporte en ${target.name}: ${result.error || "error desconocido"}`,
          "error"
        );
        return "";
      }
      return ` · reporte publicado en ${target.name}`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "error desconocido";
      toast(`Leads guardados, pero no se pudo publicar el reporte en ${target.name}: ${msg}`, "error");
      return "";
    }
  }

  async function importRows() {
    if (!targetId) {
      toast("Elige el perfil de reporte donde se cargarán estos leads");
      return;
    }
    if (!assignTo) {
      toast("Elige un agente para asignar estos leads");
      return;
    }
      // Mantener Number del Excel; si viene vacío, usar el índice de fila (orden del archivo).
      const payload = preview
      .filter((p) => p.ok)
      .map((r, i) => {
        const rawData = { ...(r.rawData || {}) };
        const numberKey =
          Object.keys(rawData).find((k) => {
            const nk = k
              .trim()
              .toLowerCase()
              .normalize("NFD")
              .replace(/\p{M}/gu, "");
            return nk === "number" || nk === "numero" || nk === "nro" || nk === "#";
          }) || (columnOrder.includes("Number") ? "Number" : null);
        if (numberKey && !(rawData[numberKey] || "").trim()) {
          rawData[numberKey] = String(i + 1);
        }
        return {
          firstName: r.firstName,
          lastName: r.lastName,
          phone: r.phone,
          email: r.email,
          city: r.city,
          source: fileName ? `Excel · ${fileName}` : "Excel",
          status: "nuevo" as const,
          assignedAgentId: assignTo,
          reportTargetId: targetId,
          notes: "",
          rawData,
          columnOrder,
        };
      });

    if (!payload.length) {
      toast("No hay leads válidos para importar");
      return;
    }

    const seenInFile = new Set<string>();
    const unique = payload.filter((r) => {
      const key = leadMatchKey(r);
      if (!key) return true;
      if (seenInFile.has(key)) return false;
      seenInFile.add(key);
      return true;
    });
    const repeatedInFile = payload.length - unique.length;
    const fileNote = repeatedInFile
      ? ` · ${repeatedInFile} repetido${repeatedInFile === 1 ? "" : "s"} en el archivo`
      : "";

    const existingKeys = new Set(
      data.leads.map((l) => leadMatchKey(l)).filter(Boolean) as string[]
    );
    const isNew = (r: (typeof unique)[number]) => {
      const key = leadMatchKey(r);
      return !key || !existingKeys.has(key);
    };
    const personName = (r: (typeof unique)[number]) => `${r.firstName} ${r.lastName}`.trim();

    setImporting(true);
    try {
      if (updateExisting) {
        const { inserted, updated } = await upsertLeads(unique);
        // El reporte de «Leads nuevos» lista solo los que entraron por primera vez.
        const reportNote = await publishLeadsReport(unique.filter(isNew).map(personName));
        toast(
          `${inserted} nuevos · ${updated} actualizados${fileNote} → ${assignee?.fullName || "agente"}${reportNote}`
        );
      } else {
        const rows = skipDupes ? unique.filter(isNew) : unique;
        const existing = unique.length - rows.length;
        if (!rows.length) {
          toast(`Todos los leads ya existían (${existing} omitidos${fileNote})`);
          return;
        }
        const n = await addLeads(rows);
        const reportNote = await publishLeadsReport(rows.map(personName));
        toast(
          `${n} leads importados${existing ? ` · ${existing} ya existían (omitidos)` : ""}${fileNote} → ${assignee?.fullName || "agente"}${reportNote}`
        );
      }
      onDone();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error desconocido";
      toast(`No se pudo guardar en la nube: ${msg}`);
    } finally {
      setImporting(false);
    }
  }

  return (
    <>
      <button className="back-link" type="button" onClick={onDone}>
        {Icons.back} Volver a leads
      </button>
      <div className="eyebrow">Centralización de datos</div>
      <h3
        style={{
          fontFamily: "var(--font-display)",
          fontSize: "1.35rem",
          fontWeight: 700,
          marginBottom: 8,
          letterSpacing: "-0.03em",
        }}
      >
        Importar leads desde Excel
      </h3>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginBottom: 20, maxWidth: 560 }}>
        Sube el archivo completo (ej. 1000 personas), elige el perfil de reporte y el agente. Los
        nombres quedan publicados en «Leads nuevos» de ese perfil y los leads serán visibles solo para
        ese agente. Tú como admin seguirás viéndolos todos.
      </p>

      <div
        className="import-zone"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files[0];
          if (f) parseFile(f);
        }}
        onClick={() => {
          const input = document.createElement("input");
          input.type = "file";
          input.accept = ".xlsx,.xls,.csv";
          input.onchange = () => {
            const f = input.files?.[0];
            if (f) parseFile(f);
          };
          input.click();
        }}
      >
        {Icons.import}
        <h4>Arrastra tu archivo Excel o CSV</h4>
        <p>
          Todo Excel se guarda en el formato Cristhyam: si viene en otro formato, se traduce
          (Nombre Completo, Género, Fecha De Nacimiento… y la familia como Pareja, Hijo 1, Hijo 2) y
          las columnas que ese formato no tiene se descartan. El número (#) es la fila del archivo:
          #1 → #N.
        </p>
      </div>

      {!!preview.length && (
        <>
          <div className="stats-grid" style={{ marginTop: 20, marginBottom: 16 }}>
            <div className="stat-card">
              <div className="stat-value">{preview.length}</div>
              <div className="stat-label">Filas leídas</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{validCount}</div>
              <div className="stat-label">Válidos</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{invalidCount}</div>
              <div className="stat-label">Sin nombre</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{dependentHeaderCount}</div>
              <div className="stat-label">Cols. dependientes</div>
            </div>
          </div>

          {adaptedFrom !== null && (
            <p className="import-adapted-note">
              Formato adaptado al de Cristhyam: {adaptedFrom} columnas del archivo → {columnOrder.length}.
              La vista previa ya muestra cómo quedarán guardados.
            </p>
          )}

          <div className="panel" style={{ padding: 20, marginBottom: 16 }}>
            <h3 style={{ marginBottom: 6 }}>Destino del lote</h3>
            <p style={{ fontSize: "0.86rem", color: "var(--muted)", marginBottom: 14 }}>
              Obligatorio · Los nombres quedan publicados en «Leads nuevos» del perfil de reporte, y
              solo el agente elegido verá estos leads en su pantalla.
            </p>
            <div className="import-destination">
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Perfil de reporte</label>
                <select
                  className="filter-select"
                  style={{ width: "100%" }}
                  value={targetId}
                  onChange={(e) => onTargetChange(e.target.value)}
                >
                  <option value="">Selecciona un perfil…</option>
                  {reportTargets.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Agente que verá los leads</label>
                <select
                  className="filter-select"
                  style={{ width: "100%" }}
                  value={assignTo}
                  onChange={(e) => setAssignTo(e.target.value)}
                >
                  <option value="">Selecciona un agente…</option>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.fullName}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {target && assignTo && target.assignedAgentId !== assignTo && (
              <p className="import-destination-warn">
                {targetAssignee
                  ? `«${target.name}» está asignado a ${targetAssignee.fullName}: ${assignee?.fullName || "el agente elegido"} verá los leads, pero no ese reporte.`
                  : `«${target.name}» no tiene agente asignado: solo el equipo (admin, encargados, nómina) verá el reporte.`}
              </p>
            )}
            {assignee && target && (
              <p style={{ marginTop: 12, fontSize: "0.88rem" }}>
                Se importarán <strong>{validCount}</strong> leads → <strong>{assignee.fullName}</strong>{" "}
                · reporte en <strong>{target.name}</strong>
              </p>
            )}
          </div>

          <div className="panel">
            <div className="panel-head">
              <h3>Vista previa · primeras 10 de {preview.length}</h3>
              {fileName && <span style={{ fontSize: "0.78rem", color: "var(--muted)" }}>{fileName}</span>}
            </div>
            <div className="panel-body">
              <table className="data-table leads-table-wide">
                <thead>
                  <tr>
                    {(columnOrder.length ? columnOrder : ["Nombre", "Teléfono", "Email", "Ciudad"]).map(
                      (col) => (
                        <th key={col}>{col}</th>
                      )
                    )}
                    <th>Validación</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.slice(0, 10).map((r, i) => (
                    <tr key={i}>
                      {(columnOrder.length ? columnOrder : ["Nombre", "Teléfono", "Email", "Ciudad"]).map(
                        (col) => (
                          <td key={col}>
                            {columnOrder.length
                              ? r.rawData[col] || "—"
                              : col === "Nombre"
                                ? `${r.firstName || "(vacío)"} ${r.lastName}`.trim()
                                : col === "Teléfono"
                                  ? r.phone
                                  : col === "Email"
                                    ? r.email
                                    : r.city}
                          </td>
                        )
                      )}
                      <td>
                        <span className={`status-pill ${r.ok ? "closed" : "late"}`}>
                          {r.ok ? "OK" : "Sin nombre"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <p style={{ fontSize: "0.86rem", color: "var(--muted)", margin: "14px 0 10px", maxWidth: 640 }}>
            Columnas de dependientes que el panel lee: {EXPECTED_DEPENDENT_COLUMNS.slice(0, 4).join(", ")},{" "}
            {EXPECTED_DEPENDENT_COLUMNS.slice(4, 8).join(", ")}…
          </p>

          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={updateExisting}
              onChange={(e) => setUpdateExisting(e.target.checked)}
            />
            Actualizar leads ya importados (mismo nombre + teléfono o email) · reasigna al agente elegido
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={skipDupes || updateExisting}
              disabled={updateExisting}
              onChange={(e) => setSkipDupes(e.target.checked)}
            />
            Omitir duplicados (mismo nombre + teléfono o email)
          </label>

          <div style={{ display: "flex", gap: 10, marginTop: 20, flexWrap: "wrap" }}>
            <button className="btn" type="button" onClick={onDone}>
              Cancelar
            </button>
            <button
              className="btn btn-primary-sm"
              type="button"
              onClick={() => void importRows()}
              disabled={!targetId || !assignTo || !validCount || importing}
            >
              {importing ? "Guardando en la nube…" : `Importar ${validCount} leads`}
              {!importing && assignee ? ` → ${assignee.fullName}` : ""}
              {!importing && target ? ` · ${target.name}` : ""}
            </button>
          </div>
        </>
      )}
    </>
  );
}

export type _V = ViewId;
