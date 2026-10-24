import { useMemo, useState } from "react";
import { formatDate, useStore } from "@/lib/store";
import { useToast } from "@/components/Toast";
import { PAYMENT_METHOD, type WeeklyPayment } from "@/lib/types";
import { formatWeekRange } from "@/lib/seed";
import { formatUsd, RECEIPT_MAX_BYTES, RECEIPT_TYPES } from "@/lib/money";

function ZelleBox({
  data,
  highlight,
  agentName,
}: {
  data: NonNullable<WeeklyPayment["zelleData"]>;
  highlight?: boolean;
  agentName: string;
}) {
  return (
    <div className={`data-box${highlight ? " highlight" : ""}`}>
      <div className="label">Datos Zelle enviados por {agentName}</div>
      <div className="row">
        <span>Método</span>
        <strong>{data.method}</strong>
      </div>
      <div className="row">
        <span>Titular</span>
        <strong>{data.holder}</strong>
      </div>
      <div className="row">
        <span>Zelle (email o teléfono)</span>
        <strong>{data.zelleEmailOrPhone}</strong>
      </div>
      <div className="row">
        <span>Contacto</span>
        <strong>{data.contact}</strong>
      </div>
      {data.notes ? (
        <div className="row">
          <span>Notas</span>
          <strong>{data.notes}</strong>
        </div>
      ) : null}
    </div>
  );
}

function ReceiptBox({ payment }: { payment: WeeklyPayment }) {
  const { getReceiptUrl } = useStore();
  const { toast } = useToast();
  const [opening, setOpening] = useState(false);
  if (payment.status !== "sent") return null;
  return (
    <div className="data-box" style={{ marginTop: 12 }}>
      <div className="label">Comprobante registrado</div>
      <div className="row">
        <span>Captura</span>
        {payment.screenshotPath ? (
          <button
            type="button"
            className="btn"
            disabled={opening}
            onClick={async () => {
              // Abrir la pestaña antes del await para que el navegador no la bloquee.
              const tab = window.open("", "_blank");
              if (tab) tab.opener = null;
              setOpening(true);
              const url = await getReceiptUrl(payment);
              setOpening(false);
              if (url && tab) tab.location.href = url;
              else {
                tab?.close();
                toast("No se pudo abrir el comprobante", "error");
              }
            }}
          >
            {opening ? "Abriendo…" : `Ver ${payment.screenshotName || "comprobante"}`}
          </button>
        ) : (
          <strong>{payment.screenshotName || "—"}</strong>
        )}
      </div>
      <div className="row">
        <span>Monto</span>
        <strong>{formatUsd(payment.paidAmount)}</strong>
      </div>
      <div className="row">
        <span>Realizado por</span>
        <strong>{payment.paidByName || "—"}</strong>
      </div>
    </div>
  );
}

function weekNumberForPayment(
  payment: WeeklyPayment,
  currentWeekStart: string,
  currentWeekNumber: number
): number {
  const current = new Date(`${currentWeekStart}T12:00:00`).getTime();
  const paymentStart = new Date(`${payment.weekStart}T12:00:00`).getTime();
  const weeksDiff = Math.round((current - paymentStart) / (7 * 86400000));
  return currentWeekNumber - weeksDiff;
}

