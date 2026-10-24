/**
 * Normalización / extracción de nombres de cartas de consentimiento.
 * Compartido por scripts de auditoría, dedupe y sync.
 */

export function normalizePersonName(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Extrae el nombre de persona desde nombre de archivo o label de carta. */
export function extractPersonFromCartaLabel(raw) {
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
  s = s.replace(/(\s+(copia|copy))?(\s+\d+)*$/, "");
  return s.trim();
}

function tokens(s) {
  return normalizePersonName(s).split(" ").filter(Boolean);
}

function tokenSetEqual(a, b) {
  if (a.length !== b.length || a.length < 2) return false;
  return [...a].sort().join(" ") === [...b].sort().join(" ");
}

function levenshtein(a, b) {
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

/**
 * @returns {false | "exact" | "token-perm" | "typo"}
 */
export function fuzzyPersonMatch(cartaName, leadName) {
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
