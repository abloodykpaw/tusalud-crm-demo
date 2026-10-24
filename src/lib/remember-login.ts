import type { Role } from "./types";
import { normalizeUsername } from "./auth";

const STORAGE_KEY = "tusalud-remembered-login";

/** Solo identidad en el dispositivo; la contraseña vive en Supabase Auth (hasheada). */
export type RememberedLogin = {
  username: string;
  fullName: string;
  role: Role;
};

export function loadRememberedLogin(): RememberedLogin | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RememberedLogin & { password?: string };
    if (!parsed.username) return null;
    return {
      username: normalizeUsername(parsed.username),
      fullName: parsed.fullName || parsed.username,
      role: parsed.role || "agente",
    };
  } catch {
    return null;
  }
}

export function saveRememberedLogin(data: RememberedLogin): void {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      fullName: data.fullName,
      role: data.role,
      username: normalizeUsername(data.username),
    })
  );
}

export function clearRememberedLogin(): void {
  localStorage.removeItem(STORAGE_KEY);
}
