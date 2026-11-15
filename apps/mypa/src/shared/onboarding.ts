/**
 * First-launch guide: the areas a new user can pick, the widgets each one
 * sets up, and the checks main applies to what the guide sends back.
 * Plain data, shared by the guide (renderer) and main.
 */
import type { WidgetKind } from "./types";

export type AreaId = "work" | "study" | "home" | "money" | "journal";

export interface StarterArea {
  id: AreaId;
  label: string;
  blurb: string;
  /** The page it makes: title and a key from PAGE_ICONS. */
  page: { title: string; icon: string };
  widgets: WidgetKind[];
}

/** The Home page every new user gets, whatever they pick. */
export const HOME_WIDGETS: WidgetKind[] = ["briefing", "todo", "capture", "reminders"];

export const STARTER_AREAS: StarterArea[] = [
  {
    id: "work",
    label: "Work and projects",
    blurb: "Plan your day around meetings and keep projects moving.",
    page: { title: "Work", icon: "briefcase" },
    widgets: ["projects", "planner", "calendar", "email"],
  },
  {
    id: "study",
    label: "Study",
    blurb: "Revision timetables, flashcards and a tutor for your notes.",
    page: { title: "Study", icon: "book-open" },
    widgets: ["study", "flashcards", "tutor", "transcribe"],
  },
  {
    id: "home",
    label: "Home and errands",
    blurb: "Shopping lists, kitchen timers and quick conversions.",
    page: { title: "Home life", icon: "shopping-cart" },
    widgets: ["shopping", "timer", "converter", "calculator"],
  },
  {
    id: "money",
    label: "Money",
    blurb: "Track spending, budgets and monthly bills.",
    page: { title: "Money", icon: "dollar-sign" },
    widgets: ["expenses", "calculator"],
  },
  {
    id: "journal",
    label: "Journal and wellbeing",
    blurb: "A private page for each day, and what the Assistant knows about you.",
    page: { title: "Journal", icon: "heart" },
    widgets: ["journal", "memory"],
  },
];

/** Where onboarding stands. Databases from before the guide existed have no record and never see it. */
export type OnboardingState = "pending" | "done";

export interface StarterWidget {
  kind: WidgetKind;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** What the guide asks main to build: the Home layout and a page per picked area. */
export interface StarterPlan {
  home: StarterWidget[];
  pages: { area: AreaId; widgets: StarterWidget[] }[];
}

export interface StarterResult {
  /** Pages made, by area. Areas whose page already existed are left out. */
  created: AreaId[];
  /** True when Home was laid out (only when it still held at most one widget). */
  homeSet: boolean;
}

const ALL_KINDS = new Set<WidgetKind>([...HOME_WIDGETS, ...STARTER_AREAS.flatMap((a) => a.widgets)]);

export function isStarterKind(k: unknown): k is WidgetKind {
  return typeof k === "string" && ALL_KINDS.has(k as WidgetKind);
}

/** What the user wants to be called: one line, no control characters, at most 40 characters. */
export function cleanName(raw: unknown): string {
  return String(raw ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40)
    .trim();
}
