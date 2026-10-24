import type { HistoryEvent, Lead, Profile, ReportEntry, Role } from "./types";

/** Normaliza nombre de persona para cruzar cartas ↔ leads. */
export function normalizePersonName(s: string): string {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Extrae el nombre de persona desde nombre de archivo o label de carta. */
export function extractPersonFromCartaLabel(raw: string): string {
  let s = String(raw || "").replace(/\.[^.]+$/, "");
  s = normalizePersonName(s);
  s = s.replace(/^\d+\s+/, "");
  s = s.replace(/^carta\s+(de\s+)?consentimiento\s+/, "");
  s = s.replace(/^carta\s+cliente\s+encrypted\s+/, "");
  s = s.replace(/^cliente\s+encrypted\s+/, "");
  s = s.replace(/^carta\s+cliente\s+/, "");
  s = s.replace(/^consentimiento\s+/, "");
  s = s.replace(/^carta\s+/, "");
  s = s.replace(/^encrypted\s+/, "");
  // Sufijos de copia del sistema: "Nombre (1).pdf", "Nombre - copia.pdf"
  s = s.replace(/(\s+(copia|copy))?(\s+\d+)*$/, "");
  return s.trim();
}

function tokens(s: string): string[] {
  return normalizePersonName(s).split(" ").filter(Boolean);
}

function tokenSetEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length || a.length < 2) return false;
  return [...a].sort().join(" ") === [...b].sort().join(" ");
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = i - 1;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + cost);
      prev = tmp;
    }
  }
  return row[b.length];
}

export type PersonMatchHow = "exact" | "token-perm" | "typo";

export function fuzzyPersonMatch(
  cartaName: string,
  leadName: string
): false | PersonMatchHow {
  if (!cartaName || !leadName) return false;
  if (cartaName === leadName) return "exact";
  const ct = tokens(cartaName);
  const lt = tokens(leadName);
  if (ct.length >= 2 && lt.length >= 2 && tokenSetEqual(ct, lt)) return "token-perm";
  if (ct.length === lt.length && ct.length >= 2) {
    let diffs = 0;
    for (let i = 0; i < ct.length; i++) {
      if (ct[i] === lt[i]) continue;
      const d = levenshtein(ct[i], lt[i]);
      if (d <= 2 && Math.max(ct[i].length, lt[i].length) >= 4) diffs++;
      else return false;
    }
    if (diffs === 1) return "typo";
  }
  return false;
}

export function leadFullName(lead: Pick<Lead, "firstName" | "lastName">): string {
  return normalizePersonName(`${lead.firstName || ""} ${lead.lastName || ""}`);
}

/** Personas asociadas a una entrada de carta (names[] o fileName). */
export function peopleFromReportEntry(
  entry: Pick<ReportEntry, "names" | "fileName" | "title" | "personKey">
): string[] {
  if (entry.personKey) return [entry.personKey];
  const raws =
    entry.names?.length ? entry.names : [entry.fileName || entry.title || ""];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of raws) {
    const person = extractPersonFromCartaLabel(raw);
    if (!person || seen.has(person)) continue;
    seen.add(person);
    out.push(person);
  }
  return out;
}

export function personKeyFromConsentInput(input: {
  names: string[];
  fileName?: string;
}): string {
  return (
    peopleFromReportEntry({
      names: input.names,
      fileName: input.fileName,
      title: "",
    })[0] || ""
  );
}

