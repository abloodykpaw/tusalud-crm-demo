const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export function formatUsd(amount: number | null | undefined): string {
  return typeof amount === "number" && Number.isFinite(amount) ? usd.format(amount) : "—";
}

export const RECEIPT_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf"];
export const RECEIPT_MAX_BYTES = 5 * 1024 * 1024;
export const DEFAULT_WEEKLY_AMOUNT = 450;
