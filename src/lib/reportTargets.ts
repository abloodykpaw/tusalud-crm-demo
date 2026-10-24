import type { Profile, ReportTarget, Role } from "./types";

export function slugifyReportName(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "reporte"
  );
}

/** Perfiles a los que el actor puede asignar nombres de reporte. */
export function assignableProfilesForRole(
  profiles: Profile[],
  actorRole: Role
): Profile[] {
  const active = profiles.filter((p) => p.status === "activo");
  if (actorRole === "admin") {
    return [...active].sort((a, b) => a.fullName.localeCompare(b.fullName));
  }
  if (actorRole === "encargado") {
    return active
      .filter((p) => p.role !== "admin")
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
  }
  return [];
}

export function canAssignReportToProfile(actorRole: Role, targetProfile: Profile): boolean {
  if (actorRole === "admin") return targetProfile.status === "activo";
  if (actorRole === "encargado") {
    return targetProfile.status === "activo" && targetProfile.role !== "admin";
  }
  return false;
}

/** Reportes visibles para el usuario (agentes: solo los asignados a ellos). */
export function visibleReportTargetsForUser(
  targets: ReportTarget[],
  userId: string,
  role: Role
): ReportTarget[] {
  const active = targets.filter((t) => t.active);
  if (role !== "agente") return active;
  return active.filter((t) => t.assignedAgentId === userId);
}

export function agentHasAssignedReports(targets: ReportTarget[], userId: string): boolean {
  return targets.some((t) => t.active && t.assignedAgentId === userId);
}