/** Número de lead explícito en el archivo: "#90 Alvaro Cardenas.pdf" → 90. */
export function leadNumberTagFromLabel(raw?: string): number | undefined {
  const m = String(raw || "").match(/#\s*(\d{1,6})\b/);
  return m ? Number(m[1]) : undefined;
}

export type MatchActor = { id: string; role: Role };

export type ConsentMatchStatus =
  | "auto"
  | "already_realizado"
  | "ambiguous"
  | "out_of_scope"
  | "unmatched";

export type ConsentLeadResolution = {
  status: ConsentMatchStatus;
  personKey: string;
  lead?: Lead;
  how?: PersonMatchHow;
  candidates?: Lead[];
  reason?: string;
};

function canStaffAutoMark(role: Role) {
  return role === "admin" || role === "encargado" || role === "nomina";
}

function inAgentScope(lead: Lead, actor: MatchActor) {
  if (canStaffAutoMark(actor.role)) return true;
  return lead.assignedAgentId === actor.id;
}

/**
 * Resuelve match seguro carta → lead.
 * Auto solo con exact/token-perm, un candidato claro y alcance del agente.
 * Typo o varios leads = ambiguous (no marca).
 */
export function resolveConsentLeadLink(
  personKey: string,
  leads: Lead[],
  actor: MatchActor,
  /** Leads que ya tienen carta: con homónimos se prefiere el que aún no la tiene. */
  takenLeadIds?: Set<string>,
  /** "#N" del nombre del archivo: desempata homónimos de forma exacta. */
  leadNumberHint?: number
): ConsentLeadResolution {
  if (!personKey) {
    return { status: "unmatched", personKey, reason: "No se pudo leer el nombre del archivo" };
  }

  if (leadNumberHint) {
    const tagged = leads.filter((l) => {
      if (l.leadNumber !== leadNumberHint) return false;
      const how = fuzzyPersonMatch(personKey, leadFullName(l));
      return how === "exact" || how === "token-perm";
    });
    if (tagged.length === 1) {
      const lead = tagged[0];
      if (!inAgentScope(lead, actor)) {
        return {
          status: "out_of_scope",
          personKey,
          lead,
          how: "exact",
          reason: "El lead no está asignado a quien sube la carta",
        };
      }
      if (lead.status === "realizado") {
        return { status: "already_realizado", personKey, lead, how: "exact" };
      }
      return { status: "auto", personKey, lead, how: "exact" };
    }
  }

  const preferFree = (cands: Lead[]) => {
    if (!takenLeadIds?.size || cands.length < 2) return cands;
    const free = cands.filter((l) => !takenLeadIds.has(l.id));
    return free.length ? free : cands;
  };

  const exact = preferFree(leads.filter((l) => leadFullName(l) === personKey));
  if (exact.length > 1) {
    const mine = exact.filter((l) => inAgentScope(l, actor));
    if (mine.length === 1) {
      const lead = mine[0];
      if (lead.status === "realizado") {
        return { status: "already_realizado", personKey, lead, how: "exact" };
      }
      return { status: "auto", personKey, lead, how: "exact" };
    }
    return {
      status: "ambiguous",
      personKey,
      candidates: exact,
      reason: `Hay ${exact.length} leads con el mismo nombre`,
    };
  }
  if (exact.length === 1) {
    const lead = exact[0];
    if (!inAgentScope(lead, actor)) {
      return {
        status: "out_of_scope",
        personKey,
        lead,
        how: "exact",
        reason: "El lead no está asignado a quien sube la carta",
      };
    }
    if (lead.status === "realizado") {
      return { status: "already_realizado", personKey, lead, how: "exact" };
    }
    return { status: "auto", personKey, lead, how: "exact" };
  }

  // Sin exacto: solo token-perm puede auto; typo = dudoso
  const fuzzyHits: { lead: Lead; how: PersonMatchHow }[] = [];
  for (const l of leads) {
    const how = fuzzyPersonMatch(personKey, leadFullName(l));
    if (how === "token-perm" || how === "typo") fuzzyHits.push({ lead: l, how });
  }

  if (!fuzzyHits.length) {
    return { status: "unmatched", personKey, reason: "No hay lead con ese nombre" };
  }

  const typos = fuzzyHits.filter((h) => h.how === "typo");
  const permLeads = new Set(
    preferFree(fuzzyHits.filter((h) => h.how === "token-perm").map((h) => h.lead))
  );
  const perms = fuzzyHits.filter((h) => h.how === "token-perm" && permLeads.has(h.lead));

  if (typos.length && !perms.length) {
    return {
      status: "ambiguous",
      personKey,
      candidates: typos.map((h) => h.lead),
      how: "typo",
      reason: "Nombre parecido (posible typo); confirma a mano",
    };
  }

  if (perms.length > 1) {
    return {
      status: "ambiguous",
      personKey,
      candidates: perms.map((h) => h.lead),
      how: "token-perm",
      reason: "Varios leads coinciden por nombre",
    };
  }

  if (perms.length === 1) {
    const { lead, how } = perms[0];
    if (!inAgentScope(lead, actor)) {
      return {
        status: "out_of_scope",
        personKey,
        lead,
        how,
        reason: "El lead no está asignado a quien sube la carta",
      };
    }
    if (lead.status === "realizado") {
      return { status: "already_realizado", personKey, lead, how };
    }
    return { status: "auto", personKey, lead, how };
  }

  return {
    status: "ambiguous",
    personKey,
    candidates: fuzzyHits.map((h) => h.lead),
    reason: "Coincidencia dudosa",
  };
}

/** Identidad de nombre sin importar el orden de las palabras ("cardenas alvaro" = "alvaro cardenas"). */
export function personIdentity(name: string): string {
  return tokens(name).sort().join(" ");
}

/** Cuántas cartas de consentimiento hay por persona (identidad de nombre) en el mismo target. */
export function consentPeopleCountForTarget(
  entries: ReportEntry[],
  targetId: string,
  excludeEntryIds?: Set<string>
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const e of entries) {
    if (e.type !== "consent" || e.targetId !== targetId) continue;
    if (excludeEntryIds?.has(e.id)) continue;
    const people = e.personKey ? [e.personKey] : peopleFromReportEntry(e);
    for (const p of people) {
      const id = personIdentity(p);
      if (id) counts.set(id, (counts.get(id) || 0) + 1);
    }
  }
  return counts;
}

