import type { ReportType } from "./types";

export type ReportFileKind = "txt" | "pdf";

/** Límite práctico para guardar PDF en la base (data URL). */
export const MAX_CONSENT_PDF_BYTES = 8 * 1024 * 1024;

/** Máximo de PDF por carga múltiple en cartas de consentimiento. */
export const MAX_CONSENT_PDF_BATCH = 30;

export function parseReportNames(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

export function formatReportDate(now = new Date()): string {
  const day = pad2(now.getDate());
  const month = pad2(now.getMonth() + 1);
  const year = now.getFullYear();
  return `${day}/${month}/${year}`;
}

export function formatReportTime(now = new Date()): string {
  return `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
}

export function getReportFileKind(fileName?: string, fileContent?: string): ReportFileKind {
  if (fileContent?.startsWith("data:application/pdf")) return "pdf";
  if (fileName?.toLowerCase().endsWith(".pdf")) return "pdf";
  return "txt";
}

export function isPdfFileName(name: string) {
  return name.toLowerCase().endsWith(".pdf");
}

export function isTxtFileName(name: string) {
  return name.toLowerCase().endsWith(".txt");
}

export function fileStem(fileName: string) {
  return fileName.replace(/\.[^.]+$/, "").trim();
}

export function buildReportFileName(
  type: ReportType,
  now = new Date(),
  originalName?: string,
  fileKind: ReportFileKind = "txt"
): string {
  if (originalName && (isTxtFileName(originalName) || isPdfFileName(originalName))) {
    return originalName;
  }
  const day = pad2(now.getDate());
  const month = pad2(now.getMonth() + 1);
  const year = String(now.getFullYear()).slice(-2);
  if (type === "consent") {
    return fileKind === "pdf" ? `cartas cc ${day}-${month}.pdf` : `cartas cc ${day}-${month}.txt`;
  }
  return `${day}-${month}-${year} Reporte de Leads Nuevos.txt`;
}

export function buildReportTitle(type: ReportType, count: number): string {
  if (type === "consent") return "CARTAS DE CONSENTIMIENTO";
  return `Leads Nuevos de ${count} Persona${count !== 1 ? "s" : ""}`;
}

export type ReportUploadPreview = {
  names: string[];
  fileName: string;
  reportDate: string;
  reportTime: string;
  title: string;
  sourceFile: string;
  capturedAt: Date;
  fileKind: ReportFileKind;
  /** Para PDF: data URL; para .txt suele ir vacío hasta publicar. */
  fileContent?: string;
};

export function buildReportUploadPreview(
  names: string[],
  type: ReportType,
  sourceFile: string,
  now = new Date(),
  extras?: { fileKind?: ReportFileKind; fileContent?: string }
): ReportUploadPreview {
  const fileKind = extras?.fileKind || (isPdfFileName(sourceFile) ? "pdf" : "txt");
  return {
    names,
    fileName: buildReportFileName(type, now, sourceFile, fileKind),
    reportDate: formatReportDate(now),
    reportTime: formatReportTime(now),
    title: buildReportTitle(type, names.length),
    sourceFile,
    capturedAt: now,
    fileKind,
    fileContent: extras?.fileContent,
  };
}

export function refreshPreviewMeta(
  preview: ReportUploadPreview,
  type: ReportType,
  names: string[]
): ReportUploadPreview {
  return {
    ...preview,
    names,
    title: buildReportTitle(type, names.length),
  };
}

export function buildReportFileContent(names: string[]): string {
  return names.join("\n");
}

export function isPdfDataUrl(content?: string) {
  return !!content?.startsWith("data:application/pdf");
}

function triggerDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadReportTxt(fileName: string, names: string[], fileContent?: string) {
  const content = fileContent ?? buildReportFileContent(names);
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  triggerDownload(blob, fileName.endsWith(".txt") ? fileName : `${fileName}.txt`);
}

/** Descarga el archivo original (.txt o PDF listo). */
export function downloadReportFile(fileName: string, names: string[], fileContent?: string) {
  if (isPdfDataUrl(fileContent)) {
    const base64 = fileContent!.split(",")[1] || "";
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: "application/pdf" });
    triggerDownload(blob, fileName.toLowerCase().endsWith(".pdf") ? fileName : `${fileName}.pdf`);
    return;
  }
  if (getReportFileKind(fileName, fileContent) === "pdf") {
    // PDF sin contenido embebido: no se puede reconstruir
    throw new Error("Este PDF no está disponible para descarga");
  }
  downloadReportTxt(fileName, names, fileContent);
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("No se pudo leer el archivo"));
    reader.readAsDataURL(file);
  });
}

export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("No se pudo leer el archivo"));
    reader.readAsText(file, "UTF-8");
  });
}

/** Ejecuta async en paralelo con límite de concurrencia (más rápido sin saturar). */
export async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (!items.length) return [];
  const limit = Math.max(1, Math.min(concurrency, items.length));
  const out = new Array<R>(items.length);
  let cursor = 0;

  async function worker() {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      out[index] = await fn(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: limit }, () => worker()));
  return out;
}

/** Lectura paralela de PDF (concurrencia limitada para no congelar el navegador). */
export const PDF_READ_CONCURRENCY = 6;
/** Subidas paralelas a Supabase. */
export const REPORT_UPLOAD_CONCURRENCY = 4;

const COLLAPSE_NAME_THRESHOLD = 5;

export { COLLAPSE_NAME_THRESHOLD };

export const REPORT_EDIT_WINDOW_MS = 5 * 60 * 1000;

export function getReportEditRemainingMs(createdAt: string, now = Date.now()): number {
  const elapsed = now - new Date(createdAt).getTime();
  return Math.max(0, REPORT_EDIT_WINDOW_MS - elapsed);
}

export function canAgentEditReport(
  entry: { uploadedBy: string; createdAt: string },
  agentId: string | undefined,
  now = Date.now()
): boolean {
  if (!agentId || entry.uploadedBy !== agentId) return false;
  return getReportEditRemainingMs(entry.createdAt, now) > 0;
}

export type ReportManageAccess = {
  allowed: boolean;
  /** Admin: sin límite de tiempo ni dueño. */
  unlimited: boolean;
  remainingMs: number;
  /** Quién actúa: admin | encargado | uploader */
  reason: "none" | "admin" | "encargado_window" | "own_window";
};

/**
 * Permisos de corregir/eliminar reportes y cartas:
 * - Admin: siempre, cualquier reporte
 * - Encargado: 5 min sobre cualquier reporte (equipo) o el suyo
 * - Agente: 5 min solo sobre lo que él cargó
 */
export function getReportManageAccess(
  entry: { uploadedBy: string; createdAt: string },
  viewer: { id: string; role: string } | null | undefined,
  now = Date.now()
): ReportManageAccess {
  if (!viewer?.id) {
    return { allowed: false, unlimited: false, remainingMs: 0, reason: "none" };
  }
  if (viewer.role === "admin") {
    return {
      allowed: true,
      unlimited: true,
      remainingMs: REPORT_EDIT_WINDOW_MS,
      reason: "admin",
    };
  }
  const remainingMs = getReportEditRemainingMs(entry.createdAt, now);
  if (remainingMs <= 0) {
    return { allowed: false, unlimited: false, remainingMs: 0, reason: "none" };
  }
  if (viewer.role === "encargado") {
    return {
      allowed: true,
      unlimited: false,
      remainingMs,
      reason: entry.uploadedBy === viewer.id ? "own_window" : "encargado_window",
    };
  }
  if (viewer.role === "agente" && entry.uploadedBy === viewer.id) {
    return { allowed: true, unlimited: false, remainingMs, reason: "own_window" };
  }
  return { allowed: false, unlimited: false, remainingMs: 0, reason: "none" };
}

/** @deprecated Prefer getReportManageAccess */
export function canEditOwnRecentReport(
  entry: { uploadedBy: string; createdAt: string },
  userId: string | undefined,
  now = Date.now()
): boolean {
  return canAgentEditReport(entry, userId, now);
}

export function formatEditCountdown(ms: number): string {
  const totalSec = Math.ceil(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${String(sec).padStart(2, "0")}`;
}
