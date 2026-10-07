/**
 * myPA design tokens — the visual language shared by every app in the monorepo.
 *
 * Minimalist black & white, #f2f2f2 ground, Poppins.
 * These mirror the CSS custom properties in ../styles.css; keep the two in sync.
 */

export const color = {
  white: "#ffffff",
  black: "#000000",
  grey: "#f2f2f2",

  bg: "#f2f2f2",
  surface: "#ffffff",
  sunken: "#f7f7f7",
  fg: "#000000",
  fg2: "#3a3a3a",
  muted: "#666666",
  faint: "#8a8a8a",
  border: "#e5e5e5",
  borderStrong: "#cccccc",
  hover: "#f0f0f0",
  press: "#e6e6e6",
  danger: "#c42b1c",
} as const;

/** Ultramarine: the one interactive colour (actions, focus, selection, today, progress). */
export const accent = {
  base: "#234be9",
  hover: "#1c3fcc",
  press: "#1633b1",
  ink: "#1f42d0",
  fg: "#ffffff",
  soft: "#eef2ff",
  soft2: "#dde5ff",
  line: "#a0bdff",
} as const;

/** Priority marks — importance only. Use as a small mark, never a fill. */
export const priority = {
  high: "#cf3b3b",
  medium: "#e08a1e",
  low: "#9aa0a6",
} as const;

export type PriorityLevel = keyof typeof priority;

export const font = {
  sans: '"Poppins", system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  size: {
    "2xs": "11px",
    xs: "12px",
    sm: "13px",
    md: "14px",
    lg: "16px",
    xl: "20px",
  },
  weight: {
    regular: 400,
    medium: 500,
    semibold: 600,
  },
} as const;

/** Containers 12, controls 8, inline marks 4. No pills. */
export const radius = {
  xs: "4px",
  sm: "6px",
  md: "8px",
  lg: "12px",
} as const;

export const space = {
  1: "4px",
  2: "8px",
  3: "12px",
  4: "16px",
  5: "24px",
  6: "32px",
} as const;

export const shadow = {
  1: "0 1px 1px rgba(0, 0, 0, 0.03), 0 2px 6px -1px rgba(0, 0, 0, 0.05)",
  2: "0 1px 2px rgba(0, 0, 0, 0.05), 0 16px 36px -10px rgba(0, 0, 0, 0.2)",
  pop: "0 1px 2px rgba(0, 0, 0, 0.06), 0 10px 28px -6px rgba(0, 0, 0, 0.18)",
} as const;

export const motion = {
  easeOut: "cubic-bezier(0.23, 1, 0.32, 1)",
  easeInOut: "cubic-bezier(0.77, 0, 0.175, 1)",
  fast: "120ms",
  base: "180ms",
  slow: "240ms",
} as const;

export const tokens = { color, accent, priority, font, radius, space, shadow, motion } as const;

export type Tokens = typeof tokens;
