import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useStore } from "@/lib/store";
import { Icons } from "./Icons";

export type ToastKind = "success" | "error" | "info";

type ToastCtx = { toast: (msg: string, kind?: ToastKind) => void };

const Ctx = createContext<ToastCtx>({ toast: () => {} });

const DURATION: Record<ToastKind, number> = { success: 3200, info: 3600, error: 6000 };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<{ id: string; msg: string; kind: ToastKind }[]>([]);

  const dismiss = useCallback((id: string) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (msg: string, kind: ToastKind = "success") => {
      const id = crypto.randomUUID();
      setItems((prev) => [...prev.slice(-4), { id, msg, kind }]);
      setTimeout(() => dismiss(id), DURATION[kind]);
    },
    [dismiss]
  );

  return (
    <Ctx.Provider value={{ toast }}>
      {children}
      <div className="toast-container" aria-live="polite">
        {items.map((t) => (
          <div
            key={t.id}
            className={`toast ${t.kind}`}
            role={t.kind === "error" ? "alert" : "status"}
          >
            <span className="toast-icon" aria-hidden="true">
              {t.kind === "success" ? Icons.check : t.kind === "error" ? "!" : "i"}
            </span>
            <span>{t.msg}</span>
            <button
              type="button"
              className="toast-close"
              aria-label="Cerrar"
              onClick={() => dismiss(t.id)}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  return useContext(Ctx);
}

/** Muestra como toast de error los fallos de guardado en la nube del store. */
export function SyncErrorToaster() {
  const { syncError } = useStore();
  const { toast } = useToast();
  const shown = useRef<string | null>(null);
  useEffect(() => {
    if (!syncError || shown.current === syncError.id) return;
    shown.current = syncError.id;
    toast(syncError.message, "error");
  }, [syncError, toast]);
  return null;
}
