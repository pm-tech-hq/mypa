import { useEffect } from "react";

/**
 * A clicked reminder notification asks for that reminder to be shown. The App
 * may have to switch pages (or add a Reminders widget) first, so the request
 * is held here until a Reminders widget mounts and takes it.
 */
let pending: string | null = null;
const listeners = new Set<(id: string) => void>();

export function requestReminderFocus(id: string): void {
  pending = id;
  for (const l of listeners) l(id);
}

/** Calls `cb` with a requested reminder id — one waiting from before mount, then any new ones. */
export function useReminderFocus(cb: (id: string) => void): void {
  useEffect(() => {
    const take = (id: string) => {
      if (pending !== id) return;
      pending = null;
      cb(id);
    };
    if (pending) take(pending);
    listeners.add(take);
    return () => {
      listeners.delete(take);
    };
  }, [cb]);
}
