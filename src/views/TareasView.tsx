import { useMemo, useState } from "react";
import { useStore, formatDate } from "@/lib/store";
import { useToast } from "@/components/Toast";
import { Icons } from "@/components/Icons";
import type { TaskGoalType, WeeklyTask } from "@/lib/types";
import { WEEK_START, formatWeekRange } from "@/lib/seed";
import {
  OPERATIVE_WEEK_START,
  isHistoricWeek,
  taskEffectiveWeekStart,
  tasksInWeek,
} from "@/lib/weekCalendar";

function addDaysKey(dayKey: string, days: number): string {
  const d = new Date(`${dayKey}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function weekdayLabel(dayKey: string): string {
  if (!dayKey) return "";
  const label = new Date(`${dayKey}T12:00:00`).toLocaleDateString("es", { weekday: "long" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function TaskRow({
  t,
  isStaff,
  agentName,
  readOnly,
  onToggle,
  onProgress,
  onValidate,
  onEdit,
  onDelete,
}: {
  t: WeeklyTask;
  isStaff: boolean;
  agentName: (id: string) => string;
  readOnly?: boolean;
  onToggle?: () => void;
  onProgress?: () => void;
  onValidate?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const editBtn = onEdit && (
    <button className="btn-action" onClick={onEdit}>
      Editar
    </button>
  );
  const deleteBtn = onDelete && (
    <button className="btn-action danger" onClick={onDelete} title="Eliminar tarea vencida">
      Eliminar
    </button>
  );
  return (
    <div className="task-row">
      <div
        className={`task-check${t.status === "completada" ? " done" : ""}`}
        title={
          readOnly
            ? onDelete
              ? "Historial · puedes eliminar pendientes vencidas"
              : "Historial · solo lectura"
            : t.proofsValidated
              ? "Validada · bloqueada"
              : t.goalType === "consent_realizado"
                ? `Meta ${t.goalCurrent}/${t.goalTarget}`
                : "Clic para completar (requiere evidencia)"
        }
        onClick={readOnly ? undefined : onToggle}
        style={readOnly ? { cursor: "default", opacity: 0.85 } : undefined}
      >
        {Icons.check}
      </div>
      <div className="task-info">
        <div className="title">{t.title}</div>
        <div className="meta">
          {isStaff ? `Asignado: ${agentName(t.assignedTo)} · ` : ""}
          Vence {formatDate(t.dueDate)} · {t.status}
          {t.progressNotes.length > 0 && ` · ${t.progressNotes.length} avance(s)`}
          {t.status === "completada" &&
            ` · pruebas ${t.proofsValidated ? "validadas ✓" : "sin validar"}`}
        </div>
        {t.goalType === "consent_realizado" && t.goalTarget > 0 && (
          <div className="meta" style={{ marginTop: 6 }}>
            Meta cartas→realizado:{" "}
            <strong>
              {t.goalCurrent}/{t.goalTarget}
            </strong>
            <div
              style={{
                marginTop: 6,
                height: 6,
                borderRadius: 99,
                background: "var(--line)",
                overflow: "hidden",
                maxWidth: 220,
              }}
            >
              <div
                style={{
                  width: `${Math.min(100, Math.round((t.goalCurrent / t.goalTarget) * 100))}%`,
                  height: "100%",
                  background: "var(--teal)",
                }}
              />
            </div>
          </div>
        )}
        {t.progressNotes.slice(-2).map((p, i) => (
          <div key={i} className="meta" style={{ marginTop: 4 }}>
            {p.notes}
          </div>
        ))}
      </div>
      {!readOnly && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          {editBtn}
          {t.status !== "completada" && !t.proofsValidated && (
            <button className="btn-action" onClick={onProgress}>
              Registrar progreso
            </button>
          )}
          {t.status === "completada" && !t.proofsValidated && isStaff && (
            <button className="btn-action" onClick={onValidate}>
              Validar pruebas
            </button>
          )}
          {t.status === "completada" && t.proofsValidated && (
            <span className="status-pill closed">Validada</span>
          )}
          {t.status === "completada" && !t.proofsValidated && !isStaff && (
            <span className="status-pill pending">Esperando validación</span>
          )}
        </div>
      )}
      {readOnly && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end", alignItems: "center" }}>
          {editBtn}
          {deleteBtn}
          <span className={`status-pill ${t.status === "completada" ? "closed" : "pending"}`}>
            {t.status === "completada" ? "Completada" : "Pendiente"}
          </span>
        </div>
      )}
    </div>
  );
}

export function TareasView() {
  const {
    data,
    viewUser: user,
    isStaff,
    canAssignTasks,
    agents,
    addTask,
    editTask,
    deleteTask,
    updateTaskStatus,
    addTaskProgress,
    validateTaskProofs,
    weekNumber,
    isSundayAssign,
  } = useStore();
  const { toast } = useToast();
  const [tab, setTab] = useState<"current" | "history">("current");
  const [histWeek, setHistWeek] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [goalType, setGoalType] = useState<TaskGoalType>("none");
  const [goalTarget, setGoalTarget] = useState("20");
  const [progressFor, setProgressFor] = useState<string | null>(null);
  const [progressNotes, setProgressNotes] = useState("");
  const [markDone, setMarkDone] = useState(false);
  const [editing, setEditing] = useState<{
    id: string;
    title: string;
    description: string;
    assignedTo: string;
    dueDate: string;
    goalType: TaskGoalType;
    goalTarget: string;
  } | null>(null);

  function openEdit(t: WeeklyTask) {
    setEditing({
      id: t.id,
      title: t.title,
      description: t.description || "",
      assignedTo: t.assignedTo,
      dueDate: t.dueDate || "",
      goalType: t.goalType || "none",
      goalTarget: String(t.goalTarget || 20),
    });
  }

  function saveEdit() {
    if (!editing) return;
    const target = editing.goalType === "consent_realizado" ? Number(editing.goalTarget) : 0;
    if (editing.goalType === "consent_realizado" && (!Number.isFinite(target) || target < 1)) {
      toast("Indica una meta numérica (mínimo 1)");
      return;
    }
    const result = editTask(editing.id, {
      title: editing.title,
      description: editing.description,
      assignedTo: editing.assignedTo,
      dueDate: editing.dueDate,
      goalType: editing.goalType,
      goalTarget: target,
    });
    if (!result.ok) {
      toast(result.error || "No se pudo editar", "error");
      return;
    }
    setEditing(null);
    toast("Tarea actualizada");
  }

  const weekStart = data.currentWeekStart || WEEK_START;
  const weekFriday = addDaysKey(weekStart, 4);
  const progressTask = progressFor ? data.tasks.find((t) => t.id === progressFor) : undefined;
  const progressIsGoal = progressTask?.goalType === "consent_realizado";

  function closeProgress() {
    setProgressFor(null);
    setProgressNotes("");
    setMarkDone(false);
  }

  const list = useMemo(() => {
    if (!user) return [];
    const weekTasks = tasksInWeek(data.tasks, weekStart);
    if (isStaff) return weekTasks;
    return weekTasks.filter((t) => t.assignedTo === user.id);
  }, [data.tasks, isStaff, user, weekStart]);

  const historyWeeks = useMemo(() => {
    const map = new Map<string, { weekStart: string; count: number }>();
    for (const t of data.tasks) {
      const ws = taskEffectiveWeekStart(t);
      if (ws >= weekStart) continue;
      const row = map.get(ws) || { weekStart: ws, count: 0 };
      row.count += 1;
      map.set(ws, row);
    }
    return [...map.values()].sort((a, b) => b.weekStart.localeCompare(a.weekStart));
  }, [data.tasks, weekStart]);

  const selectedHistWeek = histWeek || historyWeeks[0]?.weekStart || "";

  const histTasks = useMemo(() => {
    if (!user || !selectedHistWeek) return [];
    const weekTasks = tasksInWeek(data.tasks, selectedHistWeek);
    if (isStaff) return weekTasks;
    return weekTasks.filter((t) => t.assignedTo === user.id);
  }, [data.tasks, isStaff, user, selectedHistWeek]);

  const histDone = histTasks.filter((t) => t.status === "completada");
  const histPend = histTasks.filter((t) => t.status !== "completada");

  function agentName(id: string) {
    return data.profiles.find((p) => p.id === id)?.fullName || "—";
  }

  function createTask() {
    if (!title.trim() || !assignedTo || !dueDate) {
      toast("Completa título, agente y fecha", "error");
      return;
    }
    if (dueDate < weekStart || dueDate > weekFriday) {
      toast("La fecha debe ser de lunes a viernes de esta semana", "error");
      return;
    }
    const target = goalType === "consent_realizado" ? Number(goalTarget) : 0;
    if (goalType === "consent_realizado" && (!Number.isFinite(target) || target < 1)) {
      toast("Indica una meta numérica (mínimo 1)", "error");
      return;
    }
    addTask({
      title: title.trim(),
      description,
      assignedTo,
      dueDate,
      goalType,
      goalTarget: target,
    });
    setTitle("");
    setDescription("");
    setDueDate("");
    setGoalType("none");
    setGoalTarget("20");
    setShowForm(false);
    toast(
      goalType === "consent_realizado"
        ? `Tarea asignada · meta ${target} cartas→realizado`
        : "Tarea asignada"
    );
  }

  function toggleStatus(taskId: string, current: string) {
    const next = current === "completada" ? "pendiente" : "completada";
    const result = updateTaskStatus(taskId, next);
    if (!result.ok) {
      toast(result.error || "No se pudo cambiar el estado", "error");
      return;
    }
    toast(next === "completada" ? "Tarea completada" : "Tarea reactivada");
  }

  return (
    <>
      <div className="week-strip">
        <div>
          <div className="label">Tareas · Semana {weekNumber}</div>
          <div className="value">
            Lun–Vie {formatWeekRange(weekStart)} · historial &lt; {OPERATIVE_WEEK_START}
          </div>
        </div>
        {canAssignTasks && tab === "current" && (
          <button className="btn btn-primary-sm" onClick={() => setShowForm((s) => !s)}>
            {Icons.plus} Nueva tarea
          </button>
        )}
      </div>

      <div className="report-tabs payment-agent-tabs">
        <button
          className={`report-tab${tab === "current" ? " active" : ""}`}
          onClick={() => setTab("current")}
        >
          Semana actual
        </button>
        <button
          className={`report-tab${tab === "history" ? " active" : ""}`}
          onClick={() => {
            setTab("history");
            if (!histWeek && historyWeeks[0]) setHistWeek(historyWeeks[0].weekStart);
          }}
        >
          Historial
          {historyWeeks.length > 0 && <span className="tab-count">{historyWeeks.length}</span>}
        </button>
      </div>

      {tab === "current" && isSundayAssign && canAssignTasks && (
        <div className="panel" style={{ marginBottom: 16, padding: "14px 18px" }}>
          <strong style={{ display: "block", marginBottom: 4 }}>Domingo · día de asignación</strong>
          <span style={{ color: "var(--muted)", fontSize: "0.88rem", lineHeight: 1.45 }}>
            Asigna las tareas de lun a vie. El jueves noche se piden datos si lun–jue están OK; el
            viernes se paga si toda la semana está completa.
          </span>
        </div>
      )}

      {tab === "current" && showForm && canAssignTasks && (
        <div className="panel" style={{ marginBottom: 20, padding: 22 }}>
          <h3 style={{ marginBottom: 14 }}>Nueva tarea semanal</h3>
          <div className="field">
            <label>Título</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Subir 20 cartas de consentimiento"
            />
          </div>
          <div className="field">
            <label>Descripción</label>
            <input value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="field">
            <label>Asignar a</label>
            <select
              className="filter-select"
              style={{ width: "100%" }}
              value={assignedTo}
              onChange={(e) => setAssignedTo(e.target.value)}
            >
              <option value="">Selecciona un agente…</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.fullName}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Fecha límite (lun–vie de esta semana)</label>
            <input
              type="date"
              min={weekStart}
              max={weekFriday}
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
            <div className="sub" style={{ marginTop: 6 }}>
              {dueDate ? <strong>{weekdayLabel(dueDate)} · </strong> : null}
              Usa el día correcto: lun–jue cuentan para datos; viernes cuenta para el pago.
            </div>
          </div>
          <div className="field">
            <label>Tipo de meta</label>
            <select
              className="filter-select"
              style={{ width: "100%" }}
              value={goalType}
              onChange={(e) => setGoalType(e.target.value as TaskGoalType)}
            >
              <option value="none">Manual (avance + «Marcar como terminada»)</option>
              <option value="consent_realizado">Automática: cartas con lead → realizado</option>
            </select>
          </div>
          {goalType === "consent_realizado" && (
            <div className="field">
              <label>Meta (cantidad)</label>
              <input
                type="number"
                min={1}
                value={goalTarget}
                onChange={(e) => setGoalTarget(e.target.value)}
                placeholder="20"
              />
              <div className="sub" style={{ marginTop: 6 }}>
                Cada carta cargada que marque un lead como realizado suma +1 automáticamente.
              </div>
            </div>
          )}
          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn" onClick={() => setShowForm(false)}>
              Cancelar
            </button>
            <button className="btn btn-primary-sm" onClick={createTask}>
              Asignar tarea
            </button>
          </div>
        </div>
      )}

      {tab === "current" ? (
        <div className="panel">
          <div className="panel-head">
            <h3>{isStaff ? "Tareas de esta semana" : "Mis tareas de esta semana"}</h3>
          </div>
          <div className="task-grid">
            {list.map((t) => (
              <TaskRow
                key={t.id}
                t={t}
                isStaff={isStaff}
                agentName={agentName}
                onToggle={() => toggleStatus(t.id, t.status)}
                onProgress={() => setProgressFor(t.id)}
                onValidate={async () => {
                  const res = await validateTaskProofs(t.id, true);
                  if (!res.ok) toast(res.error || "No se validaron las pruebas", "error");
                  else toast("Pruebas validadas · tarea bloqueada");
                }}
                onEdit={canAssignTasks ? () => openEdit(t) : undefined}
              />
            ))}
            {!list.length && (
              <div className="empty-state">
                Semana limpia. {canAssignTasks ? "Asigna las nuevas tareas del equipo." : "Sin tareas asignadas."}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="panel">
          <div
            className="panel-head"
            style={{ flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}
          >
            <div>
              <h3>Historial de semanas</h3>
              <div className="meta" style={{ fontSize: "0.8rem", color: "var(--muted)", marginTop: 4 }}>
                Semanas anteriores a la actual (incluye &lt; {OPERATIVE_WEEK_START})
                {canAssignTasks
                  ? " · puedes eliminar pendientes vencidas"
                  : " · solo lectura"}
              </div>
            </div>
            {historyWeeks.length > 0 && (
              <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: "0.75rem", fontWeight: 700, color: "var(--muted)" }}>
                Semana
                <select
                  className="filter-select"
                  value={selectedHistWeek}
                  onChange={(e) => setHistWeek(e.target.value)}
                >
                  {historyWeeks.map((w) => (
                    <option key={w.weekStart} value={w.weekStart}>
                      {formatWeekRange(w.weekStart)}
                      {isHistoricWeek(w.weekStart) ? " · pre-corte" : ""} · {w.count} tareas
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          {!historyWeeks.length ? (
            <div className="empty-state">
              <h4>Sin historial todavía</h4>
              <p>Al cerrar semanas (o con datos previos al {OPERATIVE_WEEK_START}), aparecerán aquí.</p>
            </div>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 0,
              }}
              className="task-hist-split"
            >
              <div style={{ borderRight: "1px solid var(--line)" }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    padding: "12px 16px",
                    borderBottom: "1px solid var(--line)",
                    background: "var(--line-soft)",
                  }}
                >
                  <strong style={{ fontSize: "0.88rem" }}>Completadas</strong>
                  <span className="status-pill closed">{histDone.length}</span>
                </div>
                <div className="task-grid">
                  {histDone.map((t) => (
                    <TaskRow
                      key={t.id}
                      t={t}
                      isStaff={isStaff}
                      agentName={agentName}
                      readOnly
                      onEdit={canAssignTasks ? () => openEdit(t) : undefined}
                    />
                  ))}
                  {!histDone.length && <div className="empty-state">Ninguna completada</div>}
                </div>
              </div>
              <div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    padding: "12px 16px",
                    borderBottom: "1px solid var(--line)",
                    background: "var(--line-soft)",
                  }}
                >
                  <strong style={{ fontSize: "0.88rem" }}>Pendientes / no hechas</strong>
                  <span className="status-pill pending">{histPend.length}</span>
                </div>
                <div className="task-grid">
                  {histPend.map((t) => (
                    <TaskRow
                      key={t.id}
                      t={t}
                      isStaff={isStaff}
                      agentName={agentName}
                      readOnly
                      onEdit={canAssignTasks ? () => openEdit(t) : undefined}
                      onDelete={
                        canAssignTasks
                          ? async () => {
                              if (
                                !confirm(
                                  `¿Eliminar la tarea vencida «${t.title}»?\nAsignada a ${agentName(t.assignedTo)} · vence ${formatDate(t.dueDate)}`
                                )
                              ) {
                                return;
                              }
                              const res = await deleteTask(t.id);
                              if (!res.ok) toast(res.error || "No se pudo eliminar", "error");
                              else toast("Tarea eliminada");
                            }
                          : undefined
                      }
                    />
                  ))}
                  {!histPend.length && <div className="empty-state">Sin pendientes</div>}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {progressFor && (
        <div
          className="drawer-overlay open"
          onClick={(e) => e.target === e.currentTarget && closeProgress()}
        >
          <div className="drawer">
            <div className="drawer-head">
              <h3>Registrar progreso</h3>
              <button className="icon-btn" onClick={closeProgress}>
                ✕
              </button>
            </div>
            <div className="drawer-body">
              <label className="field-label">Notas de avance</label>
              <textarea
                className="report-textarea"
                rows={5}
                value={progressNotes}
                onChange={(e) => setProgressNotes(e.target.value)}
                placeholder="Ej: Subí el lote de la mañana."
              />
              {progressIsGoal ? (
                <div className="sub" style={{ marginTop: 8 }}>
                  Tarea de meta: se completa sola al llegar a {progressTask?.goalTarget} cartas.
                </div>
              ) : (
                <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, cursor: "pointer" }}>
                  <input type="checkbox" checked={markDone} onChange={(e) => setMarkDone(e.target.checked)} />
                  <span>Marcar como terminada</span>
                </label>
              )}
            </div>
            <div className="drawer-actions">
              <button
                className="btn btn-primary-sm"
                onClick={() => {
                  const result = addTaskProgress(progressFor, progressNotes, !progressIsGoal && markDone);
                  if (!result.ok) {
                    toast(result.error || "No se pudo guardar", "error");
                    return;
                  }
                  closeProgress();
                  toast(result.autoCompleted ? "Avance guardado · tarea terminada" : "Progreso registrado");
                }}
              >
                Guardar
              </button>
              <button className="btn" onClick={closeProgress}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {editing && canAssignTasks && (
        <div
          className="drawer-overlay open"
          onClick={(e) => e.target === e.currentTarget && setEditing(null)}
        >
          <div className="drawer">
            <div className="drawer-head">
              <h3>Editar tarea</h3>
              <button className="icon-btn" onClick={() => setEditing(null)}>
                ✕
              </button>
            </div>
            <div className="drawer-body">
              <div className="field">
                <label>Título</label>
                <input
                  value={editing.title}
                  onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                />
              </div>
              <div className="field">
                <label>Descripción</label>
                <input
                  value={editing.description}
                  onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                />
              </div>
              <div className="field">
                <label>Asignar a</label>
                <select
                  className="filter-select"
                  style={{ width: "100%" }}
                  value={editing.assignedTo}
                  onChange={(e) => setEditing({ ...editing, assignedTo: e.target.value })}
                >
                  {!agents.some((a) => a.id === editing.assignedTo) && (
                    <option value={editing.assignedTo}>{agentName(editing.assignedTo)}</option>
                  )}
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.fullName}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Fecha límite</label>
                <input
                  type="date"
                  value={editing.dueDate}
                  onChange={(e) => setEditing({ ...editing, dueDate: e.target.value })}
                />
              </div>
              <div className="field">
                <label>Tipo de meta</label>
                <select
                  className="filter-select"
                  style={{ width: "100%" }}
                  value={editing.goalType}
                  onChange={(e) =>
                    setEditing({ ...editing, goalType: e.target.value as TaskGoalType })
                  }
                >
                  <option value="none">Manual (avance + «Marcar como terminada»)</option>
                  <option value="consent_realizado">Automática: cartas con lead → realizado</option>
                </select>
              </div>
              {editing.goalType === "consent_realizado" && (
                <div className="field">
                  <label>Meta (cantidad)</label>
                  <input
                    type="number"
                    min={1}
                    value={editing.goalTarget}
                    onChange={(e) => setEditing({ ...editing, goalTarget: e.target.value })}
                  />
                </div>
              )}
            </div>
            <div className="drawer-actions">
              <button className="btn btn-primary-sm" onClick={saveEdit}>
                Guardar cambios
              </button>
              <button className="btn" onClick={() => setEditing(null)}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @media (max-width: 800px) {
          .task-hist-split {
            grid-template-columns: 1fr !important;
          }
          .task-hist-split > div:first-child {
            border-right: 0 !important;
            border-bottom: 1px solid var(--line);
          }
        }
      `}</style>
    </>
  );
}