function PaymentHistoryCard({
  payment,
  currentWeekStart,
  weekNumber,
}: {
  payment: WeeklyPayment;
  currentWeekStart: string;
  weekNumber: number;
}) {
  const labelWeek = weekNumberForPayment(payment, currentWeekStart, weekNumber);

  return (
    <article className="payment-history-card">
      <div className="payment-history-head">
        <div>
          <div className="payment-history-week">Semana {Math.max(1, labelWeek)}</div>
          <div className="payment-history-range">{formatWeekRange(payment.weekStart)}</div>
        </div>
        <span className="status-pill closed">Pagado</span>
      </div>
      <div className="status-card" style={{ marginTop: 12, textAlign: "left" }}>
        <div className="row">
          <span>Monto</span>
          <strong>{formatUsd(payment.paidAmount)}</strong>
        </div>
        <div className="row">
          <span>Fecha de pago</span>
          <strong>{payment.paidAt ? formatDate(payment.paidAt.slice(0, 10)) : "—"}</strong>
        </div>
        <div className="row">
          <span>Realizado por</span>
          <strong>{payment.paidByName || "—"}</strong>
        </div>
        <div className="row">
          <span>Método</span>
          <strong>{PAYMENT_METHOD}</strong>
        </div>
      </div>
      {payment.zelleData && (
        <div style={{ marginTop: 12 }}>
          <ZelleBox data={payment.zelleData} agentName={payment.zelleData.holder} />
        </div>
      )}
      <ReceiptBox payment={payment} />
    </article>
  );
}

