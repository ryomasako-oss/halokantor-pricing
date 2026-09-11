import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

type Tone = "info" | "success" | "error";
interface Toast {
  id: number;
  text: string;
  tone: Tone;
}

const ToastContext = createContext<((text: string, tone?: Tone) => void) | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((text: string, tone: Tone = "info") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);

  const value = useMemo(() => push, [push]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="hk-toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`hk-toast ${t.tone}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return ctx;
}

/** Runs an async action, surfacing any thrown message as an error toast. */
export function useAsyncAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  useEffect(() => () => setBusy(false), []);
  const run = useCallback(
    async (fn: () => Promise<void>, successMessage?: string) => {
      setBusy(true);
      try {
        await fn();
        if (successMessage) toast(successMessage, "success");
      } catch (err) {
        toast(err instanceof Error ? err.message : "Terjadi kesalahan.", "error");
      } finally {
        setBusy(false);
      }
    },
    [toast],
  );
  return { busy, run };
}