export type CartaLinkCandidate = { lead: Lead; how: PersonMatchHow; hasCarta: boolean };

/** Leads que podrían ser la persona de una carta (exacto, orden invertido o typo), sin carta primero. */
export function cartaLinkCandidates(
  personKey: string,
  leads: Lead[],
  entries: ReportEntry[]
): CartaLinkCandidate[] {
  if (!personKey) return [];
  const taken = leadIdsWithCarta(entries);
  const rank: Record<PersonMatchHow, number> = { exact: 0, "token-perm": 1, typo: 2 };
  return leads
    .map((lead) => ({ lead, how: fuzzyPersonMatch(personKey, leadFullName(lead)) }))
    .filter((c): c is { lead: Lead; how: PersonMatchHow } => !!c.how)
    .map((c) => ({ ...c, hasCarta: taken.has(c.lead.id) }))
    .sort(
      (a, b) =>
        Number(a.hasCarta) - Number(b.hasCarta) ||
        rank[a.how] - rank[b.how] ||
        a.lead.leadNumber - b.lead.leadNumber
    );
}

/** Leads que ya tienen una carta de consentimiento vinculada. */
export function leadIdsWithCarta(entries: ReportEntry[]): Set<string> {
  const ids = new Set<string>();
  for (const e of entries) {
    if (e.type === "consent" && e.linkedLeadId) ids.add(e.linkedLeadId);
  }
  return ids;
}

/** Personas distintas por nombre: mismo nombre + mismo teléfono/email = una sola persona (lead re-importado). */
function leadCountByName(leads: Lead[]): Map<string, number> {
  const contacts = new Map<string, Set<string>>();
  for (const l of leads) {
    const n = personIdentity(leadFullName(l));
    if (!n) continue;
    const phone = String(l.phone || "").replace(/\D/g, "");
    const email = String(l.email || "").trim().toLowerCase();
    const contact = phone.length >= 7 ? `p:${phone}` : email ? `e:${email}` : `id:${l.id}`;
    const set = contacts.get(n) || new Set<string>();
    set.add(contact);
    contacts.set(n, set);
  }
  return new Map([...contacts].map(([n, set]) => [n, set.size] as const));
}

