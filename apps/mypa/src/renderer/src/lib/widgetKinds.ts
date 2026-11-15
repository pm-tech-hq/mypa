import {
  AudioLines,
  BellRing,
  BookHeart,
  FolderKanban,
  BookOpenCheck,
  Sunrise,
  Calculator,
  Timer,
  Ruler,
  Brain,
  CalendarClock,
  Inbox,
  ShoppingCart,
  CalendarDays,
  GraduationCap,
  Keyboard,
  Layers,
  ListTodo,
  Mail,
  StickyNote,
  Video,
  Wallet,
  type LucideIcon,
} from "lucide-react";

import type { WidgetKind, WidgetRow } from "../../../shared/types";

export interface WidgetKindMeta {
  kind: WidgetKind;
  label: string;
  description: string;
  icon: LucideIcon;
}

/** One description of every widget kind, shared by the add menu, the empty
 *  board and each widget's header, so they never drift apart. */
export const WIDGET_KINDS: WidgetKindMeta[] = [
  {
    kind: "todo",
    label: "To-do list",
    description: "Today, backlog and goals",
    icon: ListTodo,
  },
  {
    kind: "calendar",
    label: "Calendar",
    description: "Agenda and month view",
    icon: CalendarDays,
  },
  {
    kind: "transcribe",
    label: "Transcribe",
    description: "Audio, video or a page to text",
    icon: AudioLines,
  },
  {
    kind: "tutor",
    label: "Tutor",
    description: "Learn from your transcripts",
    icon: GraduationCap,
  },
  {
    kind: "typing",
    label: "Typing",
    description: "Type faster while you learn your notes",
    icon: Keyboard,
  },
  {
    kind: "flashcards",
    label: "Flashcards",
    description: "Cards from your transcripts that quiz you",
    icon: Layers,
  },
  {
    kind: "email",
    label: "Email",
    description: "Gmail, Zoho and other inboxes in one place",
    icon: Mail,
  },
  {
    kind: "meeting",
    label: "Meetings",
    description: "Record calls, then get the transcript and notes",
    icon: Video,
  },
  {
    kind: "projects",
    label: "Project Tracker",
    description: "Projects on a board, with progress and health",
    icon: FolderKanban,
  },
  {
    kind: "memory",
    label: "Personal Memory",
    description: "What the Assistant knows about you: check it, fix it, hide it or delete it",
    icon: Brain,
  },
  {
    kind: "converter",
    label: "Unit Converter",
    description: "Exact conversions for length, weight, cooking, temperature and more",
    icon: Ruler,
  },
  {
    kind: "timer",
    label: "Timer & Stopwatch",
    description: "Countdown timers that ring wherever you are, and a stopwatch with laps",
    icon: Timer,
  },
  {
    kind: "calculator",
    label: "Calculator",
    description: "Exact sums with a tape you can reuse; percentages and scientific keys",
    icon: Calculator,
  },
  {
    kind: "briefing",
    label: "Daily Briefing",
    description: "Your day at a glance: schedule, what needs you, and what's next",
    icon: Sunrise,
  },
  {
    kind: "study",
    label: "Study Planner",
    description: "Subjects, exams and study sessions that fit around your calendar",
    icon: BookOpenCheck,
  },
  {
    kind: "journal",
    label: "Journal",
    description: "A private page for each day, with prompts and moods",
    icon: BookHeart,
  },
  {
    kind: "shopping",
    label: "Shopping Lists",
    description: "Lists sorted by aisle, with buy-again",
    icon: ShoppingCart,
  },
  {
    kind: "capture",
    label: "Quick Capture",
    description: "Jot anything; it lands in the right place",
    icon: Inbox,
  },
  {
    kind: "planner",
    label: "Daily Planner",
    description: "Plan your day around your meetings",
    icon: CalendarClock,
  },
  {
    kind: "reminders",
    label: "Reminders",
    description: "Alerts at the right time, in plain words",
    icon: BellRing,
  },
  {
    kind: "expenses",
    label: "Expenses",
    description: "Spending, budgets and bills, month by month",
    icon: Wallet,
  },
  {
    kind: "blank",
    label: "Note",
    description: "Notes and checklists",
    icon: StickyNote,
  },
];

const BY_KIND = new Map(WIDGET_KINDS.map((m) => [m.kind, m]));

export function widgetKindMeta(kind: WidgetKind): WidgetKindMeta {
  return BY_KIND.get(kind) ?? WIDGET_KINDS[WIDGET_KINDS.length - 1]!;
}

/** Widgets created before a kind had its own preset were all titled "Widget";
 *  show the kind's name for those instead of the placeholder. */
export function widgetDisplayTitle(widget: WidgetRow): string {
  // "Widget" and the old "Blank" were never chosen by the user; show the kind's name.
  if (widget.title === "Widget" || (widget.kind === "blank" && widget.title === "Blank")) {
    return widgetKindMeta(widget.kind).label;
  }
  return widget.title;
}
