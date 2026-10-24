import type { Lead, ReportEntry, ReportTarget, WeeklyTask } from "./types";
import { todayKey } from "./dayFolders";
import {
  cartaLinkCandidates,
  leadFullName,
  leadIdsWithCarta,
  type LeadCartaIntegrity,
} from "./cartaLeadSync";

export type RequiredActionKind =
  | "carta_sin_lead"
  | "realizado_sin_carta"
  | "homonimo_pendiente"
  | "duplicado_real"
  | "tarea_vencida";

export type RequiredAction = {
  id: string;
  kind: RequiredActionKind;
  title: string;
  detail: string;
  severity: "warn" | "info";
  leadId?: string;
  leadNumber?: number;
  entryId?: string;
  personKey?: string;
  taskId?: string;
  targetId?: string | null;
  agentId?: string | null;
};

export type CollectRequiredActionsInput = {
  leads: Lead[];
  reportEntries: ReportEntry[];
  reportTargets: ReportTarget[];
  tasks: WeeklyTask[];
  syncHealth: LeadCartaIntegrity | null;
  /** Si hay id, solo acciones del agente; null = todo (admin/encargado). */
  scopeAgentId: string | null;
  today?: string;
};

function leadInScope(lead: Lead, scopeAgentId: string | null): boolean {
  if (!scopeAgentId) return true;
  return lead.assignedAgentId === scopeAgentId;
}

function targetIdForLead(lead: Lead, targets: ReportTarget[]): string | null {
  if (lead.reportTargetId) return lead.reportTargetId;
  if (!lead.assignedAgentId) return null;
  const mine = targets.find((t) => t.assignedAgentId === lead.assignedAgentId && t.active);
  return mine?.id ?? null;
}

function cartaInScope(
  entryId: string,
  personKey: string,
  leads: Lead[],
  entries: ReportEntry[],
  targets: ReportTarget[],
  scopeAgentId: string | null
): boolean {
  if (!scopeAgentId) return true;
  const entry = entries.find((e) => e.id === entryId);
  if (entry) {
    const target = targets.find((t) => t.id === entry.targetId);
    if (target?.assignedAgentId === scopeAgentId) return true;
  }
  return cartaLinkCandidates(personKey, leads, entries).some(
    (c) => c.lead.assignedAgentId === scopeAgentId
  );
}