/** Huella SHA-256 (hex) del PDF; igual a la que calcula la BD en content_hash. */
export async function consentContentHash(fileContent?: string): Promise<string | undefined> {
  if (!fileContent || !fileContent.startsWith("data:")) return undefined;
  const bytes = new TextEncoder().encode(fileContent);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export type ConsentDuplicateReason = "same_file" | "same_person" | "similar_name";

export const CONSENT_DUPLICATE_LABEL: Record<ConsentDuplicateReason, string> = {
  same_file: "mismo PDF ya cargado",
  same_person: "esa persona ya tiene carta",
  similar_name: "nombre casi igual a una carta existente",
};

export type ConsentUploadFilterResult = {
  accepted: Array<{
    targetId: string;
    type: "consent";
    names: string[];
    fileName?: string;
    fileContent?: string;
    contentHash?: string;
    reportDate?: string;
    createdAt?: string;
    personKey: string;
  }>;
  skippedDuplicates: Array<{
    fileName?: string;
    personKey: string;
    reason: ConsentDuplicateReason;
    matchedName?: string;
  }>;
};

type ConsentInput = {
  targetId: string;
  type: "leads" | "consent";
  names: string[];
  fileName?: string;
  fileContent?: string;
  contentHash?: string;
  reportDate?: string;
  createdAt?: string;
};

/**
 * Filtra cargas duplicadas contra existentes y dentro del mismo lote:
 * 1. Mismo PDF (huella) en cualquier reporte.
 * 2. Misma persona: se admiten tantas cartas por nombre como leads con ese nombre
 *    (mínimo 1), así un homónimo no bloquea a otra persona.
 * 3. Nombre con 1 letra de diferencia a una carta existente y sin lead propio: typo del mismo cliente.
 */
export function filterDuplicateConsentUploads(
  items: ConsentInput[],
  existingEntries: ReportEntry[],
  leads: Lead[] = []
): ConsentUploadFilterResult {
  const accepted: ConsentUploadFilterResult["accepted"] = [];
  const skippedDuplicates: ConsentUploadFilterResult["skippedDuplicates"] = [];
  const countsByTarget = new Map<string, Map<string, number>>();
  const leadsByName = leadCountByName(leads);
  const hashes = new Set(
    existingEntries
      .filter((e) => e.type === "consent" && e.contentHash)
      .map((e) => e.contentHash as string)
  );

  for (const item of items) {
    if (item.type !== "consent") continue;
    const personKey = personKeyFromConsentInput(item);

    if (item.contentHash && hashes.has(item.contentHash)) {
      skippedDuplicates.push({ fileName: item.fileName, personKey, reason: "same_file" });
      continue;
    }

    if (!personKey) {
      if (item.contentHash) hashes.add(item.contentHash);
      accepted.push({ ...item, type: "consent", personKey: "" });
      continue;
    }

    let counts = countsByTarget.get(item.targetId);
    if (!counts) {
      counts = consentPeopleCountForTarget(existingEntries, item.targetId);
      countsByTarget.set(item.targetId, counts);
    }

    const identity = personIdentity(personKey);
    const used = counts.get(identity) || 0;
    const capacity = Math.max(1, leadsByName.get(identity) || 0);
    if (used >= capacity) {
      skippedDuplicates.push({ fileName: item.fileName, personKey, reason: "same_person" });
      continue;
    }

    if (!leadsByName.has(identity)) {
      const similar = [...counts.keys()].find((n) => fuzzyPersonMatch(identity, n) === "typo");
      if (similar) {
        skippedDuplicates.push({
          fileName: item.fileName,
          personKey,
          reason: "similar_name",
          matchedName: similar,
        });
        continue;
      }
    }

    counts.set(identity, used + 1);
    if (item.contentHash) hashes.add(item.contentHash);
    accepted.push({ ...item, type: "consent", personKey });
  }

  return { accepted, skippedDuplicates };
}

export type ConsentSyncItemResult = {
  fileName?: string;
  personKey: string;
  resolution: ConsentLeadResolution;
};

export type ConsentSyncPlan = {
  toMark: Lead[];
  linkedByEntryId: Map<string, string>; // entryId → leadId
  /** Cartas cuyo lead ya tiene carta (existente o del mismo lote): no se guardan. */
  duplicateEntryIds: Set<string>;
  results: ConsentSyncItemResult[];
  counts: {
    auto: number;
    already_realizado: number;
    ambiguous: number;
    out_of_scope: number;
    unmatched: number;
  };
};

/** Plan de sync para un lote de cartas (sin mutar estado). */
export function planConsentLeadSync(
  entries: Array<
    Pick<ReportEntry, "names" | "fileName" | "title" | "type" | "personKey"> & { id?: string }
  >,
  leads: Lead[],
  actor: MatchActor,
  existingEntries: ReportEntry[] = []
): ConsentSyncPlan {
  const toMark: Lead[] = [];
  const markIds = new Set<string>();
  const linkedByEntryId = new Map<string, string>();
  const duplicateEntryIds = new Set<string>();
  const taken = leadIdsWithCarta(existingEntries);
  const results: ConsentSyncItemResult[] = [];
  const counts = {
    auto: 0,
    already_realizado: 0,
    ambiguous: 0,
    out_of_scope: 0,
    unmatched: 0,
  };

  for (const entry of entries) {
    if (entry.type && entry.type !== "consent") continue;
    const personKey =
      entry.personKey ||
      peopleFromReportEntry(entry)[0] ||
      "";
    const resolution = resolveConsentLeadLink(
      personKey,
      leads,
      actor,
      taken,
      leadNumberTagFromLabel(entry.fileName || entry.names?.[0])
    );
    if (resolution.lead && taken.has(resolution.lead.id)) {
      if (entry.id) duplicateEntryIds.add(entry.id);
      continue;
    }
    results.push({
      fileName: entry.fileName,
      personKey,
      resolution,
    });
    counts[resolution.status] += 1;

    if (resolution.lead) {
      taken.add(resolution.lead.id);
      if (entry.id) linkedByEntryId.set(entry.id, resolution.lead.id);
    }
    if (resolution.status === "auto" && resolution.lead && !markIds.has(resolution.lead.id)) {
      markIds.add(resolution.lead.id);
      toMark.push(resolution.lead);
    }
  }

  return { toMark, linkedByEntryId, duplicateEntryIds, results, counts };
}

export type ConsentDriftReport = {
  cartasSinLead: Array<{ entryId: string; personKey: string; fileName?: string }>;
  realizadosSinCarta: Array<{
    leadId: string;
    name: string;
    leadNumber: number;
    /** Quién lo pasó a realizado (historial), si se conoce. */
    markedBy?: string;
    /** Agente asignado al lead. */
    assignedAgent?: string;
  }>;
  cartasSinVinculo: number;
  consentTotal: number;
  realizadosTotal: number;
};

function resolveMarkedBy(
  leadId: string,
  historyEvents: HistoryEvent[] | undefined
): string | undefined {
  if (!historyEvents?.length) return undefined;
  for (const ev of historyEvents) {
    if (ev.entityId !== leadId) continue;
    if (ev.type !== "lead_updated" && ev.type !== "report_uploaded") continue;
    const summary = (ev.summary || "").toLowerCase();
    const metaStatus = String(ev.meta?.status || "").toLowerCase();
    if (
      summary.includes("realizado") ||
      metaStatus === "realizado" ||
      String(ev.meta?.markedRealizado || "") === "true" ||
      Number(ev.meta?.markedRealizado || 0) > 0
    ) {
      return ev.actorName;
    }
  }
  return undefined;
}

/** Panel de desfase: cartas sin lead / realizados sin carta (por nombre). */
export function analyzeConsentLeadDrift(
  entries: ReportEntry[],
  leads: Lead[],
  targetId?: string,
  opts?: {
    profiles?: Profile[];
    historyEvents?: HistoryEvent[];
  }
): ConsentDriftReport {
  const allConsent = entries.filter((e) => e.type === "consent");
  const consent = allConsent.filter((e) => !targetId || e.targetId === targetId);
  const leadIds = new Set(leads.map((l) => l.id));

  const profileName = new Map(
    (opts?.profiles || []).map((p) => [p.id, p.fullName] as const)
  );

  // Desfase = vínculo real (linked_lead_id), no coincidencia de nombre: los homónimos no se tapan.
  const cartasSinLead: ConsentDriftReport["cartasSinLead"] = [];
  for (const e of consent) {
    if (e.linkedLeadId && leadIds.has(e.linkedLeadId)) continue;
    cartasSinLead.push({
      entryId: e.id,
      personKey: e.personKey || peopleFromReportEntry(e)[0] || "(sin nombre)",
      fileName: e.fileName,
    });
  }

  // Una carta en cualquier reporte cubre al lead (no solo la del reporte filtrado).
  const leadsConCarta = leadIdsWithCarta(allConsent);
  const realizados = leads.filter((l) => l.status === "realizado");
  const realizadosSinCarta: ConsentDriftReport["realizadosSinCarta"] = [];
  for (const l of realizados) {
    if (!leadsConCarta.has(l.id)) {
      realizadosSinCarta.push({
        leadId: l.id,
        name: `${l.firstName} ${l.lastName}`.trim(),
        leadNumber: l.leadNumber,
        markedBy: resolveMarkedBy(l.id, opts?.historyEvents),
        assignedAgent: l.assignedAgentId
          ? profileName.get(l.assignedAgentId)
          : undefined,
      });
    }
  }

  const cartasSinVinculo = consent.filter((e) => !e.linkedLeadId).length;

  return {
    cartasSinLead,
    realizadosSinCarta,
    cartasSinVinculo,
    consentTotal: consent.length,
    realizadosTotal: realizados.length,
  };
}

/** @deprecated use planConsentLeadSync */
export function leadIdsToMarkRealizadoFromCartas(
  entries: Array<Pick<ReportEntry, "names" | "fileName" | "title" | "type" | "personKey">>,
  leads: Lead[],
  actor?: MatchActor
): string[] {
  if (!actor) {
    // fallback legacy: exact only, no scope
    const ids = new Set<string>();
    for (const entry of entries) {
      if (entry.type && entry.type !== "consent") continue;
      for (const person of peopleFromReportEntry(entry)) {
        const exact = leads.filter((l) => leadFullName(l) === person && l.status !== "realizado");
        if (exact.length === 1) ids.add(exact[0].id);
      }
    }
    return [...ids];
  }
  return planConsentLeadSync(entries, leads, actor).toMark.map((l) => l.id);
}

export type CartaLinkRepair = {
  entryId: string;
  personKey: string;
  leadId: string;
  how: PersonMatchHow | "relink";
};

export type NameDuplicateGroup = {
  name: string;
  leadIds: string[];
  leadNumbers: number[];
  /** Mismo nombre pero teléfonos distintos: personas diferentes (homónimos), no error. */
  distinctPeople: boolean;
  /** Perfil de reporte del grupo (homónimos solo cuentan dentro del mismo perfil). */
  reportTargetId: string | null;
};

export type LeadCartaIntegrity = {
  /** Todo linkeado, sin vínculos rotos y sin duplicados de nombre. */
  ok: boolean;
  consentTotal: number;
  realizadosTotal: number;
  cartasSinVinculo: number;
  cartasVinculoRoto: number;
  nameDuplicateGroups: NameDuplicateGroup[];
  /** Cartas que se pueden (re)linkear de forma segura. */
  repairs: CartaLinkRepair[];
  /** Cartas que siguen sin vínculo seguro tras el plan. */
  unrepairedUnlinked: Array<{
    entryId: string;
    personKey: string;
    reason: string;
  }>;
};

const SYSTEM_ACTOR: MatchActor = { id: "system-validator", role: "admin" };

/**
 * Grupos de leads con el mismo nombre normalizado (2+),
 * solo dentro del mismo perfil de reporte (no cruza Cynthia ↔ Cristhyam).
 * Sin perfil: se agrupa por agente asignado; si tampoco hay, por «sin perfil».
 */
export function findDuplicateLeadNameGroups(leads: Lead[]): NameDuplicateGroup[] {
  const byKey = new Map<string, Lead[]>();
  for (const l of leads) {
    const n = leadFullName(l);
    if (!n) continue;
    const scope =
      l.reportTargetId ||
      (l.assignedAgentId ? `agent:${l.assignedAgentId}` : "none");
    const key = `${scope}\0${n}`;
    const arr = byKey.get(key) || [];
    arr.push(l);
    byKey.set(key, arr);
  }
  const groups: NameDuplicateGroup[] = [];
  for (const arr of byKey.values()) {
    if (arr.length < 2) continue;
    const name = leadFullName(arr[0]);
    const phones = arr.map((l) => String(l.phone || "").replace(/\D/g, ""));
    groups.push({
      name,
      leadIds: arr.map((l) => l.id),
      leadNumbers: arr.map((l) => l.leadNumber).sort((a, b) => a - b),
      distinctPeople:
        phones.every((p) => p.length >= 7) && new Set(phones).size === phones.length,
      reportTargetId: arr[0].reportTargetId ?? null,
    });
  }
  groups.sort(
    (a, b) =>
      a.name.localeCompare(b.name) ||
      String(a.reportTargetId).localeCompare(String(b.reportTargetId))
  );
  return groups;
}

/**
 * Validador continuo: detecta cartas sin link / link roto, propone repairs
 * seguros (exact/token-perm, un candidato) y reporta duplicados de nombre.
 * No marca realizado; solo vincula linkedLeadId.
 */
export function validateLeadCartaIntegrity(
  entries: ReportEntry[],
  leads: Lead[],
  actor: MatchActor = SYSTEM_ACTOR
): LeadCartaIntegrity {
  const consent = entries.filter((e) => e.type === "consent");
  const leadById = new Map(leads.map((l) => [l.id, l] as const));
  const nameDupes = findDuplicateLeadNameGroups(leads);

  const repairs: CartaLinkRepair[] = [];
  const unrepairedUnlinked: LeadCartaIntegrity["unrepairedUnlinked"] = [];
  const taken = new Set(
    consent
      .map((e) => e.linkedLeadId)
      .filter((id): id is string => !!id && leadById.has(id))
  );
  let cartasSinVinculo = 0;
  let cartasVinculoRoto = 0;

  for (const e of consent) {
    const personKey = e.personKey || peopleFromReportEntry(e)[0] || "";
    const linkedOk = !!(e.linkedLeadId && leadById.has(e.linkedLeadId));

    if (linkedOk) {
      // Refuerza personKey vacío si hay link válido
      if (!e.personKey && personKey) {
        repairs.push({
          entryId: e.id,
          personKey,
          leadId: e.linkedLeadId!,
          how: "relink",
        });
      }
      continue;
    }

    if (!e.linkedLeadId) cartasSinVinculo += 1;
    else cartasVinculoRoto += 1;

    const resolution = resolveConsentLeadLink(
      personKey,
      leads,
      actor,
      taken,
      leadNumberTagFromLabel(e.fileName || e.names?.[0])
    );
    // Link seguro: lead único claro (auto / already / out_of_scope). Ambiguous no.
    if (
      resolution.lead &&
      !taken.has(resolution.lead.id) &&
      (resolution.status === "auto" ||
        resolution.status === "already_realizado" ||
        resolution.status === "out_of_scope") &&
      (resolution.how === "exact" || resolution.how === "token-perm")
    ) {
      taken.add(resolution.lead.id);
      repairs.push({
        entryId: e.id,
        personKey: personKey || resolution.personKey,
        leadId: resolution.lead.id,
        how: resolution.how,
      });
      continue;
    }

    unrepairedUnlinked.push({
      entryId: e.id,
      personKey: personKey || "(sin nombre)",
      reason:
        resolution.reason ||
        (resolution.status === "ambiguous"
          ? "Varios leads coinciden"
          : "Sin lead seguro"),
    });
  }

  return {
    ok:
      cartasSinVinculo === 0 &&
      cartasVinculoRoto === 0 &&
      unrepairedUnlinked.length === 0 &&
      nameDupes.every((g) => g.distinctPeople),
    consentTotal: consent.length,
    realizadosTotal: leads.filter((l) => l.status === "realizado").length,
    cartasSinVinculo,
    cartasVinculoRoto,
    nameDuplicateGroups: nameDupes,
    repairs,
    unrepairedUnlinked,
  };
}

/** Aplica repairs de vínculo en memoria (no toca status del lead). */
export function applyCartaLinkRepairs(
  entries: ReportEntry[],
  repairs: CartaLinkRepair[]
): { entries: ReportEntry[]; changed: ReportEntry[] } {
  if (!repairs.length) return { entries, changed: [] };
  const byId = new Map(repairs.map((r) => [r.entryId, r] as const));
  const changed: ReportEntry[] = [];
  const next = entries.map((e) => {
    const r = byId.get(e.id);
    if (!r) return e;
    if (e.linkedLeadId === r.leadId && e.personKey === r.personKey) return e;
    const patched: ReportEntry = {
      ...e,
      linkedLeadId: r.leadId,
      personKey: r.personKey || e.personKey,
    };
    changed.push(patched);
    return patched;
  });
  return { entries: next, changed };
}
