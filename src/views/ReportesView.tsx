import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useStore, formatDate, formatTime } from "@/lib/store";
import { useToast } from "@/components/Toast";
import { Icons } from "@/components/Icons";
import { DayFolder } from "@/components/DayFolder";
import type { Lead, ReportType, ReportEntry } from "@/lib/types";
import { assignableProfilesForRole, visibleReportTargetsForUser } from "@/lib/reportTargets";
import { ROLE_LABELS } from "@/lib/roles";
import { groupByDay, todayKey, numberItemsInDay, dayKeyFromIso } from "@/lib/dayFolders";
import { GlobalTotalBadge } from "@/components/GlobalTotalBadge";
import { isSupabaseEnabled } from "@/lib/supabase";
import { fetchReportEntryFileContent } from "@/lib/supabase-sync";
import {
  buildReportUploadPreview,
  buildReportTitle,
  getReportManageAccess,
  COLLAPSE_NAME_THRESHOLD,
  downloadReportFile,
  fileStem,
  formatEditCountdown,
  getReportFileKind,
  isPdfDataUrl,
  isPdfFileName,
  isTxtFileName,
  MAX_CONSENT_PDF_BYTES,
  MAX_CONSENT_PDF_BATCH,
  mapPool,
  PDF_READ_CONCURRENCY,
  parseReportNames,
  readFileAsDataUrl,
  readFileAsText,
  refreshPreviewMeta,
  type ReportUploadPreview,
} from "@/lib/reportUpload";
import {
  analyzeConsentLeadDrift,
  leadFullName,
  leadIdsWithCarta,
  normalizePersonName,
} from "@/lib/cartaLeadSync";
import { CartaLinkPicker } from "@/components/CartaLinkPicker";

