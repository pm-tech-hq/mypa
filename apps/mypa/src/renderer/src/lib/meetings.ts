/** Pure helpers for the Meetings widget. */

import type {
  MeetingOptions,
  MeetingRow,
  MeetingSettings,
  Snapshot,
  TranscriptRow,
} from "../../../shared/types";
import { mergeEvents, type AgendaItem } from "./calendar";

/** How a recording is processed, from the widget's settings. */
export function meetingOptions(s: MeetingSettings): MeetingOptions {
  return {
    modelSize: s.modelSize,
    speakers: s.meetingSpeakers,
    ai: s.meetingAi,
    keepAudio: s.meetingKeepAudio,
  };
}

export interface Meeting {
  row: TranscriptRow;
  meeting: MeetingRow;
}

/** Recorded meetings, newest first. */
export function meetingsOf(snapshot: Snapshot): Meeting[] {
  const rows = new Map(snapshot.transcripts.map((t) => [t.id, t]));
  return snapshot.meetings.flatMap((meeting) => {
    const row = rows.get(meeting.id);
    return row ? [{ row, meeting }] : [];
  });
}

export interface Line {
  time: string;
  name: string;
  text: string;
}

const LINE = /^\[(\d+:\d{2}(?::\d{2})?)\] ([^:]+): (.*)$/;

/** The transcript's "[m:ss] Name: words" lines. */
export function parseTranscript(text: string): Line[] {
  const out: Line[] = [];
  for (const raw of text.split("\n")) {
    const m = LINE.exec(raw);
    if (m) out.push({ time: m[1]!, name: m[2]!, text: m[3]! });
    else if (raw.trim() && out.length) out[out.length - 1]!.text += ` ${raw.trim()}`;
  }
  return out;
}

/** The speakers in a transcript as found ("Me", "Speaker 1"…), in order of first word. */
export function speakerLabels(lines: Line[], names: Record<string, string>): string[] {
  const byName = new Map(Object.entries(names).map(([label, name]) => [name, label]));
  const out: string[] = [];
  for (const l of lines) {
    const label = byName.get(l.name) ?? l.name;
    if (!out.includes(label)) out.push(label);
  }
  return out;
}

/** No blue: that's yours (the accent). */
const HUES = [152, 28, 280, 345, 185, 95, 55, 310];

/** A steady colour per speaker; you are always the accent. */
export function speakerColor(label: string, labels: string[]): string {
  if (label === "Me") return "var(--ds-accent)";
  const others = labels.filter((l) => l !== "Me");
  const i = Math.max(0, others.indexOf(label));
  return `hsl(${HUES[i % HUES.length]} 55% 42%)`;
}

const LINK = /https?:\/\/[^\s"'<>]*(?:zoom\.us|meet\.google|teams\.(?:microsoft|live)|webex|zoho)[^\s"'<>]*/i;

/** The call link of a calendar event: its meeting link, or one in its place or notes. */
export function callLink(e: AgendaItem): string | null {
  return e.meetingUrl ?? LINK.exec(e.location)?.[0] ?? LINK.exec(e.notes)?.[0] ?? null;
}

/** A call that's on now or starts within 15 minutes, to offer recording it. */
export function currentCall(snapshot: Snapshot, now: number): AgendaItem | null {
  const events = mergeEvents(
    snapshot.calendarEvents,
    snapshot.calendarRemoteEvents,
    snapshot.calendarAccounts,
  );
  return (
    events.find(
      (e) =>
        !e.allDay &&
        e.myStatus !== "declined" &&
        e.end > now &&
        e.start - now < 15 * 60_000 &&
        callLink(e) !== null,
    ) ?? null
  );
}

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}