function AgentPaymentsPanel({
  user,
  weekNumber,
  currentWeekStart,
  isDataWindowOpen,
  isPayWindowOpen,
  getAgentStats,
  getOrCreatePayment,
  getAgentPaymentHistory,
  data,
  submitZelleData,
}: {
  user: NonNullable<ReturnType<typeof useStore>["viewUser"]>;
  weekNumber: number;
  currentWeekStart: string;
  isDataWindowOpen: boolean;
  isPayWindowOpen: boolean;
  getAgentStats: ReturnType<typeof useStore>["getAgentStats"];
  getOrCreatePayment: ReturnType<typeof useStore>["getOrCreatePayment"];
  getAgentPaymentHistory: ReturnType<typeof useStore>["getAgentPaymentHistory"];
  data: ReturnType<typeof useStore>["data"];
  submitZelleData: ReturnType<typeof useStore>["submitZelleData"];
}) {
  const { toast } = useToast();
  const [tab, setTab] = useState<"current" | "history">("current");
  const [drawer, setDrawer] = useState<null | { mode: "zelle"; agentId: string }>(null);
  const [holder, setHolder] = useState("");
  const [zelleId, setZelleId] = useState("");
  const [contact, setContact] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const stats = getAgentStats(user.id);
  const weekPayment = data.payments.find(
    (p) => p.agentId === user.id && p.weekStart === currentWeekStart
  );
  const completedThisWeek = weekPayment?.status === "sent";
  const payment = completedThisWeek ? null : weekPayment || getOrCreatePayment(user.id);
  const history = getAgentPaymentHistory(user.id);

  let payLabel = "Semana en curso";
  if (completedThisWeek) payLabel = "Pago completado · ver historial";
  else if (!stats.thruThursdayOk)
    payLabel = `Completa tareas lun–jue (${stats.thruThursdayDone}/${stats.thruThursdayTotal || stats.tasksTotal}) + pruebas`;
  else if (!isDataWindowOpen && payment?.status === "ready")
    payLabel = "Listo hasta jueves · esperando ventana de datos (jueves ≥ 18:00)";
  else if (payment?.status === "awaiting_data") payLabel = "Tu encargado/nómina pidió tus datos Zelle";
  else if (payment?.status === "data_received" && !stats.fullWeekOk)
    payLabel = `Datos enviados · completa el viernes (${stats.fridayDone}/${stats.fridayTotal || "—"}) para cobro`;
  else if (payment?.status === "data_received" && stats.fullWeekOk && !isPayWindowOpen)
    payLabel = "Semana completa · el pago se libera el viernes";
  else if (payment?.status === "data_received" && stats.fullWeekOk && isPayWindowOpen)
    payLabel = "Listo para pago · nómina puede transferir";
  else if (stats.dataEligible && isDataWindowOpen) payLabel = "En cola de datos (jueves noche)";

  return (
    <>
      <div className="report-tabs payment-agent-tabs">
        <button
          className={`report-tab${tab === "current" ? " active" : ""}`}
          onClick={() => setTab("current")}
        >
          Esta semana
        </button>
        <button
          className={`report-tab${tab === "history" ? " active" : ""}`}
          onClick={() => setTab("history")}
        >
          Historial de pagos
          {history.length > 0 && <span className="tab-count">{history.length}</span>}
        </button>
      </div>

      {tab === "history" ? (
        <div className="panel">
          {!history.length ? (
            <div className="empty-state">
              <h4>Sin pagos anteriores</h4>
              <p>Cuando completes un pago semanal, aparecerá aquí con monto, fecha y comprobante.</p>
            </div>
          ) : (
            <div className="payment-history-list">
              {history.map((p) => (
                <PaymentHistoryCard
                  key={p.id}
                  payment={p}
                  currentWeekStart={currentWeekStart}
                  weekNumber={weekNumber}
                />
              ))}
            </div>
          )}
        </div>
      ) : completedThisWeek && weekPayment ? (
        <div className="panel">
          <div className="empty-state">
            <h4>Semana {weekNumber} · pago completado</h4>
            <p>
              Tu pago de <strong>{formatWeekRange(currentWeekStart)}</strong> ya fue registrado (
              {formatUsd(weekPayment.paidAmount)}). La ventana queda libre hasta la próxima semana.
            </p>
            <button className="btn btn-primary-sm" style={{ marginTop: 16 }} onClick={() => setTab("history")}>
              Ver historial de pagos
            </button>
          </div>
        </div>
      ) : (
        <div className="panel">
          <div className="agent-view" style={{ padding: 28 }}>
            <div className="lock">{payment?.status === "awaiting_data" ? "📝" : "🔒"}</div>
            <h3 style={{ fontSize: "1.1rem", marginBottom: 8 }}>
              {payment?.status === "awaiting_data"
                ? "Envía tus datos Zelle"
                : "El pago lo gestiona encargado / nómina"}
            </h3>
            <p style={{ color: "var(--muted)", fontSize: "0.9rem", maxWidth: 480, margin: "0 auto", lineHeight: 1.5 }}>
              <strong>Jueves noche:</strong> datos Zelle si lun–jue están OK.{" "}
              <strong>Viernes:</strong> pago si toda la semana (lun–vie) está completa. Método:{" "}
              <strong>Zelle</strong>.
            </p>
            <div className="status-card" style={{ marginTop: 20, textAlign: "left" }}>
              <div className="row">
                <span>Semana</span>
                <strong>{weekNumber}</strong>
              </div>
              <div className="row">
                <span>Periodo</span>
                <strong>{formatWeekRange(currentWeekStart)}</strong>
              </div>
              <div className="row">
                <span>Tareas lun–jue</span>
                <strong>
                  {stats.thruThursdayDone}/{stats.thruThursdayTotal}{" "}
                  {stats.thruThursdayOk ? "✓" : ""}
                </strong>
              </div>
              <div className="row">
                <span>Tareas semana (lun–vie)</span>
                <strong>
                  {stats.tasksDone}/{stats.tasksTotal} {stats.fullWeekOk ? "✓" : ""}
                </strong>
              </div>
              <div className="row">
                <span>Ventana datos (jueves ≥ 18:00)</span>
                <strong>{isDataWindowOpen ? "Abierta" : "Cerrada"}</strong>
              </div>
              <div className="row">
                <span>Ventana pago (viernes)</span>
                <strong>{isPayWindowOpen ? "Abierta" : "Cerrada"}</strong>
              </div>
              <div className="row">
                <span>Estado</span>
                <strong>{payLabel}</strong>
              </div>
            </div>

            {payment?.status === "awaiting_data" && (
              <div style={{ marginTop: 20, maxWidth: 420, marginLeft: "auto", marginRight: "auto", textAlign: "left" }}>
                <div className="data-box highlight">
                  <div className="label">Solicitud de datos Zelle</div>
                  <p style={{ fontSize: "0.84rem", color: "var(--muted)", marginBottom: 12, lineHeight: 1.45 }}>
                    Completa el formulario. Encargado/nómina verá estos datos para transferirte el viernes.
                  </p>
                  <button
                    className="btn btn-primary-sm"
                    style={{ width: "100%", justifyContent: "center" }}
                    onClick={() => {
                      setHolder(user.fullName);
                      setZelleId(user.email);
                      setContact(user.phone || "");
                      setNotes("");
                      setDrawer({ mode: "zelle", agentId: user.id });
                    }}
                  >
                    Enviar mis datos Zelle
                  </button>
                </div>
              </div>
            )}

            {payment?.zelleData && (
              <div style={{ marginTop: 16, maxWidth: 420, marginLeft: "auto", marginRight: "auto", textAlign: "left" }}>
                <ZelleBox data={payment.zelleData} agentName={user.fullName} />
                <ReceiptBox payment={payment} />
              </div>
            )}
          </div>
        </div>
      )}

      {drawer?.mode === "zelle" && (
        <PaymentDrawer
          title="Enviar datos Zelle"
          hint="Único método: Zelle. Estos datos los verá encargado/nómina."
          onClose={() => setDrawer(null)}
          confirmLabel="Enviar al encargado"
          busy={busy}
          onConfirm={async () => {
            if (!holder.trim() || !zelleId.trim()) {
              toast("Completa titular y Zelle", "error");
              return;
            }
            setBusy(true);
            const res = await submitZelleData(user.id, {
              holder: holder.trim(),
              zelleEmailOrPhone: zelleId.trim(),
              contact: contact.trim() || user.email,
              notes: notes.trim(),
            });
            setBusy(false);
            if (!res.ok) {
              toast(res.error || "No se enviaron los datos", "error");
              return;
            }
            setDrawer(null);
            toast("Datos Zelle enviados");
          }}
        >
          <div className="field">
            <label>Método</label>
            <input value={PAYMENT_METHOD} readOnly />
          </div>
          <div className="field">
            <label>Nombre del titular *</label>
            <input value={holder} onChange={(e) => setHolder(e.target.value)} />
          </div>
          <div className="field">
            <label>Zelle (email o teléfono) *</label>
            <input value={zelleId} onChange={(e) => setZelleId(e.target.value)} />
          </div>
          <div className="field">
            <label>Contacto</label>
            <input value={contact} onChange={(e) => setContact(e.target.value)} />
          </div>
          <div className="field">
            <label>Notas (opcional)</label>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={`Referencia Semana ${weekNumber}`} />
          </div>
        </PaymentDrawer>
      )}
    </>
  );
}

