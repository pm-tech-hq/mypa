import { useCallback, useMemo, useSyncExternalStore } from "react";

export interface UndoItem {
  id: string;
  label: string;
  /** The widget that started it; only that widget shows the Undo bar. */
  origin: string;
}

/**
 * Deferred deletes, shared by every widget: the item disappears everywhere at
 * once, and the real delete runs after a few seconds unless undone. Pending
 * deletes are committed if the window closes first, so nothing lingers.
 */
const DELAY_MS = 6000;
const timers = new Map<string, number>();
const commits = new Map<string, () => void>();
let items: UndoItem[] = [];
const listeners = new Set<() => void>();

function emit(next: UndoItem[]) {
  items = next;
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

function finish(id: string) {
  window.clearTimeout(timers.get(id));
  timers.delete(id);
  const commit = commits.get(id);
  commits.delete(id);
  emit(items.filter((i) => i.id !== id));
  commit?.();
}

function undo(id: string) {
  window.clearTimeout(timers.get(id));
  timers.delete(id);
  commits.delete(id);
  emit(items.filter((i) => i.id !== id));
}

window.addEventListener("beforeunload", () => {
  for (const id of [...commits.keys()]) finish(id);
});

export function useUndo(origin: string) {
  const all = useSyncExternalStore(subscribe, () => items);

  const schedule = useCallback(
    (id: string, label: string, commit: () => void) => {
      window.clearTimeout(timers.get(id));
      commits.set(id, commit);
      timers.set(
        id,
        window.setTimeout(() => finish(id), DELAY_MS),
      );
      emit([...items.filter((i) => i.id !== id), { id, label, origin }]);
    },
    [origin],
  );

  const hidden = useMemo(() => new Set(all.map((i) => i.id)), [all]);
  const latest = useMemo(
    () => all.filter((i) => i.origin === origin).at(-1) ?? null,
    [all, origin],
  );
  return { hidden, latest, schedule, undo, finish };
}
