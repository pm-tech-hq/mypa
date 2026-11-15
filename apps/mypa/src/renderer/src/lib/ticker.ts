import { useEffect, useSyncExternalStore } from "react";

/**
 * One clock for every widget that shows a running time. Nothing ticks unless
 * something on screen is running: "frame" (stopwatch hundredths) uses
 * requestAnimationFrame, "fast" a 100 ms interval; both stop while the window
 * is hidden. The time shown is always read from Date.now(), so a skipped tick
 * never makes it wrong, only a moment late.
 */
export type TickSpeed = "frame" | "fast";

let now = Date.now();
const listeners = new Set<() => void>();
const wants = new Map<symbol, TickSpeed>();
let raf = 0;
let interval = 0;

function emit(): void {
  now = Date.now();
  for (const l of listeners) l();
}

function frame(): void {
  emit();
  raf = window.requestAnimationFrame(frame);
}

function update(): void {
  window.cancelAnimationFrame(raf);
  window.clearInterval(interval);
  raf = 0;
  interval = 0;
  if (document.hidden || wants.size === 0) return;
  emit();
  if ([...wants.values()].includes("frame")) raf = window.requestAnimationFrame(frame);
  else interval = window.setInterval(emit, 100);
}

document.addEventListener("visibilitychange", update);

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** The current time, updated while `speed` is set (null = not running: no ticking). */
export function useTicker(speed: TickSpeed | null): number {
  useEffect(() => {
    if (!speed) {
      now = Date.now();
      return;
    }
    const key = Symbol();
    wants.set(key, speed);
    update();
    return () => {
      wants.delete(key);
      update();
    };
  }, [speed]);
  const t = useSyncExternalStore(subscribe, () => now);
  // when nothing ticks, still read a fresh time on each render
  return speed ? t : Date.now();
}