export function PagosView() {
  const {
    viewUser: user,
    agents,
    isPayroll,
    isDataWindowOpen,
    isPayWindowOpen,
    isSundayAssign,
    setForcePaymentWindow,
    data,
    getAgentStats,
    getOrCreatePayment,
    getAgentPaymentHistory,
    requestPaymentData,
    submitZelleData,
    markPaymentSent,
    advanceWeek,
    canAdvanceWeek,
    defaultWeeklyAmount,
    isAdmin,
    currentWeekStart,
    weekNumber,
  } = useStore();
  const { toast } = useToast();

  const [drawer, setDrawer] = useState<
    null | { mode: "request" | "zelle" | "capture" | "view"; agentId: string }
  >(null);
  const [amount, setAmount] = useState(String(defaultWeeklyAmount));
  const [paidBy, setPaidBy] = useState("");
  const [receipt, setReceipt] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  const force = data.forcePaymentWindow;
  const canSimulate = isAdmin || import.meta.env.DEV;

  function openCapture(agentId: string) {
    setAmount(String(defaultWeeklyAmount));
    setPaidBy(user?.fullName || "");
    setReceipt(null);
    setDrawer({ mode: "capture", agentId });
  }

  const staffRows = useMemo(() => {
    const weekStart = data.currentWeekStart;
    return agents.map((a) => {
      const stats = getAgentStats(a.id);
      const payment =
        data.payments.find((p) => p.agentId === a.id && p.weekStart === weekStart) ||
        ({
          id: `tmp_${a.id}`,
          agentId: a.id,
          weekStart,
          status: "ready" as const,
          zelleData: null,
        } satisfies WeeklyPayment);
      return { agent: a, stats, payment };
    });
  }, [agents, data.payments, data.currentWeekStart, getAgentStats]);

  /** Jueves: pedir datos si lun–jue OK y aún no enviados/pagados. */
  const dataQueue = useMemo(() => {
    return staffRows.filter(
      (row) =>
        row.stats.dataEligible &&
        row.payment.status !== "sent" &&
        row.payment.status !== "data_received" &&
        row.payment.weekStart === data.currentWeekStart
    );
  }, [staffRows, data.currentWeekStart]);

  /** Viernes: pagar si semana completa + datos listos. */
  const payQueue = useMemo(() => {
    return staffRows.filter(
      (row) =>
        row.stats.fullWeekOk &&
        row.payment.status === "data_received" &&
        row.payment.weekStart === data.currentWeekStart
    );
  }, [staffRows, data.currentWeekStart]);

  const waitingFriday = useMemo(() => {
    return staffRows.filter(
      (row) =>
        row.payment.status === "data_received" &&
        !row.stats.fullWeekOk &&
        row.payment.weekStart === data.currentWeekStart
    );
  }, [staffRows, data.currentWeekStart]);

  const blocked = useMemo(() => {
    return staffRows.filter((r) => !r.stats.dataEligible && r.payment.status !== "sent");
  }, [staffRows]);

  if (!user) return null;

  if (!isPayroll) {
    return (
      <>
        <div className="week-strip">
          <div>
            <div className="label">Mis pagos · Semana {weekNumber}</div>
            <div className="value">
              Método fijo: {PAYMENT_METHOD} · {formatWeekRange(currentWeekStart)}
            </div>
          </div>
        </div>
        <AgentPaymentsPanel
          user={user}
          weekNumber={weekNumber}
          currentWeekStart={currentWeekStart}
          isDataWindowOpen={isDataWindowOpen}
          isPayWindowOpen={isPayWindowOpen}
          getAgentStats={getAgentStats}
          getOrCreatePayment={getOrCreatePayment}
          getAgentPaymentHistory={getAgentPaymentHistory}
          data={data}
          submitZelleData={submitZelleData}
        />
      </>
    );
  }

  const anyWindow = isDataWindowOpen || isPayWindowOpen;

  return (
    <>
      <div className="week-strip">
        <div>
          <div className="label">Cola de pagos · Semana {weekNumber}</div>
          <div className="value">
            {formatWeekRange(currentWeekStart)} · Lun–Vie · Método: {PAYMENT_METHOD}
          </div>
        </div>
        <div className="week-strip-actions">
          {canSimulate && (
            <label className="toggle" style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <span style={{ fontSize: "0.82rem", fontWeight: 600 }}>Simular ventanas (datos+pago)</span>
              <button
                type="button"
                className={`switch${force ? " on" : ""}`}
                onClick={() => setForcePaymentWindow(!force)}
                aria-label="Forzar ventanas de pago"
              />
            </label>
          )}
          {canAdvanceWeek && (
            <button
              type="button"
              className="btn btn-primary-sm"
              onClick={() => {
                if (
                  !window.confirm(
                    `¿Iniciar la Semana ${weekNumber + 1}? La cola de pagos de la semana actual se cierra.`
                  )
                ) {
                  return;
                }
                const res = advanceWeek();
                if (!res.ok) toast(res.error || "No se pudo iniciar la semana", "error");
                else toast(`Semana ${weekNumber + 1} iniciada · cola de pagos vacía`);
              }}
            >
              Iniciar nueva semana
            </button>
          )}
        </div>
      </div>

      {force && (
        <div className="sim-banner" role="status">
          Modo simulación activo: las ventanas de datos y pago están abiertas para todos los usuarios.
        </div>
      )}

      {isSundayAssign && !force && (
        <div className="panel" style={{ marginBottom: 16 }}>
          <div className="empty-state">
            <h4>Domingo · día de asignación</h4>
            <p>
              Asigna las tareas lun–vie en <strong>Tareas</strong>. Las ventanas de datos y pago
              abren jueves noche y viernes, respectivamente.
            </p>
          </div>
        </div>
      )}

      {!anyWindow ? (
        <div className="panel">
          <div className="empty-state">
            <h4>Sin ventana activa</h4>
            <p>
              <strong>Jueves ≥ 18:00:</strong> pedir / recibir datos Zelle (si lun–jue OK).{" "}
              <strong>Viernes:</strong> registrar el pago (si lun–vie OK + datos listos).
            </p>
          </div>
        </div>
      ) : (
        <>
          {isDataWindowOpen && (
            <div className="panel" style={{ marginBottom: 16 }}>
              <div className="panel-head">
                <div>
                  <h3>Candado 1 · Datos Zelle (jueves noche)</h3>
                  <div className="meta" style={{ fontSize: "0.8rem", color: "var(--muted)", marginTop: 4 }}>
                    Solo agentes con tareas lun–jue completas y pruebas validadas
                  </div>
                </div>
                <span className="status-pill closed">Datos</span>
              </div>

              {!dataQueue.length ? (
                <div className="empty-state">
                  <h4>Nadie listo para datos</h4>
                  <p>Ningún agente cumple lun–jue + pruebas, o ya enviaron Zelle.</p>
                </div>
              ) : (
                dataQueue.map(({ agent, stats, payment }) => {
                  const live =
                    data.payments.find(
                      (p) => p.agentId === agent.id && p.weekStart === currentWeekStart
                    ) || payment;
                  return (
                    <div
                      key={`data-${agent.id}`}
                      className="agent-pay-card"
                      style={{ padding: 20, borderBottom: "1px solid var(--line)" }}
                    >
                      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 16 }}>
                        <div>
                          <div className="agent-card-top" style={{ marginBottom: 10 }}>
                            <div className="avatar">
                              {agent.fullName
                                .split(" ")
                                .map((w) => w[0])
                                .join("")
                                .slice(0, 2)
                                .toUpperCase()}
                            </div>
                            <div>
                              <h4>{agent.fullName}</h4>
                              <span>
                                Lun–jue {stats.thruThursdayDone}/{stats.thruThursdayTotal} · pruebas OK
                              </span>
                            </div>
                          </div>
                          <span className="status-pill pending">
                            {live.status === "awaiting_data" ? "Esperando Zelle" : "Listo para pedir datos"}
                          </span>
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 180 }}>
                          {live.status === "ready" && (
                            <button
                              className="btn btn-primary-sm"
                              onClick={() => setDrawer({ mode: "request", agentId: agent.id })}
                            >
                              Solicitar datos Zelle
                            </button>
                          )}
                          {live.status === "awaiting_data" && (
                            <button className="btn" disabled>
                              Esperando datos del agente…
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {isPayWindowOpen && (
            <div className="panel" style={{ marginBottom: 16 }}>
              <div className="panel-head">
                <div>
                  <h3>Candado 2 · Pago (viernes)</h3>
                  <div className="meta" style={{ fontSize: "0.8rem", color: "var(--muted)", marginTop: 4 }}>
                    Solo si lun–vie está completa, pruebas OK y datos Zelle recibidos
                  </div>
                </div>
                <span className="status-pill closed">Pago</span>
              </div>

              {!payQueue.length ? (
                <div className="empty-state">
                  <h4>Nadie listo para pagar</h4>
                  <p>
                    Falta semana completa, datos Zelle, o aún no es elegible. Revisa quién espera el
                    viernes abajo.
                  </p>
                </div>
              ) : (
                payQueue.map(({ agent, stats, payment }) => {
                  const live =
                    data.payments.find(
                      (p) => p.agentId === agent.id && p.weekStart === currentWeekStart
                    ) || payment;
                  return (
                    <div
                      key={`pay-${agent.id}`}
                      className="agent-pay-card"
                      style={{ padding: 20, borderBottom: "1px solid var(--line)" }}
                    >
                      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 16 }}>
                        <div>
                          <div className="agent-card-top" style={{ marginBottom: 10 }}>
                            <div className="avatar">
                              {agent.fullName
                                .split(" ")
                                .map((w) => w[0])
                                .join("")
                                .slice(0, 2)
                                .toUpperCase()}
                            </div>
                            <div>
                              <h4>{agent.fullName}</h4>
                              <span>
                                Semana {stats.tasksDone}/{stats.tasksTotal} · datos listos
                              </span>
                            </div>
                          </div>
                          <span className="status-pill closed">Listo para pagar</span>
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 180 }}>
                          <button
                            className="btn btn-primary-sm"
                            onClick={() => openCapture(agent.id)}
                          >
                            Registrar pago enviado
                          </button>
                          <button className="btn" onClick={() => setDrawer({ mode: "view", agentId: agent.id })}>
                            Ver datos Zelle
                          </button>
                        </div>
                      </div>
                      {live.zelleData && (
                        <div style={{ marginTop: 12 }}>
                          <ZelleBox data={live.zelleData} agentName={agent.fullName} highlight />
                        </div>
                      )}
                    </div>
                  );
                })
              )}

              {!!waitingFriday.length && (
                <div style={{ padding: "14px 20px", background: "var(--line-soft)" }}>
                  <div
                    style={{
                      fontSize: "0.72rem",
                      fontWeight: 700,
                      color: "var(--muted)",
                      marginBottom: 10,
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                    }}
                  >
                    Datos OK · falta tarea del viernes
                  </div>
                  {waitingFriday.map(({ agent, stats }) => (
                    <div
                      key={`wait-${agent.id}`}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 12,
                        padding: "8px 0",
                        fontSize: "0.88rem",
                        flexWrap: "wrap",
                      }}
                    >
                      <strong>{agent.fullName}</strong>
                      <span style={{ color: "var(--muted)" }}>
                        {stats.tasksDone}/{stats.tasksTotal} · vie {stats.fridayDone}/
                        {stats.fridayTotal}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {!!blocked.length && (
            <div className="panel">
              <div style={{ padding: "14px 20px" }}>
                <div
                  style={{
                    fontSize: "0.72rem",
                    fontWeight: 700,
                    color: "var(--muted)",
                    marginBottom: 10,
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                  }}
                >
                  Aún no elegibles (lun–jue incompleto)
                </div>
                {blocked.map(({ agent, stats }) => (
                  <div
                    key={agent.id}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 12,
                      padding: "8px 0",
                      fontSize: "0.88rem",
                      flexWrap: "wrap",
                      borderBottom: "1px solid var(--line)",
                    }}
                  >
                    <strong>{agent.fullName}</strong>
                    <span style={{ color: "var(--muted)" }}>
                      Lun–jue {stats.thruThursdayDone}/{stats.thruThursdayTotal} · semana{" "}
                      {stats.tasksDone}/{stats.tasksTotal}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {drawer?.mode === "request" && (
        <PaymentDrawer
          title="Solicitar datos Zelle"
          hint="Se avisará al agente. Cuando envíe Zelle, el pago se registra el viernes si completa la semana."
          onClose={() => setDrawer(null)}
          confirmLabel="Enviar solicitud"
          busy={busy}
          onConfirm={async () => {
            setBusy(true);
            const res = await requestPaymentData(drawer.agentId);
            setBusy(false);
            if (!res.ok) {
              toast(res.error || "No se envió la solicitud", "error");
              return;
            }
            setDrawer(null);
            toast("Solicitud enviada al agente");
          }}
        >
          <p style={{ fontSize: "0.88rem", color: "var(--muted)", lineHeight: 1.5 }}>
            Método fijo: <strong>Zelle</strong>. El agente enviará titular y correo/teléfono Zelle.
          </p>
        </PaymentDrawer>
      )}

      {drawer?.mode === "view" &&
        (() => {
          const agent = agents.find((a) => a.id === drawer.agentId);
          const live = data.payments.find(
            (p) => p.agentId === drawer.agentId && p.weekStart === currentWeekStart
          );
          if (!agent || !live?.zelleData) return null;
          return (
            <PaymentDrawer
              title="Datos Zelle para pagar"
              hint="Usa estos datos para transferir. Luego registra la captura."
              onClose={() => setDrawer(null)}
              confirmLabel="Ir a registrar pago"
              onConfirm={() => openCapture(agent.id)}
            >
              <ZelleBox data={live.zelleData} agentName={agent.fullName} highlight />
            </PaymentDrawer>
          );
        })()}

      {drawer?.mode === "capture" &&
        (() => {
          const agent = agents.find((a) => a.id === drawer.agentId);
          const live = data.payments.find(
            (p) => p.agentId === drawer.agentId && p.weekStart === currentWeekStart
          );
          if (!agent || !live?.zelleData) return null;
          return (
            <PaymentDrawer
              title="Registrar pago enviado"
              hint="Adjunta captura, monto y quién realizó el pago (encargado o nómina)."
              onClose={() => setDrawer(null)}
              confirmLabel="Marcar pago enviado"
              busy={busy}
              onConfirm={async () => {
                const paidAmount = Number(amount);
                if (!Number.isFinite(paidAmount) || paidAmount <= 0 || !paidBy.trim()) {
                  toast("Completa monto válido y quién realizó el pago", "error");
                  return;
                }
                if (!isPayWindowOpen) {
                  toast("El pago solo se registra el viernes", "error");
                  return;
                }
                if (!getAgentStats(agent.id).fullWeekOk) {
                  toast("Faltan tareas de la semana (incluye viernes)", "error");
                  return;
                }
                setBusy(true);
                const res = await markPaymentSent(agent.id, {
                  receipt,
                  paidAmount,
                  paidByName: paidBy.trim(),
                });
                setBusy(false);
                if (!res.ok) {
                  toast(res.error || "No se registró el pago", "error");
                  return;
                }
                setDrawer(null);
                toast("Pago marcado como enviado");
              }}
            >
              <ZelleBox data={live.zelleData} agentName={agent.fullName} highlight />
              <label className="report-file-drop" style={{ marginTop: 14, display: "block", cursor: "pointer" }}>
                📷 {receipt ? receipt.name : "Adjuntar comprobante (imagen o PDF, máx. 5 MB)"}
                <input
                  type="file"
                  accept={RECEIPT_TYPES.join(",")}
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const file = e.target.files?.[0] || null;
                    e.target.value = "";
                    if (!file) return;
                    if (!RECEIPT_TYPES.includes(file.type)) {
                      toast("Solo imágenes (PNG/JPG/WEBP/GIF) o PDF", "error");
                      return;
                    }
                    if (file.size > RECEIPT_MAX_BYTES) {
                      toast("El comprobante supera 5 MB", "error");
                      return;
                    }
                    setReceipt(file);
                  }}
                />
              </label>
              <div className="field">
                <label>Monto pagado (USD) *</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
              <div className="field">
                <label>Nombre de quien realizó el pago *</label>
                <input value={paidBy} onChange={(e) => setPaidBy(e.target.value)} />
              </div>
            </PaymentDrawer>
          );
        })()}
    </>
  );
}

function PaymentDrawer({
  title,
  hint,
  children,
  onClose,
  onConfirm,
  confirmLabel,
  busy = false,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  confirmLabel: string;
  busy?: boolean;
}) {
  return (
    <div className="drawer-overlay open" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="drawer">
        <div className="drawer-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="drawer-body">
          <p style={{ fontSize: "0.84rem", color: "var(--muted)", marginBottom: 14, lineHeight: 1.45 }}>{hint}</p>
          {children}
        </div>
        <div className="drawer-actions">
          <button className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn btn-primary-sm" onClick={() => void onConfirm()} disabled={busy}>
            {busy ? "Guardando…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
