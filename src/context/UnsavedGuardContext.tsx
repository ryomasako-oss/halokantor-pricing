/* Lets a page (e.g. the quote editor) block in-app navigation while it has
   unsaved edits. Plain React Router navigation (NavLink clicks) unmounts the
   page directly - it doesn't go through beforeunload - so without this, a
   page with unsaved edits would silently lose them the moment someone clicks
   another nav link. A ref (not state) on purpose: the guard is read
   imperatively from click handlers, not rendered. */

import { createContext, useContext, useEffect, useRef } from "react";

type Guard = () => boolean;

const UnsavedGuardContext = createContext<{
  setGuard: (guard: Guard | null) => void;
  confirmLeave: () => boolean;
} | null>(null);

export function UnsavedGuardProvider({ children }: { children: React.ReactNode }) {
  const guardRef = useRef<Guard | null>(null);

  const value = useRef({
    setGuard: (guard: Guard | null) => {
      guardRef.current = guard;
    },
    confirmLeave: () => guardRef.current?.() ?? true,
  }).current;

  return <UnsavedGuardContext.Provider value={value}>{children}</UnsavedGuardContext.Provider>;
}

/** Called by a page to install/remove its "is it safe to navigate away?" check. */
export function useUnsavedGuard(guard: Guard | null) {
  const ctx = useContext(UnsavedGuardContext);
  if (!ctx) throw new Error("useUnsavedGuard must be used inside UnsavedGuardProvider");
  useEffect(() => {
    ctx.setGuard(guard);
    return () => ctx.setGuard(null);
  }, [ctx, guard]);
}

/** Called by navigation UI before it moves to a new route. */
export function useConfirmLeave() {
  const ctx = useContext(UnsavedGuardContext);
  if (!ctx) throw new Error("useConfirmLeave must be used inside UnsavedGuardProvider");
  return ctx.confirmLeave;
}
