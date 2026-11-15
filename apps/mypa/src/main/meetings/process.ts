/**
 * A meeting from first byte to finished notes. While recording, each track's
 * audio (webm/opus from the recorder) is appended to its own file every few
 * seconds, so a crash loses seconds, not the meeting. Once stopped, the
 * tracks are transcribed on-device and the notes written, each step saved
 * as it finishes so a restart picks up where it left off.
 */
import { existsSync, statSync } from "node:fs";
import { appendFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

import { app } from "electron";

import type { MeetingTrack } from "../../shared/meetings";
import type { MeetingOptions } from "../../shared/types";
import { pushSnapshot } from "../broadcast";
import * as db from "../db";
import { decodeToPcm } from "../transcribe/ffmpeg";
import { dropEcho, transcriptText, weave } from "../transcribe/segments";
import { transcribeMeeting } from "../transcribe/whisper";
import { writeNotes } from "./summary";

const FILES: Record<MeetingTrack, string> = { me: "me.webm", them: "them.webm" };

export function meetingsRoot(): string {
  return join(app.getPath("userData"), "meetings");
}

/* ------------------------------------------------------------ recording -- */

/** Pending writes per "<id>:<track>", so pieces land in order. */
const writes = new Map<string, Promise<void>>();
/** Meetings being recorded right now. */
const recording = new Set<string>();

export function isRecording(): boolean {
  return recording.size > 0;
}

export async function startMeeting(
  title: string,
  eventId: string | null,
  options: MeetingOptions,
): Promise<string> {
  const meeting = db.createMeeting({
    title,
    eventId,
    audioDir: (id) => join(meetingsRoot(), id),
    options,
  });
  await mkdir(meeting.audioDir, { recursive: true });
  recording.add(meeting.id);
  pushSnapshot();
  return meeting.id;
}

export function appendAudio(id: string, track: MeetingTrack, data: ArrayBuffer): Promise<void> {
  if (!recording.has(id) || !(track in FILES)) return Promise.resolve();
  const meeting = db.getMeeting(id);
  if (!meeting) return Promise.resolve();
  const key = `${id}:${track}`;
  const next = (writes.get(key) ?? Promise.resolve())
    .then(() => appendFile(join(meeting.audioDir, FILES[track]), Buffer.from(data)))
    .catch((err: unknown) => console.error("[meetings] couldn't save audio:", err));
  writes.set(key, next);
  return next;
}

async function settleWrites(id: string): Promise<void> {
  for (const track of Object.keys(FILES)) {
    const key = `${id}:${track}`;
    await writes.get(key);
    writes.delete(key);
  }
}

export async function stopMeeting(id: string): Promise<void> {
  if (!recording.delete(id)) return;
  await settleWrites(id);
  const meeting = db.getMeeting(id);
  if (!meeting) return;
  db.updateMeeting(id, { endedAt: Date.now() });
  db.updateTranscriptStatus(id, "pending");
  pushSnapshot();
  void processMeeting(id);
}

export async function discardMeeting(id: string): Promise<void> {
  recording.delete(id);
  await settleWrites(id);
  await deleteMeeting(id);
}

export async function deleteMeeting(id: string): Promise<void> {
  const meeting = db.getMeeting(id);
  db.deleteTranscript(id);
  pushSnapshot();
  if (meeting) await removeAudio(meeting.audioDir);
}

async function removeAudio(dir: string): Promise<void> {
  // only ever our own folders
  if (!dir.startsWith(meetingsRoot())) return;
  await rm(dir, { recursive: true, force: true }).catch(() => {});
}

export async function deleteMeetingAudio(id: string): Promise<void> {
  const meeting = db.getMeeting(id);
  if (!meeting) return;
  await removeAudio(meeting.audioDir);
  db.updateMeeting(id, { hasAudio: false });
  pushSnapshot();
}

/* ----------------------------------------------------------- processing -- */

function trackPath(dir: string, track: MeetingTrack): string | null {
  const p = join(dir, FILES[track]);
  return existsSync(p) && statSync(p).size > 0 ? p : null;
}

function wordCount(text: string): number {
  const words = text.replace(/^\[[^\]]*\] [^:]+:/gm, "").trim();
  return words ? words.split(/\s+/).length : 0;
}

