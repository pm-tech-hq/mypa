import {
  AudioLines,
  CalendarDays,
  GraduationCap,
  Keyboard,
  ListTodo,
  StickyNote,
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