function ReportEntryCard({
  entry,
  dayNumber,
  typeLabel,
  canDownload,
  viewer,
  realizado,
  onUpdate,
  onDelete,
}: {
  entry: ReportEntry;
  dayNumber: number;
  typeLabel: string;
  canDownload: boolean;
  viewer?: { id: string; role: string; fullName?: string } | null;
  /** Leads nuevos: por cada nombre, si su lead ya está realizado. */
  realizado?: boolean[];
  onUpdate: (
    id: string,
    input: { names: string[]; fileName?: string; fileContent?: string }
  ) => Promise<{ ok: boolean; error?: string }>;
  onDelete: (id: string) => Promise<{ ok: boolean; error?: string }>;
}) {
  const { toast } = useToast();
  const isLong = entry.names.length > COLLAPSE_NAME_THRESHOLD;
  const [expanded, setExpanded] = useState(!isLong);
  const [now, setNow] = useState(Date.now());
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editNames, setEditNames] = useState(entry.names.join("\n"));
  const [editFileName, setEditFileName] = useState(entry.fileName || "");
  const [editFileContent, setEditFileContent] = useState(entry.fileContent);
  const editFileRef = useRef<HTMLInputElement>(null);
  const allowPdfReplace = entry.type === "consent";
  const isConsent = entry.type === "consent";
  const access = getReportManageAccess(entry, viewer, now);
  const canEdit = access.allowed;
  const remainingMs = access.remainingMs;
  const doneCount = realizado ? realizado.filter(Boolean).length : 0;

  useEffect(() => {
    if (!access.allowed) return;
    if (access.unlimited) return;
    if (remainingMs <= 0) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [entry.id, entry.createdAt, access.allowed, access.unlimited, remainingMs > 0]);

  useEffect(() => {
    if (editing) return;
    setEditNames(entry.names.join("\n"));
    setEditFileName(entry.fileName || "");
    setEditFileContent(entry.fileContent);
  }, [entry.names, entry.fileName, entry.fileContent, editing]);

  useEffect(() => {
    if (canEdit) return;
    setEditing(false);
  }, [canEdit]);

  async function startEdit() {
    setEditNames(entry.names.join("\n"));
    setEditFileName(entry.fileName || "");
    let content = entry.fileContent;
    if (
      !content &&
      isSupabaseEnabled &&
      getReportFileKind(entry.fileName, entry.fileContent) === "pdf"
    ) {
      try {
        content = await fetchReportEntryFileContent(entry.id);
      } catch {
        /* keep empty; user can re-upload */
      }
    }
    setEditFileContent(content);
    setEditing(true);
    setExpanded(true);
  }

  function cancelEdit() {
    setEditing(false);
    setEditNames(entry.names.join("\n"));
    setEditFileName(entry.fileName || "");
    setEditFileContent(entry.fileContent);
  }

  async function saveEdit() {
    const names = parseReportNames(editNames);
    if (!names.length) {
      toast("Agrega al menos un nombre");
      return;
    }
    setSaving(true);
    try {
      const result = await onUpdate(entry.id, {
        names,
        fileName: editFileName || entry.fileName,
        fileContent: editFileContent,
      });
      if (!result.ok) {
        toast(result.error || "No se pudo guardar", "error");
        return;
      }
      setEditing(false);
      toast("Corrección guardada en la nube");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    const confirmMsg = isConsent
      ? "¿Eliminar esta carta? Podrás volver a cargarla enseguida."
      : "¿Eliminar este reporte? Esta acción no se puede deshacer.";
    if (!window.confirm(confirmMsg)) return;
    setSaving(true);
    try {
      const result = await onDelete(entry.id);
      if (!result.ok) {
        toast(result.error || "No se pudo eliminar", "error");
        return;
      }
      toast(
        isConsent
          ? "Carta eliminada · ya puedes volver a cargarla"
          : "Reporte eliminado"
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleEditFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    const lower = file.name.toLowerCase();
    if (isPdfFileName(lower)) {
      if (!allowPdfReplace) {
        toast("Los PDF solo se permiten en cartas de consentimiento");
        return;
      }
      if (file.size > MAX_CONSENT_PDF_BYTES) {
        toast("El PDF supera 8 MB. Usa un archivo más liviano.");
        return;
      }
      try {
        const dataUrl = await readFileAsDataUrl(file);
        setEditFileName(file.name);
        setEditFileContent(dataUrl);
        if (!parseReportNames(editNames).length) {
          const stem = fileStem(file.name);
          if (stem) setEditNames(stem);
        }
        toast("PDF listo · se guardará al confirmar");
      } catch {
        toast("No se pudo leer el PDF");
      }
      return;
    }

    if (!isTxtFileName(lower)) {
      toast(allowPdfReplace ? "Solo se aceptan .txt o .pdf" : "Solo se aceptan archivos .txt");
      return;
    }

    try {
      const text = await readFileAsText(file);
      const names = parseReportNames(text);
      if (!names.length) {
        toast("No se encontraron nombres en el archivo");
        return;
      }
      setEditNames(names.join("\n"));
      setEditFileName(file.name);
      setEditFileContent(names.join("\n"));
      toast(`${names.length} nombre${names.length !== 1 ? "s" : ""} cargado${names.length !== 1 ? "s" : ""}`);
    } catch {
      toast("No se pudo leer el archivo");
    }
  }

  async function handleDownload() {
    try {
      let content = entry.fileContent;
      if (!content && isSupabaseEnabled) {
        content = await fetchReportEntryFileContent(entry.id);
      }
      downloadReportFile(entry.fileName!, entry.names, content);
    } catch (err) {
      toast(err instanceof Error ? err.message : "No se pudo descargar");
    }
  }

  return (
    <article className="report-card">
      <div className="report-card-head">
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
          <span className="report-day-number" title={`Reporte #${dayNumber} del día`}>
            #{dayNumber}
          </span>
          <div>
            <div className="report-card-type">{typeLabel}</div>
            <h4>
              {editing
                ? buildReportTitle(entry.type, parseReportNames(editNames).length || entry.names.length)
                : entry.title}
            </h4>
            <div className="report-card-meta">
              Reporte {formatDate(entry.reportDate)} · {formatTime(entry.createdAt)} · cargado por agente{" "}
              <strong>{entry.agentName}</strong>
            </div>
          </div>
        </div>
        <div className="report-card-pills">
          <span className="status-pill closed">
            {(editing ? parseReportNames(editNames).length : entry.names.length) || entry.names.length}{" "}
            nombres
          </span>
          {realizado && !editing && (
            <span className={`status-pill ${doneCount ? "done" : "pending"}`}>
              {doneCount}/{entry.names.length} realizados
            </span>
          )}
        </div>
      </div>

      {canEdit && !editing && (
        <div
          className={`report-edit-bar${isConsent ? " consent" : ""}${access.unlimited ? " admin" : ""}`}
        >
          <span className="report-edit-timer">
            {access.unlimited ? (
              isConsent ? (
                <>
                  Como <strong>admin</strong> puedes corregir o eliminar esta carta en cualquier
                  momento (queda registrado en el historial)
                </>
              ) : (
                <>
                  Como <strong>admin</strong> puedes corregir o eliminar este reporte cuando quieras
                  (queda registrado en el historial)
                </>
              )
            ) : access.reason === "encargado_window" ? (
              isConsent ? (
                <>
                  Como encargado: <strong>{formatEditCountdown(remainingMs)}</strong> para corregir o
                  eliminar esta carta del equipo
                </>
              ) : (
                <>
                  Como encargado: <strong>{formatEditCountdown(remainingMs)}</strong> para corregir o
                  eliminar este reporte del equipo
                </>
              )
            ) : isConsent ? (
              <>
                Si hay un error, tienes <strong>{formatEditCountdown(remainingMs)}</strong> para
                eliminar esta carta y volver a cargarla
              </>
            ) : (
              <>
                Puedes corregir el archivo durante <strong>{formatEditCountdown(remainingMs)}</strong>
              </>
            )}
          </span>
          <div className="report-edit-actions">
            <button
              type="button"
              className="btn-action report-edit-btn"
              onClick={() => void startEdit()}
              disabled={saving}
            >
              {Icons.edit}
              Corregir
            </button>
            <button
              type="button"
              className="btn-action report-delete-btn"
              onClick={() => void handleDelete()}
              disabled={saving}
            >
              {Icons.trash}
              Eliminar
            </button>
          </div>
        </div>
      )}

      {editing ? (
        <div className="report-edit-panel">
          <label className="field-label">Nombres (uno por línea)</label>
          <textarea
            className="report-textarea"
            rows={6}
            value={editNames}
            onChange={(e) => setEditNames(e.target.value)}
          />
          <input
            ref={editFileRef}
            type="file"
            accept={allowPdfReplace ? ".txt,.pdf,text/plain,application/pdf" : ".txt,text/plain"}
            hidden
            onChange={(e) => void handleEditFile(e)}
          />
          <div className="report-edit-file-row">
            <span className="report-edit-file-name">
              {editFileName || "Sin archivo"}
              {isPdfDataUrl(editFileContent) ? " · PDF" : ""}
            </span>
            <button type="button" className="btn-text" onClick={() => editFileRef.current?.click()}>
              Reemplazar archivo
            </button>
          </div>
          <div className="report-edit-save-row">
            <button type="button" className="btn-action" onClick={cancelEdit} disabled={saving}>
              Cancelar
            </button>
            <button
              type="button"
              className="btn btn-primary-sm"
              onClick={() => void saveEdit()}
              disabled={saving}
            >
              {saving ? "Guardando…" : "Guardar corrección"}
            </button>
          </div>
        </div>
      ) : isLong && !expanded ? (
        <div className="report-names-collapsed">
          <span className="report-names-collapsed-count">
            {entry.names.length} personas registradas
            {realizado ? ` · ${doneCount} realizado${doneCount === 1 ? "" : "s"}` : ""}
          </span>
          <button type="button" className="report-expand-btn" onClick={() => setExpanded(true)}>
            Ver más {Icons.chevronDown}
          </button>
        </div>
      ) : (
        <>
          <ol className="report-names">
            {entry.names.map((n, i) => (
              <li key={i} className={realizado?.[i] ? "is-done" : undefined}>
                <span className="name-idx">{i + 1}.</span> {n}
                {realizado?.[i] && <span className="name-done">✓ realizado</span>}
              </li>
            ))}
          </ol>
          {isLong && (
            <button type="button" className="report-expand-btn" onClick={() => setExpanded(false)}>
              Ver menos {Icons.chevronUp}
            </button>
          )}
        </>
      )}

      {entry.fileName && canDownload && !editing && (
        <div className="report-file">
          {Icons.file}
          <div>
            <strong>{entry.fileName}</strong>
            <span>
              subido por {entry.agentName}
              {getReportFileKind(entry.fileName, entry.fileContent) === "pdf" ? " · PDF listo" : ""}
            </span>
          </div>
          <button type="button" className="btn-action report-download-btn" onClick={handleDownload}>
            {Icons.download}
            Descargar
          </button>
        </div>
      )}
    </article>
  );
}

function ReportAssignmentsPanel() {
  const { data, viewUser, assignReportTarget, createReportTarget } = useStore();
  const { toast } = useToast();
  const [newName, setNewName] = useState("");
  const [newAssignee, setNewAssignee] = useState("");

  if (!viewUser) return null;

  const assignees = assignableProfilesForRole(data.profiles, viewUser.role);
  const targets = [...data.reportTargets]
    .filter((t) => t.active)
    .sort((a, b) => a.name.localeCompare(b.name));

  function profileName(id: string | null | undefined) {
    if (!id) return "—";
    return data.profiles.find((p) => p.id === id)?.fullName || "—";
  }

  function onAssign(targetId: string, value: string) {
    const agentId = value || null;
    const res = assignReportTarget(targetId, agentId);
    if (!res.ok) {
      toast(res.error || "No se pudo asignar", "error");
      return;
    }
    toast(agentId ? `Asignado a ${profileName(agentId)}` : "Asignación quitada");
  }

  function onCreate() {
    const res = createReportTarget(newName, newAssignee || null);
    if (!res.ok) {
      toast(res.error || "No se pudo crear", "error");
      return;
    }
    toast(`Nombre «${newName.trim()}» creado`);
    setNewName("");
    setNewAssignee("");
  }

  return (
    <>
      <div className="week-strip">
        <div>
          <div className="label">Asignación de reportes</div>
          <div className="value">
            {viewUser.role === "admin"
              ? "Puedes asignar nombres de reporte a cualquier usuario activo"
              : "Puedes asignar a agentes, encargados y nómina — no al administrador"}
          </div>
        </div>
      </div>

      <div className="panel" style={{ padding: 20, marginBottom: 20 }}>
        <h3 style={{ marginBottom: 6 }}>Crear nombre de reporte</h3>
        <p style={{ fontSize: "0.86rem", color: "var(--muted)", marginBottom: 14 }}>
          Ej. Cynthia, Cristhyam… Luego asígnalo a quien cargará los archivos.
        </p>
        <div className="report-assign-create">
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Nombre</label>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Nombre del reporte"
            />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Asignar a (opcional)</label>
            <select
              className="filter-select"
              style={{ width: "100%" }}
              value={newAssignee}
              onChange={(e) => setNewAssignee(e.target.value)}
            >
              <option value="">Sin asignar aún</option>
              {assignees.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.fullName} ({ROLE_LABELS[p.role]})
                </option>
              ))}
            </select>
          </div>
          <button className="btn btn-primary-sm" type="button" onClick={onCreate} disabled={!newName.trim()}>
            {Icons.plus} Crear
          </button>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h3>Nombres y asignaciones</h3>
          <span style={{ fontSize: "0.78rem", color: "var(--muted)" }}>{targets.length} activos</span>
        </div>
        <div className="panel-body">
          <table className="data-table">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Asignado a</th>
                <th>Cargas</th>
              </tr>
            </thead>
            <tbody>
              {targets.map((t) => {
                const entries = data.reportEntries.filter((e) => e.targetId === t.id).length;
                return (
                  <tr key={t.id}>
                    <td>
                      <span className="cell-name">{t.name}</span>
                      <div className="cell-sub">#{t.slug}</div>
                    </td>
                    <td>
                      <select
                        className="filter-select"
                        style={{ minWidth: 200 }}
                        value={t.assignedAgentId || ""}
                        onChange={(e) => onAssign(t.id, e.target.value)}
                      >
                        <option value="">Sin asignar</option>
                        {assignees.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.fullName} ({ROLE_LABELS[p.role]})
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>{entries ? `${entries} archivo(s)` : "—"}</td>
                  </tr>
                );
              })}
              {!targets.length && (
                <tr>
                  <td colSpan={3} style={{ textAlign: "center", color: "var(--muted)" }}>
                    No hay nombres de reporte
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel" style={{ marginTop: 20, padding: 20 }}>
        <h3 style={{ marginBottom: 10, fontSize: "0.95rem" }}>Resumen por persona</h3>
        <div className="report-assign-summary">
          {assignees.map((p) => {
            const assigned = targets.filter((t) => t.assignedAgentId === p.id);
            return (
              <div key={p.id} className="report-assign-summary-card">
                <strong>{p.fullName}</strong>
                <span>{ROLE_LABELS[p.role]}</span>
                <p>
                  {assigned.length
                    ? assigned.map((t) => t.name).join(", ")
                    : "Sin reportes asignados"}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

export function ReportesView({ onOpenTarget }: { onOpenTarget: (id: string) => void }) {
  const { data, viewUser, canAssignReports } = useStore();
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"nombres" | "asignaciones">("nombres");

  const list = useMemo(() => {
    if (!viewUser) return [];
    const visible = visibleReportTargetsForUser(data.reportTargets, viewUser.id, viewUser.role);
    return visible.filter(
      (t) =>
        !q || t.name.toLowerCase().includes(q.toLowerCase()) || t.slug.includes(q.toLowerCase())
    );
  }, [data.reportTargets, q, viewUser]);

  return (
    <>
      {canAssignReports && (
        <div className="tabs" style={{ marginBottom: 20 }}>
          <button
            type="button"
            className={`tab${tab === "nombres" ? " active" : ""}`}
            onClick={() => setTab("nombres")}
          >
            Nombres
          </button>
          <button
            type="button"
            className={`tab${tab === "asignaciones" ? " active" : ""}`}
            onClick={() => setTab("asignaciones")}
          >
            Asignaciones
          </button>
        </div>
      )}

      {tab === "asignaciones" && canAssignReports ? (
        <ReportAssignmentsPanel />
      ) : (
        <>
      <div className="week-strip">
        <div>
          <div className="label">Nombres de reporte</div>
          <div className="value">Cada nombre recibe cargas de los agentes · Leads y cartas</div>
        </div>
        <div className="live-dot">{list.length} nombres activos</div>
      </div>
      <div className="model-legend">
        <div className="legend-item">
          <span className="legend-dot target" />
          <strong>Nombre</strong> — a quien se le hace el reporte (Cristhyam, Adriana…)
        </div>
        <div className="legend-item">
          <span className="legend-dot agent" />
          <strong>Agente</strong> — quien carga el archivo (Gustavvohp, Anjerr…)
        </div>
      </div>
      <div className="toolbar">
        <div className="search-box">
          {Icons.search}
          <input placeholder="Buscar nombre de reporte..." value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      <div className="report-agents-grid">
        {list.map((t) => {
          const entries = data.reportEntries.filter((e) => e.targetId === t.id);
          const leads = entries.filter((e) => e.type === "leads").length;
          const consent = entries.filter((e) => e.type === "consent").length;
          const agents = [...new Set(entries.map((e) => e.agentName))];
          const assignee = t.assignedAgentId
            ? data.profiles.find((p) => p.id === t.assignedAgentId)?.fullName
            : null;
          const last = entries[0]?.reportDate;
          return (
            <button key={t.id} className="report-agent-card" onClick={() => onOpenTarget(t.id)}>
              <div className="report-agent-top">
                <div className="avatar">
                  {t.name
                    .split(" ")
                    .map((w) => w[0])
                    .join("")
                    .slice(0, 2)
                    .toUpperCase()}
                </div>
                <div className="report-agent-info">
                  <strong>{t.name}</strong>
                  <span className="slug">#{t.slug}</span>
                </div>
                <span className="report-lock">📁</span>
              </div>
              <div className="report-agent-meta">
                {assignee && <span>Asignado a: {assignee}</span>}
                <span>{agents.length ? `Cargado por: ${agents.join(", ")}` : "Aún sin cargas"}</span>
                <span>Último: {last ? formatDate(last) : "—"}</span>
              </div>
              <div className="report-subclass-pills">
                <span className="subclass-pill leads">
                  {Icons.leads} Leads <b>{leads}</b>
                </span>
                <span className="subclass-pill consent">
                  {Icons.consent} Cartas <b>{consent}</b>
                </span>
              </div>
            </button>
          );
        })}
      </div>
        </>
      )}
    </>
  );
}

type SyncCheck = {
  id: string;
  label: string;
  done: number;
  total: number;
  okText: string;
  detail?: ReactNode;
};

function SyncHealthCard() {
  const { data, syncHealth } = useStore();
  const [open, setOpen] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const leadsWithCarta = useMemo(() => leadIdsWithCarta(data.reportEntries), [data.reportEntries]);
  const realizadosConCarta = useMemo(
    () => data.leads.filter((l) => l.status === "realizado" && leadsWithCarta.has(l.id)).length,
    [data.leads, leadsWithCarta]
  );
  if (!syncHealth) return null;

  const groups = syncHealth.nameDuplicateGroups;
  const realDupes = groups.filter((g) => !g.distinctPeople);
  const homonyms = groups.filter((g) => g.distinctPeople);
  const homonymsPending = homonyms.filter((g) => !g.leadIds.every((id) => leadsWithCarta.has(id)));
  const linked = syncHealth.consentTotal - syncHealth.cartasSinVinculo - syncHealth.cartasVinculoRoto;

  const checks: SyncCheck[] = [
    {
      id: "linked",
      label: "Cartas vinculadas a su lead",
      done: linked,
      total: syncHealth.consentTotal,
      okText: "Todas las cartas tienen lead",
      detail:
        syncHealth.unrepairedUnlinked.length > 0 ? (
          <ul>
            {syncHealth.unrepairedUnlinked.slice(0, 8).map((c) => (
              <li key={c.entryId}>
                {c.personKey} · {c.reason}
                <CartaLinkPicker entryId={c.entryId} personKey={c.personKey} />
              </li>
            ))}
          </ul>
        ) : undefined,
    },
    {
      id: "realizados",
      label: "Leads realizados con carta",
      done: realizadosConCarta,
      total: syncHealth.realizadosTotal,
      okText: "Cada realizado tiene su carta",
    },
    {
      id: "dupes",
      label: "Nombres repetidos verificados",
      done: groups.length - realDupes.length,
      total: groups.length,
      okText: "Ningún duplicado real",
      detail:
        realDupes.length > 0 ? (
          <ul>
            {realDupes.map((g) => (
              <li key={g.name}>
                {g.name} · #{g.leadNumbers.join(", #")} · mismo teléfono
              </li>
            ))}
          </ul>
        ) : undefined,
    },
    {
      id: "homonyms",
      label: "Homónimos resueltos",
      done: homonyms.length - homonymsPending.length,
      total: homonyms.length,
      okText: homonyms.length
        ? `${homonyms.length} homónimo(s), cada uno con su carta`
        : "Sin homónimos",
      detail: homonyms.length ? (
        <ul>
          {homonyms.map((g) => (
            <li key={g.name}>
              {g.name} ·{" "}
              {g.leadIds.map((id, i) => {
                const n = data.leads.find((l) => l.id === id)?.leadNumber ?? g.leadNumbers[i];
                const ok = leadsWithCarta.has(id);
                return (
                  <span key={id} className={`sync-tag ${ok ? "ok" : "warn"}`}>
                    #{n} {ok ? "✓" : "sin carta"}
                  </span>
                );
              })}
            </li>
          ))}
        </ul>
      ) : undefined,
    },
  ];

  const pct = (c: SyncCheck) => (c.total ? Math.round((c.done / c.total) * 100) : 100);
  const overall = Math.round(checks.reduce((s, c) => s + pct(c), 0) / checks.length);
  const allOk = checks.every((c) => c.done >= c.total);

  return (
    <div className={`sync-card ${allOk ? "is-ok" : "is-warn"}`}>
      <div className="sync-card-head">
        <div className="sync-card-title">
          <span className="sync-dot" />
          <div>
            <strong>{allOk ? "Todo en orden" : "Atención requerida"}</strong>
            <span>
              Cartas {syncHealth.consentTotal} · Realizados {syncHealth.realizadosTotal}
            </span>
          </div>
        </div>
        <div className="sync-score">{overall}%</div>
      </div>
      <div className="sync-bar sync-bar-lg">
        <div className="sync-bar-fill" style={{ width: mounted ? `${overall}%` : 0 }} />
      </div>

      <div className="sync-checks">
        {checks.map((c) => {
          const ok = c.done >= c.total;
          const isOpen = open === c.id;
          return (
            <div key={c.id} className={`sync-check ${ok ? "ok" : "warn"}${isOpen ? " open" : ""}`}>
              <button
                type="button"
                className="sync-check-row"
                onClick={() => setOpen(isOpen ? null : c.id)}
                aria-expanded={isOpen}
              >
                <span className="sync-check-icon">{ok ? "✓" : "!"}</span>
                <span className="sync-check-label">
                  {c.label}
                  <small>{ok ? c.okText : `${c.total - c.done} por revisar`}</small>
                </span>
                <span className="sync-check-count">
                  {c.done}/{c.total}
                </span>
                <span className="sync-chevron">▾</span>
              </button>
              <div className="sync-bar">
                <div className="sync-bar-fill" style={{ width: mounted ? `${pct(c)}%` : 0 }} />
              </div>
              {isOpen && (
                <div className="sync-check-detail">
                  {c.detail || <p>{ok ? `✓ ${c.okText}.` : "Sin detalle disponible."}</p>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ReporteDetalleView({
  targetId,
  onBack,
  initialTab = "leads",
}: {
  targetId: string;
  onBack: () => void;
  initialTab?: ReportType;
}) {
  const {
    data,
    viewUser: user,
    canDownloadReports,
    addReportEntries,
    updateReportEntry,
    deleteReportEntry,
    refreshReports,
    syncHealth,
  } = useStore();
  const { toast } = useToast();
  const [tab, setTab] = useState<ReportType>(initialTab);
  useEffect(() => {
    setTab(initialTab);
  }, [targetId, initialTab]);
  const [previews, setPreviews] = useState<ReportUploadPreview[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [lastSyncNote, setLastSyncNote] = useState<string | null>(null);
  const [readingFiles, setReadingFiles] = useState(false);
  const [openDays, setOpenDays] = useState<Set<string>>(() => new Set([todayKey()]));
  const fileInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    void refreshReports();
  }, [targetId, refreshReports]);

  const entries = useMemo(
    () =>
      data.reportEntries
        .filter((e) => e.targetId === targetId && e.type === tab)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [data.reportEntries, targetId, tab]
  );

  const dayBuckets = useMemo(() => {
    // Carpetas por día de reporte (negocio), no por cuándo se insertó en la nube
    const buckets = groupByDay(entries, (e) => e.reportDate || e.createdAt);
    return buckets.map((b) => ({
      ...b,
      items: numberItemsInDay(b.items, (e) => `${e.createdAt}|${e.id}`),
    }));
  }, [entries]);

  useEffect(() => {
    setOpenDays((prev) => {
      const today = todayKey();
      if (prev.has(today)) return prev;
      const next = new Set(prev);
      next.add(today);
      return next;
    });
  }, [dayBuckets]);

  const leadsCount = data.reportEntries.filter((e) => e.targetId === targetId && e.type === "leads").length;
  const consentCount = data.reportEntries.filter((e) => e.targetId === targetId && e.type === "consent").length;
  const globalTabTotal = tab === "leads" ? leadsCount : consentCount;
  const typeLabel = tab === "leads" ? "Leads Nuevos" : "Cartas de Consentimiento";
  const acceptFiles = tab === "consent" ? ".txt,.pdf,text/plain,application/pdf" : ".txt,text/plain";
  const allowMulti = tab === "consent";
  const canSeeDrift =
    user?.role === "admin" || user?.role === "encargado" || user?.role === "nomina";
  const drift = useMemo(() => {
    if (tab !== "consent" || !canSeeDrift) return null;
    return analyzeConsentLeadDrift(data.reportEntries, data.leads, targetId, {
      profiles: data.profiles,
      historyEvents: data.historyEvents,
    });
  }, [tab, canSeeDrift, data.reportEntries, data.leads, data.profiles, data.historyEvents, targetId]);
  const leadsByName = useMemo(() => {
    const map = new Map<string, Lead[]>();
    for (const l of data.leads) {
      const key = leadFullName(l);
      if (!key) continue;
      const list = map.get(key);
      if (list) list.push(l);
      else map.set(key, [l]);
    }
    return map;
  }, [data.leads]);

  /** Estado de cada nombre de un reporte de leads (se marca solo al subir su carta). */
  function realizadoFlags(entry: ReportEntry): boolean[] | undefined {
    if (entry.type !== "leads") return undefined;
    return entry.names.map((name) => {
      const candidates = leadsByName.get(normalizePersonName(name)) || [];
      // Homónimos: se prefiere el lead creado el mismo día del reporte.
      const sameDay = candidates.filter((l) => dayKeyFromIso(l.createdAt) === entry.reportDate);
      const pool = sameDay.length ? sameDay : candidates;
      return pool.length > 0 && pool.every((l) => l.status === "realizado");
    });
  }

  const editHint =
    user?.role === "admin"
      ? tab === "consent"
        ? "Como administrador puedes corregir o eliminar cualquier carta cuando haga falta; cada cambio queda en el historial."
        : "Como administrador puedes corregir o eliminar cualquier reporte cuando haga falta; cada cambio queda en el historial."
      : user?.role === "encargado"
        ? tab === "consent"
          ? "Tras publicar (tuya o del equipo), tienes 5 minutos para eliminar o corregir. El administrador no tiene ese límite."
          : "Tras publicar (tuyo o del equipo), tienes 5 minutos para corregir o eliminar. El administrador no tiene ese límite."
        : tab === "consent"
          ? "Tras publicar, tienes 5 minutos para eliminar una carta con error y volver a cargarla (o corregir el archivo)."
          : "Se guarda en la base de datos. Si te equivocas de archivo, tienes 5 minutos para corregirlo o eliminarlo.";
  const preview = previews.length === 1 ? previews[0] : null;
  const isPdfBatch = previews.length > 1;

  const target = data.reportTargets.find((t) => t.id === targetId);
  if (!target) {
    return (
      <div className="empty-state">
        <h4>Nombre no encontrado</h4>
        <button className="btn" onClick={onBack}>
          Volver
        </button>
      </div>
    );
  }

  if (
    user?.role === "agente" &&
    (!target.assignedAgentId || target.assignedAgentId !== user.id)
  ) {
    return (
      <div className="empty-state">
        <h4>Sin acceso a este reporte</h4>
        <p>Este nombre de reporte está asignado a otro agente.</p>
        <button className="btn" onClick={onBack}>
          Volver
        </button>
      </div>
    );
  }

  const assignee = target.assignedAgentId
    ? data.profiles.find((p) => p.id === target.assignedAgentId)?.fullName
    : null;

  function handleTabChange(next: ReportType) {
    setTab(next);
    setPreviews([]);
    setOpenDays(new Set([todayKey()]));
  }

  function toggleDay(dayKey: string) {
    setOpenDays((prev) => {
      const next = new Set(prev);
      if (next.has(dayKey)) next.delete(dayKey);
      else next.add(dayKey);
      return next;
    });
  }

  async function buildPdfPreview(file: File): Promise<ReportUploadPreview | null> {
    if (file.size > MAX_CONSENT_PDF_BYTES) {
      toast(`«${file.name}» supera 8 MB y se omitió`);
      return null;
    }
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const stem = fileStem(file.name);
      const names = stem ? [stem] : [];
      return buildReportUploadPreview(names, "consent", file.name, new Date(), {
        fileKind: "pdf",
        fileContent: dataUrl,
      });
    } catch {
      toast(`No se pudo leer «${file.name}»`);
      return null;
    }
  }

  async function processReportFiles(fileList: File[]) {
    const files = [...fileList].filter(Boolean);
    if (!files.length) return;

    if (tab === "consent") {
      const pdfs = files.filter((f) => isPdfFileName(f.name));
      const txts = files.filter((f) => isTxtFileName(f.name));

      if (pdfs.length) {
        const capped = pdfs.slice(0, MAX_CONSENT_PDF_BATCH);
        if (pdfs.length > MAX_CONSENT_PDF_BATCH) {
          toast(`Máximo ${MAX_CONSENT_PDF_BATCH} PDF por carga. Se tomaron los primeros.`);
        }
        setReadingFiles(true);
        try {
          const results = await mapPool(capped, PDF_READ_CONCURRENCY, (file) => buildPdfPreview(file));
          const built = results.filter((item): item is ReportUploadPreview => !!item);
          if (!built.length) {
            toast("No se pudo preparar ningún PDF");
            return;
          }
          setPreviews(built);
          if (txts.length) {
            toast(`${built.length} PDF listos · se ignoraron ${txts.length} .txt`);
          } else {
            toast(
              built.length === 1
                ? "PDF listo · revisa o edita el nombre"
                : `${built.length} PDF listos · cada uno se publicará como carta`
            );
          }
        } finally {
          setReadingFiles(false);
        }
        return;
      }

      if (txts.length > 1) {
        toast("Varios .txt no soportados: usa varios PDF, o un solo .txt");
      }
    }

    const file = files[0];
    const lower = file.name.toLowerCase();

    if (isPdfFileName(lower)) {
      toast("Los PDF solo se permiten en Cartas de consentimiento");
      return;
    }

    if (!isTxtFileName(lower)) {
      toast(tab === "consent" ? "Solo se aceptan .txt o .pdf" : "Solo se aceptan archivos .txt");
      return;
    }

    try {
      const text = await readFileAsText(file);
      const names = parseReportNames(text);
      if (!names.length) {
        toast("No se encontraron nombres en el archivo");
        return;
      }
      setPreviews([buildReportUploadPreview(names, tab, file.name)]);
      toast(`${names.length} nombre${names.length !== 1 ? "s" : ""} detectado${names.length !== 1 ? "s" : ""}`);
    } catch {
      toast("No se pudo leer el archivo");
    }
  }

  function onFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const list = e.target.files ? [...e.target.files] : [];
    if (list.length) void processReportFiles(list);
    e.target.value = "";
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const list = e.dataTransfer.files ? [...e.dataTransfer.files] : [];
    if (list.length) void processReportFiles(list);
  }

  function updatePreviewNames(index: number, text: string) {
    const names = parseReportNames(text);
    setPreviews((prev) =>
      prev.map((item, i) => (i === index ? refreshPreviewMeta(item, tab, names) : item))
    );
  }

  function removePreview(index: number) {
    setPreviews((prev) => prev.filter((_, i) => i !== index));
  }

  async function submit() {
    if (!previews.length) {
      toast("Sube al menos un archivo");
      return;
    }
    const invalid = previews.find((p) => !p.names.length);
    if (invalid) {
      toast(
        invalid.fileKind === "pdf"
          ? `Agrega un nombre para «${invalid.sourceFile}»`
          : "Sube un archivo .txt con al menos un nombre"
      );
      return;
    }

    const total = previews.length;
    const firstKind = previews[0].fileKind;
    const day = todayKey();
    const baseMs = Date.now();
    setPublishing(true);
    try {
      const result = await addReportEntries(
        previews.map((item, i) => ({
          targetId,
          type: tab,
          names: item.names,
          fileName: item.fileName,
          fileContent:
            item.fileKind === "pdf" && item.fileContent ? item.fileContent : item.names.join("\n"),
          createdAt: new Date(baseMs + i).toISOString(),
          reportDate: day,
        }))
      );
      await refreshReports();
      setOpenDays((prev) => {
        const next = new Set(prev);
        next.add(day);
        return next;
      });
      if (result.ok) {
        setPreviews([]);
        const parts: string[] = [];
        if (result.inserted === 1) {
          parts.push(
            firstKind === "pdf"
              ? `Carta PDF #1 guardada · ${target!.name}`
              : `Reporte guardado · ${target!.name}`
          );
        } else if (result.inserted > 1) {
          parts.push(
            `${result.inserted} cartas (#1 → #${result.inserted}) · ${target!.name}`
          );
        } else if ((result.skippedDuplicates || 0) > 0) {
          parts.push(result.error || "No se insertaron cartas nuevas");
        }
        if (result.markedRealizado) {
          parts.push(
            `${result.markedRealizado} lead${result.markedRealizado === 1 ? "" : "s"} → realizado`
          );
        }
        if (result.tasksProgressed) {
          parts.push(
            `progreso tarea${result.tasksProgressed === 1 ? "" : "s"} ×${result.tasksProgressed}`
          );
        }
        if (result.tasksAutoCompleted) {
          parts.push(
            `${result.tasksAutoCompleted} tarea${result.tasksAutoCompleted === 1 ? "" : "s"} auto-completada${result.tasksAutoCompleted === 1 ? "" : "s"}`
          );
        }
        if (result.skippedDuplicates) {
          parts.push(
            `${result.skippedDuplicates} duplicada${result.skippedDuplicates === 1 ? "" : "s"} omitida${result.skippedDuplicates === 1 ? "" : "s"}`
          );
        }
        if (result.error) {
          parts.push(result.error);
        }
        const dupNote = result.duplicateDetails?.length
          ? ` Omitidas por duplicado: ${result.duplicateDetails.join(" · ")}.`
          : "";
        const c = result.syncCounts;
        if (c && (c.ambiguous || c.unmatched || c.out_of_scope)) {
          const attn: string[] = [];
          if (c.unmatched) attn.push(`${c.unmatched} sin lead`);
          if (c.ambiguous) attn.push(`${c.ambiguous} dudosas`);
          if (c.out_of_scope) attn.push(`${c.out_of_scope} de otro agente`);
          parts.push(`revisar: ${attn.join(", ")}`);
          setLastSyncNote(
            `Sync del lote: ${c.auto} auto · ${c.already_realizado} ya realizados · ${attn.join(" · ")}. Las dudosas/sin match NO se marcaron solos.${dupNote}`
          );
        } else {
          setLastSyncNote(
            result.inserted
              ? `Lote OK: ${result.inserted} carta${result.inserted === 1 ? "" : "s"} · ${result.markedRealizado || 0} realizados automáticos.${dupNote}`
              : dupNote.trim() || null
          );
        }
        toast(parts.join(" · ") || "Listo");
      } else if (result.inserted > 0) {
        setPreviews([]);
        toast(`Se guardaron ${result.inserted} de ${total}. ${result.error || ""}`);
      } else {
        toast(`No se pudo guardar en la nube: ${result.error || "error desconocido"}`);
      }
    } finally {
      setPublishing(false);
    }
  }

  return (
    <>
      <button className="back-link" onClick={onBack}>
        {Icons.back} Volver a nombres
      </button>
      <div className="profile-hero report-hero">
        <div className="avatar" style={{ width: 64, height: 64, fontSize: "1.3rem" }}>
          {target.name.slice(0, 2).toUpperCase()}
        </div>
        <div>
          <div className="eyebrow" style={{ marginBottom: 4 }}>
            Nombre de reporte
          </div>
          <h2>{target.name}</h2>
          <div className="sub">#{target.slug}</div>
          {assignee && (
            <div className="sub" style={{ marginTop: 4 }}>
              Asignado a: <strong>{assignee}</strong>
            </div>
          )}
          <div className="sub" style={{ marginTop: 6 }}>
            Los agentes cargan archivos aquí
            {user?.role === "agente" ? ` · Tú: ${user.fullName}` : ""}
          </div>
        </div>
      </div>

      <div className="report-tabs">
        <button className={`report-tab${tab === "leads" ? " active" : ""}`} onClick={() => handleTabChange("leads")}>
          {Icons.leads} Leads nuevos <span className="tab-count">{leadsCount}</span>
        </button>
        <button
          className={`report-tab${tab === "consent" ? " active" : ""}`}
          onClick={() => handleTabChange("consent")}
        >
          {Icons.consent} Cartas de consentimiento <span className="tab-count">{consentCount}</span>
        </button>
      </div>

      {lastSyncNote && tab === "consent" && (
        <div className="consent-sync-banner">
          <div>
            <strong>Resumen del último lote</strong>
            <p>{lastSyncNote}</p>
          </div>
          <button className="btn-text" type="button" onClick={() => setLastSyncNote(null)}>
            Cerrar
          </button>
        </div>
      )}

      {syncHealth && tab === "consent" && <SyncHealthCard />}

      {drift && tab === "consent" && (drift.cartasSinLead.length > 0 || drift.realizadosSinCarta.length > 0) && (
        <div className="consent-drift-panel">
          <strong>Alerta de desfase · {target.name}</strong>
          <p className="consent-drift-meta">
            Cartas {drift.consentTotal} · Realizados {drift.realizadosTotal}
            {drift.cartasSinVinculo ? ` · ${drift.cartasSinVinculo} sin vínculo guardado` : ""}
          </p>
          {drift.cartasSinLead.length > 0 && (
            <div className="consent-drift-block">
              <span>
                {drift.cartasSinLead.length} carta{drift.cartasSinLead.length === 1 ? "" : "s"} sin lead
              </span>
              <ul>
                {drift.cartasSinLead.slice(0, 8).map((c) => (
                  <li key={c.entryId}>
                    {c.personKey}
                    {c.fileName ? ` · ${c.fileName}` : ""}
                    <CartaLinkPicker entryId={c.entryId} personKey={c.personKey} />
                  </li>
                ))}
                {drift.cartasSinLead.length > 8 && (
                  <li>… y {drift.cartasSinLead.length - 8} más</li>
                )}
              </ul>
            </div>
          )}
          {drift.realizadosSinCarta.length > 0 && (
            <div className="consent-drift-block">
              <span>
                {drift.realizadosSinCarta.length} realizado{drift.realizadosSinCarta.length === 1 ? "" : "s"} sin carta
              </span>
              <ul>
                {drift.realizadosSinCarta.slice(0, 8).map((l) => {
                  const who =
                    l.markedBy
                      ? `marcado por ${l.markedBy}`
                      : l.assignedAgent
                        ? `asignado a ${l.assignedAgent}`
                        : null;
                  return (
                    <li key={l.leadId}>
                      #{l.leadNumber} {l.name}
                      {who ? ` · ${who}` : ""}
                    </li>
                  );
                })}
                {drift.realizadosSinCarta.length > 8 && (
                  <li>… y {drift.realizadosSinCarta.length - 8} más</li>
                )}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="report-layout">
        <div className="report-feed">
          {!entries.length ? (
            <div className="empty-state">
              <h4>Sin reportes aún</h4>
              <p>
                Nadie ha cargado {typeLabel.toLowerCase()} para <strong>{target.name}</strong>.
              </p>
            </div>
          ) : (
            <div className="day-folders">
              {dayBuckets.map((bucket) => (
                <DayFolder
                  key={bucket.key}
                  dayKey={bucket.key}
                  label={bucket.label}
                  count={bucket.items.length}
                  countLabel={bucket.items.length === 1 ? "reporte" : "reportes"}
                  open={openDays.has(bucket.key)}
                  isToday={bucket.isToday}
                  onToggle={() => toggleDay(bucket.key)}
                  subtitle={
                    bucket.items.length
                      ? `Numeración del día · #1 → #${bucket.items.length}`
                      : `Carpeta automática · ${bucket.key}`
                  }
                >
                  {bucket.items.map((r) => (
                    <ReportEntryCard
                      key={r.id}
                      entry={r}
                      dayNumber={r.dayNumber}
                      typeLabel={typeLabel}
                      canDownload={canDownloadReports}
                      viewer={user}
                      realizado={realizadoFlags(r)}
                      onUpdate={updateReportEntry}
                      onDelete={deleteReportEntry}
                    />
                  ))}
                </DayFolder>
              ))}
            </div>
          )}
        </div>

        <aside className="report-upload-panel">
          <h3>Publicar reporte</h3>
          <p className="upload-hint">
            Tipo: <strong>{typeLabel}</strong>
          </p>
          <p className="upload-hint" style={{ marginTop: -8 }}>
            Se publicará como: <strong>{user?.fullName}</strong>
          </p>
          <p className="upload-hint report-edit-hint">{editHint}</p>
          <input
            ref={fileInputRef}
            type="file"
            accept={acceptFiles}
            multiple={allowMulti}
            hidden
            onChange={onFileInput}
          />

          {!previews.length ? (
            <>
              <label className="field-label">
                {tab === "consent"
                  ? "Archivos .txt o PDF de cartas (varios PDF a la vez)"
                  : "Archivo .txt del reporte"}
              </label>
              <div
                className={`report-file-drop${dragOver ? " drag-over" : ""}${readingFiles ? " busy" : ""}`}
                role="button"
                tabIndex={0}
                onClick={() => !readingFiles && fileInputRef.current?.click()}
                onKeyDown={(e) => e.key === "Enter" && !readingFiles && fileInputRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (!readingFiles) setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={onDrop}
              >
                <span className="report-file-drop-icon">{Icons.import}</span>
                <strong>
                  {readingFiles
                    ? "Leyendo PDF en paralelo…"
                    : tab === "consent"
                      ? "Arrastra uno o varios PDF / .txt"
                      : "Arrastra tu .txt aquí"}
                </strong>
                <span>{readingFiles ? "Un momento" : "o haz clic para seleccionar"}</span>
                <span className="report-file-drop-hint">
                  {tab === "consent"
                    ? `Hasta ${MAX_CONSENT_PDF_BATCH} PDF · máx. 8 MB c/u · carga rápida en paralelo`
                    : "Un nombre por línea · fecha y hora se completan solas"}
                </span>
              </div>
            </>
          ) : isPdfBatch ? (
            <div className="report-upload-preview">
              <div className="report-preview-head">
                <span className="report-preview-badge">
                  {previews.length} PDF · vista previa
                </span>
                <button type="button" className="btn-text" onClick={() => setPreviews([])}>
                  Cambiar archivos
                </button>
              </div>
              <p className="upload-hint" style={{ margin: 0 }}>
                Cada PDF se publica como una carta en la carpeta de <strong>hoy</strong>, numeradas
                en orden (#1, #2, #3…). Puedes editar el nombre o quitar archivos.
              </p>
              <div className="report-pdf-batch">
                {previews.map((item, index) => (
                  <div key={`${item.sourceFile}-${index}`} className="report-pdf-batch-item">
                    <div className="report-pdf-batch-top">
                      <div className="report-preview-file" style={{ margin: 0, flex: 1 }}>
                        {Icons.file}
                        <div>
                          <strong>{item.fileName}</strong>
                          <span>Origen: {item.sourceFile}</span>
                        </div>
                      </div>
                      <button
                        type="button"
                        className="btn-text"
                        onClick={() => removePreview(index)}
                        disabled={publishing}
                      >
                        Quitar
                      </button>
                    </div>
                    <label className="field-label">Nombre / personas</label>
                    <textarea
                      className="report-textarea"
                      rows={2}
                      value={item.names.join("\n")}
                      onChange={(e) => updatePreviewNames(index, e.target.value)}
                      placeholder="Uno por línea"
                      disabled={publishing}
                    />
                  </div>
                ))}
              </div>
              <button
                className="btn btn-primary-sm"
                style={{ width: "100%", justifyContent: "center", marginTop: 4 }}
                onClick={() => void submit()}
                disabled={publishing}
              >
                {publishing
                  ? `Guardando ${previews.length} cartas…`
                  : `Publicar ${previews.length} cartas en ${target.name}`}
              </button>
            </div>
          ) : preview ? (
            <div className="report-upload-preview">
              <div className="report-preview-head">
                <span className="report-preview-badge">
                  Vista previa{preview.fileKind === "pdf" ? " · PDF" : ""}
                </span>
                <button type="button" className="btn-text" onClick={() => setPreviews([])}>
                  Cambiar archivo
                </button>
              </div>

              <div className="report-preview-file">
                {Icons.file}
                <div>
                  <strong>{preview.fileName}</strong>
                  <span>Origen: {preview.sourceFile}</span>
                </div>
              </div>

              <div className="report-preview-meta">
                <div className="report-preview-stat">
                  <span>Fecha</span>
                  <strong>{preview.reportDate}</strong>
                </div>
                <div className="report-preview-stat">
                  <span>Hora</span>
                  <strong>{preview.reportTime}</strong>
                </div>
                <div className="report-preview-stat highlight">
                  <span>Personas</span>
                  <strong>{preview.names.length}</strong>
                </div>
              </div>

              <div className="report-preview-title">
                <span>Título del reporte</span>
                <strong>{preview.title}</strong>
              </div>

              {preview.fileKind === "pdf" && (
                <p className="upload-hint" style={{ marginTop: 12, marginBottom: 0 }}>
                  El PDF se guardará listo para descarga. Confirma los nombres de las personas incluidas.
                </p>
              )}

              <label className="field-label" style={{ marginTop: 14 }}>
                Nombres ({preview.names.length}) — editable
              </label>
              <textarea
                className="report-textarea"
                rows={6}
                value={preview.names.join("\n")}
                onChange={(e) => updatePreviewNames(0, e.target.value)}
                placeholder={
                  preview.fileKind === "pdf" ? "Uno por línea · personas de las cartas" : undefined
                }
              />

              <button
                className="btn btn-primary-sm"
                style={{ width: "100%", justifyContent: "center", marginTop: 12 }}
                onClick={() => void submit()}
                disabled={publishing}
              >
                {publishing ? "Guardando en la nube…" : `Publicar en ${target.name}`}
              </button>
            </div>
          ) : null}
        </aside>
      </div>

      <GlobalTotalBadge
        label={tab === "leads" ? "Total leads nuevos (global)" : "Total cartas (global)"}
        total={globalTabTotal}
      />
    </>
  );
}
