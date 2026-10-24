/** Contador global fijo (esquina) — total de ítems cargados. */
export function GlobalTotalBadge({
  label,
  total,
  position = "bottom-right",
}: {
  label: string;
  total: number;
  position?: "bottom-right" | "top-right";
}) {
  return (
    <aside className={`global-total-badge ${position}`} aria-live="polite">
      <span className="global-total-label">{label}</span>
      <strong className="global-total-value">{total.toLocaleString("es-VE")}</strong>
    </aside>
  );
}
