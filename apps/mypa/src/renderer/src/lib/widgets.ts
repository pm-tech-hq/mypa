/** Board geometry â€” drag + resize maths. Persistence lives in the SQLite store. */

import type { WidgetKind } from "../../../shared/types";

export type Rect = { x: number; y: number; w: number; h: number };
export type Size = { w: number; h: number };

export const MIN_W = 240;
export const MIN_H = 160;

const CURSOR = {
  drag: "grabbing",
  n: "ns-resize",
  s: "ns-resize",
  e: "ew-resize",
  w: "ew-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
  nw: "nwse-resize",
  se: "nwse-resize",
} as const;

export type Handle = keyof typeof CURSOR;

export function cursorFor(handle: Handle): string {
  return CURSOR[handle];
}

/** Clamp a value into [min, max], tolerating an inverted range. */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, Math.max(min, max)));
}

/** Clamp a rectangle to the board, keeping the minimum size. */
export function clampRect(r: Rect, bounds: { w: number; h: number }): Rect {
  const w = Math.min(r.w, Math.max(MIN_W, bounds.w));
  const h = Math.min(r.h, Math.max(MIN_H, bounds.h));
  return {
    w,
    h,
    x: clamp(r.x, 0, bounds.w - w),
    y: clamp(r.y, 0, bounds.h - h),
  };
}

/**
 * Given a drag/resize handle and the pointer delta since the gesture started,
 * return the widget's new rectangle â€” respecting the minimum size and the board.
 */
export function resolveRect(
  handle: Handle,
  start: Rect,
  dx: number,
  dy: number,
  bounds: { w: number; h: number },
): Rect {
  let { x, y, w, h } = start;

  if (handle === "drag") {
    x = start.x + dx;
    y = start.y + dy;
  }
  if (handle.includes("e")) w = start.w + dx;
  if (handle.includes("s")) h = start.h + dy;
  if (handle.includes("w")) {
    w = start.w - dx;
    x = start.x + dx;
  }
  if (handle.includes("n")) {
    h = start.h - dy;
    y = start.y + dy;
  }

  if (w < MIN_W) {
    if (handle.includes("w")) x -= MIN_W - w;
    w = MIN_W;
  }
  if (h < MIN_H) {
    if (handle.includes("n")) y -= MIN_H - h;
    h = MIN_H;
  }

  return clampRect({ x, y, w, h }, bounds);
}

/* ------------------------------------------------- responsive layout -- */

/** Gap kept between tiled / auto-placed widgets and the board edge. */
export const GAP = 12;

/** Default footprint per kind — mirrors the presets in main/db.ts. */
const DEFAULT_SIZE: Record<WidgetKind, Size> = {
  todo: { w: 480, h: 620 },
  calendar: { w: 640, h: 500 },
  transcribe: { w: 480, h: 600 },
  tutor: { w: 480, h: 640 },
  typing: { w: 560, h: 660 },
  flashcards: { w: 520, h: 660 },
  blank: { w: 340, h: 240 },
  /** Placeholder only: custom widgets pass their manifest size instead. */
  custom: { w: 360, h: 320 },
};

/**
 * Widgets are stored in the pixel space of a reference board (the board size
 * when the app opened). Rendering scales them to the live board size, so
 * resizing the window resizes the widgets proportionally — and undoes itself
 * when the window returns to its old size.
 */
export function scaleRect(r: Rect, ref: Size, bounds: Size): Rect {
  const sx = bounds.w / ref.w;
  const sy = bounds.h / ref.h;
  return clampRect({ x: r.x * sx, y: r.y * sy, w: r.w * sx, h: r.h * sy }, bounds);
}

/** Inverse of `scaleRect` — live pixels back into reference space. */
export function unscaleRect(r: Rect, ref: Size, bounds: Size): Rect {
  const sx = ref.w / bounds.w;
  const sy = ref.h / bounds.h;
  return {
    x: Math.round(r.x * sx),
    y: Math.round(r.y * sy),
    w: Math.round(r.w * sx),
    h: Math.round(r.h * sy),
  };
}

function overlaps(a: Rect, b: Rect, pad: number): boolean {
  return (
    a.x < b.x + b.w + pad &&
    b.x < a.x + a.w + pad &&
    a.y < b.y + b.h + pad &&
    b.y < a.y + a.h + pad
  );
}

/**
 * First free spot (reading order) for a new widget of `kind`, shrinking it
 * towards the minimum size if needed. Returns null when the board is full.
 */
export function findFreeSpot(
  kind: WidgetKind,
  taken: Rect[],
  bounds: Size,
  size?: Size,
): Rect | null {
  const preset = size ?? DEFAULT_SIZE[kind];
  const maxW = Math.max(MIN_W, bounds.w - GAP * 2);
  const maxH = Math.max(MIN_H, bounds.h - GAP * 2);
  const STEP = 16;

  for (const factor of [1, 0.8, 0.65, 0.5]) {
    const w = Math.round(Math.max(MIN_W, Math.min(preset.w * factor, maxW)));
    const h = Math.round(Math.max(MIN_H, Math.min(preset.h * factor, maxH)));
    for (let y = GAP; y + h <= bounds.h - GAP; y += STEP) {
      for (let x = GAP; x + w <= bounds.w - GAP; x += STEP) {
        const candidate = { x, y, w, h };
        if (taken.every((t) => !overlaps(t, candidate, GAP / 2))) return candidate;
      }
    }
  }
  return taken.length === 0
    ? { x: GAP, y: GAP, w: Math.min(preset.w, maxW), h: Math.min(preset.h, maxH) }
    : null;
}

/**
 * Tile `count` widgets across the whole board: pick the column count whose
 * cells are closest to a comfortable 4:3 while still respecting the minimum
 * size; the last row stretches so nothing is left empty.
 */
export function tileLayout(count: number, bounds: Size): Rect[] {
  if (count === 0) return [];

  let bestCols = 1;
  let bestScore = -Infinity;
  for (let cols = 1; cols <= count; cols++) {
    const rows = Math.ceil(count / cols);
    const cw = (bounds.w - GAP * (cols + 1)) / cols;
    const ch = (bounds.h - GAP * (rows + 1)) / rows;
    const fits = cw >= MIN_W && ch >= MIN_H;
    const score = fits
      ? -Math.abs(Math.log(cw / ch / (4 / 3)))
      : -1000 + Math.min(cw / MIN_W, ch / MIN_H);
    if (score > bestScore) {
      bestScore = score;
      bestCols = cols;
    }
  }

  const cols = bestCols;
  const rows = Math.ceil(count / cols);
  const ch = (bounds.h - GAP * (rows + 1)) / rows;
  const out: Rect[] = [];
  for (let row = 0; row < rows; row++) {
    const inRow = row === rows - 1 ? count - cols * (rows - 1) : cols;
    const cw = (bounds.w - GAP * (inRow + 1)) / inRow;
    for (let i = 0; i < inRow; i++) {
      out.push({
        x: Math.round(GAP + i * (cw + GAP)),
        y: Math.round(GAP + row * (ch + GAP)),
        w: Math.round(cw),
        h: Math.round(ch),
      });
    }
  }
  return out;
}