export async function processMeeting(id: string, options?: MeetingOptions): Promise<void> {
  try {
    const meeting = db.getMeeting(id);
    if (!meeting) return;
    if (options) db.updateMeeting(id, { options });
    const opts = options ?? meeting.options;
    if (!meeting.hasAudio) throw new Error("The recording's audio was deleted.");

    db.updateTranscriptStatus(id, "processing");
    db.updateTranscriptProgress(id, 0);
    pushSnapshot();

    const mePath = trackPath(meeting.audioDir, "me");
    const themPath = trackPath(meeting.audioDir, "them");
    if (!mePath && !themPath) throw new Error("Nothing was recorded.");
    const me = mePath ? await decodeToPcm(mePath) : null;
    const them = themPath ? await decodeToPcm(themPath) : null;
    const durationMs = Math.max(me?.durationMs ?? 0, them?.durationMs ?? 0);

    const utterances = await transcribeMeeting(
      { me: me?.audio ?? null, them: them?.audio ?? null },
      opts.modelSize,
      opts.speakers,
      (pct) => {
        db.updateTranscriptProgress(id, pct);
        pushSnapshot();
      },
    );
    const turns = weave(dropEcho(utterances));
    const segments = turns.map(({ start, end, speaker, text }) => ({ start, end, speaker, text }));
    const text = transcriptText(segments, meeting.speakerNames);
    db.updateMeeting(id, { segments });
    db.completeTranscript(id, text, durationMs, wordCount(text));
    if (!opts.keepAudio) {
      await removeAudio(meeting.audioDir);
      db.updateMeeting(id, { hasAudio: false });
    }
    pushSnapshot();
  } catch (err) {
    db.failTranscript(id, err instanceof Error ? err.message : String(err));
    pushSnapshot();
    return;
  }
  const opts = db.getMeeting(id)?.options;
  if (opts && opts.ai !== "off") await summarizeMeeting(id, opts.ai);
  else {
    db.updateMeeting(id, { summaryStatus: "off" });
    pushSnapshot();
  }
}

/* ------------------------------------------------------------- summary -- */

/** One summary at a time: the built-in model runs one job at a time anyway. */
let summaries: Promise<unknown> = Promise.resolve();
const running = new Map<string, AbortController>();

export function summarizeMeeting(id: string, ai: string): Promise<void> {
  running.get(id)?.abort();
  const ctrl = new AbortController();
  running.set(id, ctrl);
  db.updateMeeting(id, { summaryStatus: "waiting", summaryError: null });
  pushSnapshot();
  const job = summaries.then(() => writeSummary(id, ai, ctrl.signal));
  summaries = job.catch(() => {});
  return job.finally(() => {
    if (running.get(id) === ctrl) running.delete(id);
  });
}

async function writeSummary(id: string, ai: string, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  const row = db.getTranscriptById(id);
  const meeting = db.getMeeting(id);
  if (!row || !meeting || row.status !== "done") return;
  if (!row.text.trim()) {
    db.updateMeeting(id, {
      summaryStatus: "error",
      summaryError: "No speech was heard in this recording.",
    });
    pushSnapshot();
    return;
  }
  try {
    db.updateMeeting(id, { summaryStatus: "running", options: { ...meeting.options, ai } });
    pushSnapshot();
    const notes = await writeNotes(row.text, ai, signal, () => {});
    if (signal.aborted) return;
    // keep To-do links for items that survived a rewrite
    const kept = new Map(meeting.actionItems.map((a) => [a.text, a.taskId]));
    db.updateMeeting(id, {
      summary: notes.summary,
      decisions: notes.decisions,
      actionItems: notes.actionItems.map((a) => ({ ...a, taskId: kept.get(a.text) ?? null })),
      summaryStatus: "done",
      summaryError: null,
    });
    if (notes.title && !meeting.eventId && isAutoTitle(row.title)) db.renameTranscript(id, notes.title);
  } catch (err) {
    if (signal.aborted) return;
    db.updateMeeting(id, {
      summaryStatus: "error",
      summaryError: err instanceof Error ? err.message : String(err),
    });
  }
  pushSnapshot();
}

/** The name a meeting gets when it isn't on the calendar, until the notes give it a better one. */
export function autoTitle(at: number): string {
  const d = new Date(at);
  return `Meeting · ${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}

function isAutoTitle(title: string): boolean {
  return title.startsWith("Meeting · ");
}

/* ------------------------------------------------------------ speakers -- */

export function renameSpeaker(id: string, label: string, name: string): void {
  const meeting = db.getMeeting(id);
  if (!meeting || label === "Me") return;
  const names = { ...meeting.speakerNames };
  // a colon or line break would break the "Name: words" lines
  const clean = name.replace(/[:\r\n]+/g, " ").trim().slice(0, 60);
  if (clean && clean !== label) names[label] = clean;
  else delete names[label];
  db.updateMeeting(id, { speakerNames: names });
  const text = transcriptText(meeting.segments, names);
  db.setTranscriptText(id, text, wordCount(text));
  pushSnapshot();
}

/* ------------------------------------------------------------- startup -- */

/** Finishes what a closed or crashed app left: recordings that were never
 *  stopped, and transcriptions or summaries that were cut off. */
export function resumeMeetings(): void {
  for (const id of db.unfinishedMeetingIds()) {
    const meeting = db.getMeeting(id);
    if (!meeting) continue;
    // it ended when its audio was last written to
    const written = (["me", "them"] as const)
      .map((t) => trackPath(meeting.audioDir, t))
      .map((p) => (p ? statSync(p).mtimeMs : 0));
    db.updateMeeting(id, { endedAt: Math.max(meeting.startedAt, ...written) });
    db.updateTranscriptStatus(id, "pending");
  }
  const { transcribe, summarize } = db.interruptedMeetingIds();
  for (const id of transcribe) void processMeeting(id);
  for (const id of summarize) {
    const ai = db.getMeeting(id)?.options.ai ?? "local";
    void summarizeMeeting(id, ai);
  }
}
