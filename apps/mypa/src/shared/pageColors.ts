/** Page colours: wayfinding only. Each page gets one, which tints its sidebar
 *  tile, title-bar icon and board grid so pages are easy to tell apart. They
 *  never carry state (that's the accent) or importance (the priority squares).
 *
 *  Stored as a key on `PageRow.color`. Every value holds >= 3.7:1 against
 *  white, so a white icon on a filled tile stays legible. Shared so the main
 *  process can hand out defaults. */
export const PAGE_COLORS = {
  ultramarine: "#2d57e5",
  teal: "#008781",
  coral: "#d25030",
  violet: "#7f47c7",
  green: "#2d8949",
  amber: "#bb7400",
  rose: "#cb3468",
  sky: "#0084c2",
  ink: "#000000",
} as const;

export type PageColor = keyof typeof PAGE_COLORS;

/** Order new pages are dealt colours in; "ink" is opt-in only. */
export const PAGE_COLOR_CYCLE: PageColor[] = [
  "ultramarine",
  "teal",
  "coral",
  "violet",
  "green",
  "amber",
  "rose",
  "sky",
];

export const PAGE_COLOR_LABEL: Record<PageColor, string> = {
  ultramarine: "Ultramarine",
  teal: "Teal",
  coral: "Coral",
  violet: "Violet",
  green: "Green",
  amber: "Amber",
  rose: "Rose",
  sky: "Sky",
  ink: "Ink",
};

export function isPageColor(value: unknown): value is PageColor {
  return typeof value === "string" && value in PAGE_COLORS;
}

export function pageColorHex(value: string | null | undefined): string {
  return isPageColor(value) ? PAGE_COLORS[value] : PAGE_COLORS.ink;
}

/** The first colour in the cycle no page uses yet (wraps once all are taken). */
export function nextPageColor(used: string[]): PageColor {
  const free = PAGE_COLOR_CYCLE.find((c) => !used.includes(c));
  return free ?? PAGE_COLOR_CYCLE[used.length % PAGE_COLOR_CYCLE.length]!;
}