/** Recolecta acciones pendientes de cartas/leads y tareas vencidas. */
export function collectRequiredActions(input: CollectRequiredActionsInput): RequiredAction[] {
  const {
    leads,
    reportEntries,
    reportTargets,
    tasks,
    syncHealth,
    scopeAgentId,
    today = todayKey(),
  } = input;
  const withCarta = leadIdsWithCarta(reportEntries);
  const leadById = new Map(leads.map((l) => [l.id, l] as const));
  const actions: RequiredAction[] = [];

  if (syncHealth) {
    for (const c of syncHealth.unrepairedUnlinked) {
      if (
        !cartaInScope(c.entryId, c.personKey, leads, reportEntries, reportTargets, scopeAgentId)
      ) {
        continue;
      }
      const entry = reportEntries.find((e) => e.id === c.entryId);
      actions.push({
        id: `carta-sin-lead:${c.entryId}`,
        kind: "carta_sin_lead",
        title: c.personKey || entry?.fileName || "Carta sin lead",
        detail: c.reason || "Carta sin lead vinculado",
        severity: "warn",
        entryId: c.entryId,
        personKey: c.personKey,
        targetId: entry?.targetId ?? null,
      });
    }

    for (const g of syncHealth.nameDuplicateGroups) {
      if (g.distinctPeople) {
        for (let i = 0; i < g.leadIds.length; i++) {
          const leadId = g.leadIds[i];
          if (withCarta.has(leadId)) continue;
          const lead = leadById.get(leadId);
          if (!lead || !leadInScope(lead, scopeAgentId)) continue;
          const siblings = g.leadIds
            .filter((id) => id !== leadId)
            .map((id) => {
              const sib = leadById.get(id);
              const n = sib?.leadNumber ?? "?";
              return withCarta.has(id) ? `#${n} ✓` : `#${n} sin carta`;
            })
            .join(" · ");
          actions.push({
            id: `homonimo:${leadId}`,
            kind: "homonimo_pendiente",
            title: g.name,
            detail: `Homónimo: #${lead.leadNumber} sin carta${siblings ? ` · ${siblings}` : ""}. Sube o vincula la carta de #${lead.leadNumber}.`,
            severity: "warn",
            leadId,
            leadNumber: lead.leadNumber,
            targetId: targetIdForLead(lead, reportTargets),
            agentId: lead.assignedAgentId,
          });
        }
      } else {
        const scoped = g.leadIds
          .map((id) => leadById.get(id))
          .filter((l): l is Lead => !!l && leadInScope(l, scopeAgentId));
        if (!scoped.length) continue;
        actions.push({
          id: `dupe:${g.name}`,
          kind: "duplicado_real",
          title: g.name,
          detail: `Posible duplicado · #${g.leadNumbers.join(", #")} · mismo teléfono`,
          severity: "info",
          leadId: scoped[0].id,
          leadNumber: scoped[0].leadNumber,
          agentId: scoped[0].assignedAgentId,
          targetId: targetIdForLead(scoped[0], reportTargets),
        });
      }
    }
  }

  for (const lead of leads) {
    if (lead.status !== "realizado") continue;
    if (withCarta.has(lead.id)) continue;
    if (!leadInScope(lead, scopeAgentId)) continue;
    // Homónimos pendientes ya cubren el caso «sin carta» dentro del grupo.
    const inHomonymPending =
      syncHealth?.nameDuplicateGroups.some(
        (g) =>
          g.distinctPeople &&
          g.leadIds.includes(lead.id) &&
          g.leadIds.some((id) => !withCarta.has(id))
      ) ?? false;
    if (inHomonymPending) continue;
    actions.push({
      id: `realizado-sin-carta:${lead.id}`,
      kind: "realizado_sin_carta",
      title: leadFullName(lead) || `Lead #${lead.leadNumber}`,
      detail: `Realizado #${lead.leadNumber} sin carta de consentimiento`,
      severity: "warn",
      leadId: lead.id,
      leadNumber: lead.leadNumber,
      targetId: targetIdForLead(lead, reportTargets),
      agentId: lead.assignedAgentId,
    });
  }

  for (const task of tasks) {
    if (task.status === "completada") continue;
    if (!task.dueDate || task.dueDate >= today) continue;
    if (scopeAgentId && task.assignedTo !== scopeAgentId) continue;
    actions.push({
      id: `tarea-vencida:${task.id}`,
      kind: "tarea_vencida",
      title: task.title,
      detail: `Venció el ${task.dueDate}`,
      severity: "warn",
      taskId: task.id,
      agentId: task.assignedTo,
    });
  }

  const order: Record<RequiredActionKind, number> = {
    carta_sin_lead: 0,
    homonimo_pendiente: 1,
    realizado_sin_carta: 2,
    duplicado_real: 3,
    tarea_vencida: 4,
  };
  actions.sort(
    (a, b) =>
      order[a.kind] - order[b.kind] ||
      a.title.localeCompare(b.title, "es") ||
      (a.leadNumber ?? 0) - (b.leadNumber ?? 0)
  );
  return actions;
}

export type ReportHealthCheck = {
  id: string;
  label: string;
  done: number;
  total: number;
  okText: string;
};

export type ReportActionGroup = {
  key: string;
  kind: "report" | "tasks" | "other";
  targetId: string | null;
  title: string;
  subtitle: string;
  agentId: string | null;
  pct: number;
  allOk: boolean;
  checks: ReportHealthCheck[];
  actions: RequiredAction[];
};

function leadBelongsToTarget(lead: Lead, targetId: string, targets: ReportTarget[]): boolean {
  return targetIdForLead(lead, targets) === targetId;
}

function checkPct(c: ReportHealthCheck): number {
  return c.total ? Math.round((c.done / c.total) * 100) : 100;
}

