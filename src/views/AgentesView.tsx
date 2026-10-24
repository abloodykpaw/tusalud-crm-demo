import { useStore } from "@/lib/store";
import type { ViewId } from "@/lib/types";

export function AgentesView({
  onOpenAgent,
}: {
  onOpenAgent: (id: string) => void;
}) {
  const { agents, getAgentStats, viewUser: user, isStaff } = useStore();

  const list = isStaff ? agents : agents.filter((a) => a.id === user?.id);

  return (
    <>
      <div className="week-strip">
        <div>
          <div className="label">Perfiles de agentes</div>
          <div className="value">Leads asignados, tareas y avance semanal</div>
        </div>
      </div>
      <div className="agent-cards">
        {list.map((a) => {
          const s = getAgentStats(a.id);
          return (
            <button key={a.id} className="agent-card" onClick={() => onOpenAgent(a.id)}>
              <div className="agent-card-top">
                <div className="avatar">
                  {a.fullName
                    .split(" ")
                    .map((w) => w[0])
                    .join("")
                    .slice(0, 2)
                    .toUpperCase()}
                </div>
                <div>
                  <h4>{a.fullName}</h4>
                  <span>{a.email}</span>
                </div>
              </div>
              <div className="agent-metrics">
                <div>
                  <div className="num">{s.leads}</div>
                  <div className="lbl">Leads</div>
                </div>
                <div>
                  <div className="num">{s.closed}</div>
                  <div className="lbl">Cerrados</div>
                </div>
                <div>
                  <div className="num">{s.progress}%</div>
                  <div className="lbl">Tareas</div>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {isStaff && (
        <div className="panel" style={{ marginTop: 20 }}>
          <div className="panel-head">
            <h3>Detalle</h3>
          </div>
          <div className="panel-body">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Agente</th>
                  <th>Leads</th>
                  <th>Tareas</th>
                  <th>Progreso</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {agents.map((a) => {
                  const s = getAgentStats(a.id);
                  return (
                    <tr key={a.id} onClick={() => onOpenAgent(a.id)}>
                      <td>
                        <span className="cell-name">{a.fullName}</span>
                        <div className="cell-sub">{a.email}</div>
                      </td>
                      <td>{s.leads}</td>
                      <td>
                        {s.tasksDone}/{s.tasksTotal}
                      </td>
                      <td>
                        <div className="progress-wrap">
                          <div className="progress-track">
                            <div className="progress-fill" style={{ width: `${s.progress}%` }} />
                          </div>
                          <span className="progress-text">{s.progress}%</span>
                        </div>
                      </td>
                      <td>
                        <span className="status-pill closed">{a.status}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

export function AgenteDetalleView({
  agentId,
  onBack,
  onNavigate,
}: {
  agentId: string;
  onBack: () => void;
  onNavigate: (v: ViewId) => void;
}) {
  const { data, getAgentStats, isStaff } = useStore();
  const agent = data.profiles.find((p) => p.id === agentId);
  if (!agent) {
    return (
      <div className="empty-state">
        <h4>Agente no encontrado</h4>
        <button className="btn" onClick={onBack}>
          Volver
        </button>
      </div>
    );
  }

  const s = getAgentStats(agentId);
  const leads = data.leads.filter((l) => l.assignedAgentId === agentId);
  const tasks = data.tasks.filter((t) => t.assignedTo === agentId);
  const reports = data.reportEntries.filter((e) => e.uploadedBy === agentId);

  return (
    <>
      {isStaff && (
        <button className="back-link" onClick={onBack}>
          ← Volver a agentes
        </button>
      )}
      <div className="profile-hero">
        <div className="avatar" style={{ width: 72, height: 72, fontSize: "1.5rem" }}>
          {agent.fullName
            .split(" ")
            .map((w) => w[0])
            .join("")
            .slice(0, 2)
            .toUpperCase()}
        </div>
        <div>
          <h2>{agent.fullName}</h2>
          <div className="sub">
            {agent.email} · Agente · {agent.status}
          </div>
          <div className="profile-stats">
            <div>
              Leads: <strong>{s.leads}</strong>
            </div>
            <div>
              Cerrados: <strong>{s.closed}</strong>
            </div>
            <div>
              Avance: <strong>{s.progress}%</strong>
            </div>
            <div>
              Reportes cargados: <strong>{reports.length}</strong>
            </div>
          </div>
        </div>
      </div>

      <div className="grid-2">
        <div className="panel">
          <div className="panel-head">
            <h3>Tareas</h3>
            <span className="link" onClick={() => onNavigate("tareas")}>
              Ir a tareas →
            </span>
          </div>
          <div className="task-grid">
            {tasks.map((t) => (
              <div key={t.id} className="task-row">
                <div className={`task-check${t.status === "completada" ? " done" : ""}`}>
                  {t.status === "completada" ? "✓" : ""}
                </div>
                <div className="task-info">
                  <div className="title">{t.title}</div>
                  <div className="meta">{t.status}</div>
                </div>
              </div>
            ))}
            {!tasks.length && <div className="empty-state">Sin tareas</div>}
          </div>
        </div>
        <div className="panel">
          <div className="panel-head">
            <h3>Leads asignados</h3>
          </div>
          <div className="panel-body">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((l) => (
                  <tr key={l.id}>
                    <td>
                      {l.firstName} {l.lastName}
                    </td>
                    <td>
                      <span className="status-pill new">{l.status}</span>
                    </td>
                  </tr>
                ))}
                {!leads.length && (
                  <tr>
                    <td colSpan={2} style={{ textAlign: "center", color: "var(--muted)" }}>
                      Sin leads
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="panel" style={{ marginTop: 20 }}>
        <div className="panel-head">
          <h3>Reportes cargados por este agente</h3>
        </div>
        <div className="panel-body">
          <table className="data-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Nombre destino</th>
                <th>Tipo</th>
                <th>Cantidad</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((r) => {
                const target = data.reportTargets.find((t) => t.id === r.targetId);
                return (
                  <tr key={r.id}>
                    <td>{r.reportDate}</td>
                    <td>{target?.name || "—"}</td>
                    <td>{r.type === "leads" ? "Leads" : "Cartas"}</td>
                    <td>{r.names.length}</td>
                  </tr>
                );
              })}
              {!reports.length && (
                <tr>
                  <td colSpan={4} style={{ textAlign: "center", color: "var(--muted)" }}>
                    Aún no ha cargado reportes
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
