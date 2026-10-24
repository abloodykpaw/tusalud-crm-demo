import { useStore, formatDate } from "@/lib/store";
import { Icons } from "@/components/Icons";
import type { ViewId } from "@/lib/types";
import { ROLE_LABELS } from "@/lib/roles";
import { tasksInWeek } from "@/lib/weekCalendar";

export function DashboardView({ onNavigate }: { onNavigate: (v: ViewId, opts?: { agentId?: string }) => void }) {
  const { viewUser: user, data, agents, isStaff, getAgentStats, weekNumber, currentWeekStart } = useStore();
  if (!user) return null;
  const weekTasks = tasksInWeek(data.tasks, currentWeekStart);

  if (!isStaff) {
    const myTasks = weekTasks.filter((t) => t.assignedTo === user.id);
    const done = myTasks.filter((t) => t.status === "completada").length;
    const myLeads = data.leads.filter((l) => l.assignedAgentId === user.id);
    const stats = getAgentStats(user.id);
    const initials = user.fullName
      .split(" ")
      .map((w) => w[0])
      .join("")
      .slice(0, 2);

    return (
      <>
        <div className="week-strip">
          <div>
            <div className="label">Operación semanal · {ROLE_LABELS[user.role]}</div>
            <div className="value">Dashboard · {user.fullName}</div>
          </div>
          <div className="live-dot">Operación activa</div>
        </div>
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-card-header">
              <div className="stat-icon teal">{Icons.leads}</div>
            </div>
            <div className="stat-value">{myLeads.length}</div>
            <div className="stat-label">Leads asignados</div>
          </div>
          <div className="stat-card">
            <div className="stat-card-header">
              <div className="stat-icon blue">{Icons.tasks}</div>
            </div>
            <div className="stat-value">{myTasks.length}</div>
            <div className="stat-label">Tareas de la semana</div>
          </div>
          <div className="stat-card">
            <div className="stat-card-header">
              <div className="stat-icon amber">{Icons.check}</div>
            </div>
            <div className="stat-value">{done}</div>
            <div className="stat-label">Tareas hechas</div>
          </div>
          <div className="stat-card">
            <div className="stat-card-header">
              <div className="stat-icon green">{Icons.reports}</div>
            </div>
            <div className="stat-value">{stats.progress}%</div>
            <div className="stat-label">Avance semanal</div>
          </div>
        </div>

        <div className="agent-cards" style={{ marginBottom: 24 }}>
          <button className="agent-card" onClick={() => onNavigate("agente-detalle", { agentId: user.id })}>
            <div className="agent-card-top">
              <div className="avatar">{initials}</div>
              <div>
                <h4>{user.fullName}</h4>
                <span>
                  {stats.leads} leads · {stats.closed} cerrados
                </span>
              </div>
            </div>
            <div className="agent-metrics">
              <div>
                <div className="num">{stats.tasksDone}</div>
                <div className="lbl">Hechas</div>
              </div>
              <div>
                <div className="num">{stats.tasksTotal}</div>
                <div className="lbl">Tareas</div>
              </div>
              <div>
                <div className="num">{stats.progress}%</div>
                <div className="lbl">Avance</div>
              </div>
            </div>
          </button>
        </div>

        <div className="grid-2">
          <div className="panel">
            <div className="panel-head">
              <h3>Mis tareas</h3>
              <span className="link" onClick={() => onNavigate("tareas")}>
                Ver todas →
              </span>
            </div>
            <div className="panel-body">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Tarea</th>
                    <th>Vence</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {myTasks.map((t) => (
                    <tr key={t.id}>
                      <td>
                        <span className="cell-name">{t.title}</span>
                      </td>
                      <td>{formatDate(t.dueDate)}</td>
                      <td>
                        <span className={`status-pill ${t.status === "completada" ? "closed" : "pending"}`}>
                          {t.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="panel">
            <div className="panel-head">
              <h3>Leads recientes</h3>
              <span className="link" onClick={() => onNavigate("leads")}>
                Ver todos →
              </span>
            </div>
            <div className="panel-body">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Lead</th>
                    <th>Ciudad</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {myLeads.slice(0, 5).map((l) => (
                    <tr key={l.id}>
                      <td>
                        <span className="cell-name">
                          {l.firstName} {l.lastName}
                        </span>
                      </td>
                      <td>{l.city}</td>
                      <td>
                        <span className="status-pill new">{l.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </>
    );
  }

  const pendingTasks = weekTasks.filter((t) => t.status !== "completada").length;

  return (
    <>
      <div className="week-strip">
        <div>
          <div className="label">Operación semanal · {ROLE_LABELS[user.role]}</div>
          <div className="value">
            {user.role === "nomina" ? "Vista nómina · pagos y validación" : `Dashboard global · Semana ${weekNumber}`}
          </div>
        </div>
        <div className="live-dot">Operación activa</div>
      </div>
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-card-header">
            <div className="stat-icon teal">{Icons.leads}</div>
          </div>
          <div className="stat-value">{data.leads.length}</div>
          <div className="stat-label">Leads totales</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-header">
            <div className="stat-icon blue">{Icons.agents}</div>
          </div>
          <div className="stat-value">{agents.length}</div>
          <div className="stat-label">Agentes activos</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-header">
            <div className="stat-icon amber">{Icons.tasks}</div>
          </div>
          <div className="stat-value">{pendingTasks}</div>
          <div className="stat-label">Tareas pendientes</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-header">
            <div className="stat-icon green">{Icons.reports}</div>
          </div>
          <div className="stat-value">{data.reportEntries.length}</div>
          <div className="stat-label">Reportes cargados</div>
        </div>
      </div>

      <div className="agent-cards" style={{ marginBottom: 24 }}>
        {agents.map((a) => {
          const s = getAgentStats(a.id);
          return (
            <button
              key={a.id}
              className="agent-card"
              onClick={() => onNavigate("agente-detalle", { agentId: a.id })}
            >
              <div className="agent-card-top">
                <div className="avatar">
                  {a.fullName
                    .split(" ")
                    .map((w) => w[0])
                    .join("")
                    .slice(0, 2)}
                </div>
                <div>
                  <h4>{a.fullName}</h4>
                  <span>
                    {s.leads} leads · {s.closed} cerrados
                  </span>
                </div>
              </div>
              <div className="agent-metrics">
                <div>
                  <div className="num">{s.tasksDone}</div>
                  <div className="lbl">Hechas</div>
                </div>
                <div>
                  <div className="num">{s.tasksTotal}</div>
                  <div className="lbl">Tareas</div>
                </div>
                <div>
                  <div className="num">{s.progress}%</div>
                  <div className="lbl">Avance</div>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <div className="grid-2">
        <div className="panel">
          <div className="panel-head">
            <h3>Rendimiento de agentes</h3>
            <span className="link" onClick={() => onNavigate("agentes")}>
              Ver todos →
            </span>
          </div>
          <div className="panel-body">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Agente</th>
                  <th>Tareas</th>
                  <th>Progreso</th>
                </tr>
              </thead>
              <tbody>
                {agents.map((a) => {
                  const s = getAgentStats(a.id);
                  return (
                    <tr key={a.id} onClick={() => onNavigate("agente-detalle", { agentId: a.id })}>
                      <td>
                        <span className="cell-name">{a.fullName}</span>
                      </td>
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
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        <div className="panel">
          <div className="panel-head">
            <h3>Leads recientes</h3>
            <span className="link" onClick={() => onNavigate("leads")}>
              Ver todos →
            </span>
          </div>
          <div className="panel-body">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Lead</th>
                  <th>Ciudad</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {data.leads.slice(0, 5).map((l) => (
                  <tr key={l.id}>
                    <td>
                      <span className="cell-name">
                        {l.firstName} {l.lastName}
                      </span>
                    </td>
                    <td>{l.city}</td>
                    <td>
                      <span className="status-pill new">{l.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