/** Salud + acciones pendientes agrupadas por perfil de reporte. */
export function groupRequiredActionsByReport(input: CollectRequiredActionsInput & {
  profileName?: (id: string | null | undefined) => string;
}): ReportActionGroup[] {
  const {
    leads,
    reportEntries,
    reportTargets,
    syncHealth,
    scopeAgentId,
    profileName = () => "",
  } = input;
  const actions = collectRequiredActions(input);
  const withCarta = leadIdsWithCarta(reportEntries);
  const groups = syncHealth?.nameDuplicateGroups ?? [];

  const visibleTargets = reportTargets
    .filter((t) => t.active)
    .filter((t) => !scopeAgentId || t.assignedAgentId === scopeAgentId)
    .sort((a, b) => a.name.localeCompare(b.name, "es"));

  const reportGroups: ReportActionGroup[] = visibleTargets.map((target) => {
    const targetLeads = leads.filter((l) => leadBelongsToTarget(l, target.id, reportTargets));
    const targetLeadIds = new Set(targetLeads.map((l) => l.id));
    const consent = reportEntries.filter((e) => e.type === "consent" && e.targetId === target.id);
    const linkedCount = consent.filter((e) => !!e.linkedLeadId).length;
    const realizados = targetLeads.filter((l) => l.status === "realizado");
    const realizadosConCarta = realizados.filter((l) => withCarta.has(l.id)).length;

    // Solo grupos de este perfil (homónimos/duplicados ya vienen acotados por reportTargetId).
    const involved = groups.filter(
      (g) =>
        g.reportTargetId === target.id ||
        (!g.reportTargetId && g.leadIds.some((id) => targetLeadIds.has(id)))
    );
    const realDupes = involved.filter((g) => !g.distinctPeople);
    const homonyms = involved.filter((g) => g.distinctPeople);
    const homonymsResolved = homonyms.filter((g) =>
      g.leadIds
        .filter((id) => targetLeadIds.has(id))
        .every((id) => withCarta.has(id))
    );

    const checks: ReportHealthCheck[] = [
      {
        id: "linked",
        label: "Cartas vinculadas",
        done: linkedCount,
        total: consent.length,
        okText: consent.length ? "Todas las cartas tienen lead" : "Sin cartas",
      },
      {
        id: "realizados",
        label: "Realizados con carta",
        done: realizadosConCarta,
        total: realizados.length,
        okText: realizados.length ? "Cada realizado tiene su carta" : "Sin realizados",
      },
      {
        id: "dupes",
        label: "Nombres repetidos",
        done: involved.length - realDupes.length,
        total: involved.length,
        okText: involved.length ? "Ningún duplicado real" : "Sin nombres repetidos",
      },
      {
        id: "homonyms",
        label: "Homónimos",
        done: homonymsResolved.length,
        total: homonyms.length,
        okText: homonyms.length
          ? `${homonyms.length} homónimo(s) con carta`
          : "Sin homónimos",
      },
    ];

    const pct = Math.round(checks.reduce((s, c) => s + checkPct(c), 0) / checks.length);
    const allOk = checks.every((c) => c.done >= c.total);
    const targetActions = actions.filter(
      (a) => a.kind !== "tarea_vencida" && a.targetId === target.id
    );
    const agentLabel = profileName(target.assignedAgentId) || "sin agente";

    return {
      key: `report:${target.id}`,
      kind: "report" as const,
      targetId: target.id,
      title: target.name,
      subtitle: `Agente · ${agentLabel} · Cartas ${consent.length} · Realizados ${realizados.length}`,
      agentId: target.assignedAgentId ?? null,
      pct,
      allOk: allOk && targetActions.length === 0,
      checks,
      actions: targetActions,
    };
  });

  // Acciones de cartas/leads sin perfil de reporte
  const orphanActions = actions.filter(
    (a) => a.kind !== "tarea_vencida" && !a.targetId
  );
  const otherGroup: ReportActionGroup | null = orphanActions.length
    ? {
        key: "other",
        kind: "other",
        targetId: null,
        title: "Sin perfil de reporte",
        subtitle: "Leads o cartas sin perfil asignado",
        agentId: null,
        pct: 0,
        allOk: false,
        checks: [],
        actions: orphanActions,
      }
    : null;

  const taskActions = actions.filter((a) => a.kind === "tarea_vencida");
  const tasksGroup: ReportActionGroup | null = taskActions.length
    ? {
        key: "tasks",
        kind: "tasks",
        targetId: null,
        title: "Tareas vencidas",
        subtitle: `${taskActions.length} pendiente${taskActions.length === 1 ? "" : "s"}`,
        agentId: null,
        pct: 0,
        allOk: false,
        checks: [],
        actions: taskActions,
      }
    : null;

  // Perfiles con problemas primero; al 100% después; luego sin perfil y tareas
  reportGroups.sort((a, b) => {
    if (a.allOk !== b.allOk) return a.allOk ? 1 : -1;
    if (a.pct !== b.pct) return a.pct - b.pct;
    return a.title.localeCompare(b.title, "es");
  });

  return [
    ...reportGroups,
    ...(otherGroup ? [otherGroup] : []),
    ...(tasksGroup ? [tasksGroup] : []),
  ];
}
