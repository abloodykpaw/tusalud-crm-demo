import type { ReactNode } from "react";
import { Icons } from "@/components/Icons";

export function DayFolder({
  label,
  dayKey,
  count,
  open,
  isToday,
  onToggle,
  children,
  countLabel = "ítems",
  subtitle,
}: {
  label: string;
  dayKey: string;
  count: number;
  open: boolean;
  isToday?: boolean;
  onToggle: () => void;
  children: ReactNode;
  countLabel?: string;
  /** Ej. "Numeración del día · #1 → #12" */
  subtitle?: string;
}) {
  return (
    <article className={`day-folder${open ? " open" : ""}${isToday ? " today" : ""}`}>
      <button
        type="button"
        className="day-folder-toggle"
        aria-expanded={open}
        onClick={onToggle}
      >
        <span className="day-folder-icon" aria-hidden>
          {Icons.folder}
          <span className="day-folder-badge">{count}</span>
        </span>
        <span className="day-folder-meta">
          <strong>{label}</strong>
          <span>{subtitle || `Carpeta automática · ${dayKey}`}</span>
        </span>
        <span className="day-folder-count">
          {count} {countLabel}
        </span>
        <span className="day-folder-chevron" aria-hidden>
          {Icons.chevronDown}
        </span>
      </button>
      {open && <div className="day-folder-body">{children}</div>}
    </article>
  );
}
