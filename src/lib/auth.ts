export const AUTH_EMAIL_DOMAIN = "auth.tusalud.local";

export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "");
}

export function authEmailForUsername(username: string): string {
  return `${normalizeUsername(username)}@${AUTH_EMAIL_DOMAIN}`;
}

export const MIN_PASSWORD_LENGTH = 10;

/** Contraseña aleatoria con crypto.getRandomValues (sin caracteres ambiguos). */
export function generateSecurePassword(length = 16): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%*-_";
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

export function isValidUsername(username: string): boolean {
  return /^[a-z0-9._-]{3,32}$/i.test(normalizeUsername(username));
}
