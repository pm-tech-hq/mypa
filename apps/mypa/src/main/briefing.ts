/**
 * Daily Briefing in the main process: the written version (made by the
 * Assistant's model from the briefing's facts only, and thrown away if it
 * mentions a time that isn't in them), and the morning notification.
 */
import { randomUUID } from "node:crypto";

import { BrowserWindow, ipcMain, powerMonitor } from "electron";

import { IPC } from "../shared/api";
import {
  buildBriefing,
  cleanBriefingSettings,
  hashFacts,
  inventedTimes,
  notePrompt,
  type BriefingNote,
  type BriefingSettings,
} from "../shared/briefing";
import { atTime, dayKey } from "../shared/planner";
import type { ChatMessage } from "../shared/tutor";
import { resolveTarget } from "./assistant/agent";
import { getSettings } from "./assistant/settings";
import * as db from "./db";
import { notify, showMainWindow } from "./system";
import { streamLocal } from "./tutor/local";
import { streamProvider } from "./tutor/providers";

const briefingSettings = db.briefingSettings;

const SYSTEM =
  "You write short daily briefings for one person from a list of facts about their day. You never add anything that isn't in the facts.";

function clean(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^[\s\S]*<\/think>/i, "")
    .replace(/^\s*(?:here(?:'s| is) (?:your|the) briefing[^\n]*\n)/i, "")
    .trim();
}

let writing: AbortController | null = null;

async function ask(messages: ChatMessage[], signal: AbortSignal): Promise<{ text: string; model: string }> {
  const target = resolveTarget(getSettings().model);
  let text = "";
  if (target.kind === "local") {
    // Qwen-style models think aloud unless told not to
    const last = messages.at(-1)!;
    const msgs = [...messages.slice(0, -1), { ...last, content: `${last.content}\n/no_think` }];
    await streamLocal(randomUUID(), target.model, msgs, signal, (t) => (text += t), () => {});
  } else {
    await streamProvider(target.provider, messages, signal, (t) => (text += t));
  }
  return { text: clean(text), model: target.label };
}

/** Writes today's note from the current facts. Rejects with a readable message. */
export async function writeBriefingNote(): Promise<BriefingNote> {
  writing?.abort();
  const ctl = new AbortController();
  writing = ctl;
  const timeout = setTimeout(() => ctl.abort(), 4 * 60_000);
  try {
    const now = Date.now();
    const b = buildBriefing(db.getSnapshot(), now, { settings: briefingSettings() });
    const messages: ChatMessage[] = [
      { role: "system", content: SYSTEM },
      { role: "user", content: notePrompt(b.facts, b.day) },
    ];
    for (let attempt = 0; attempt < 2; attempt++) {
      const { text, model } = await ask(messages, ctl.signal);
      if (!text) throw new Error("The model didn't write anything. Try again.");
      const bad = inventedTimes(text, b.facts);
      if (bad.length === 0) {
        const note: BriefingNote = { day: b.day, hash: hashFacts(b.facts), text: text.slice(0, 2000), model, at: Date.now() };
        db.setMetaJson("briefingNote", note);
        db.flush();
        return note;
      }
      const hm = bad.map((m) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`).join(", ");
      messages.push(
        { role: "assistant", content: text },
        {
          role: "user",
          content: `You mentioned ${hm}, which isn't in the facts. Rewrite it using only the facts and their times exactly as given.`,
        },
      );
    }
    throw new Error("The write-up mentioned times that aren't in your day, so it wasn't kept. The list below is accurate.");
  } catch (e) {
    if (ctl.signal.aborted) throw new Error("Writing took too long and was stopped.");
    throw e instanceof Error ? e : new Error(String(e));
  } finally {
    clearTimeout(timeout);
    if (writing === ctl) writing = null;
  }
}

export function registerBriefingHandlers(snap: () => unknown): void {
  ipcMain.handle(IPC.briefingWrite, async () => {
    await writeBriefingNote();
    return snap();
  });
  ipcMain.handle(IPC.briefingClear, () => {
    db.setMetaJson("briefingNote", null);
    db.flush();
    return snap();
  });
  ipcMain.handle(IPC.briefingSettings, (_e, patch: Partial<BriefingSettings>) => {
    db.setMetaJson("briefingSettings", cleanBriefingSettings({ ...briefingSettings(), ...(patch ?? {}) }));
    db.flush();
    rescheduleMorning();
    return snap();
  });
}

/* --------------------------------------------------------------- morning -- */

let timer: NodeJS.Timeout | undefined;
/** Don't announce the morning briefing more than 3 hours late (e.g. the PC was off). */
const LATE_MS = 3 * 3_600_000;

function focusBriefing(): void {
  showMainWindow();
  for (const win of BrowserWindow.getAllWindows()) {
    const send = () => win.webContents.send(IPC.briefingFocus);
    if (win.webContents.isLoading()) win.webContents.once("did-finish-load", send);
    else send();
  }
}

function check(): void {
  clearTimeout(timer);
  let wait = 60_000;
  try {
    const s = briefingSettings();
    const now = Date.now();
    const day = dayKey(now);
    const at = atTime(day, s.morningAt);
    if (s.morning && now >= at && now - at < LATE_MS && db.getMetaRaw("briefingSentDay") !== day) {
      // only for people who use the briefing
      const snapshot = db.getSnapshot();
      if (snapshot.widgets.some((w) => w.kind === "briefing")) {
        db.setMetaRaw("briefingSentDay", day);
        db.flush();
        const b = buildBriefing(snapshot, now, { settings: s });
        notify({ title: b.greeting, body: b.headline, subtitle: "Daily Briefing", onClick: focusBriefing });
      }
    } else if (now < at) {
      wait = Math.min(wait, at - now + 500);
    }
  } catch {
    /* database not ready yet */
  }
  timer = setTimeout(check, Math.max(1000, wait));
}

export function rescheduleMorning(): void {
  clearTimeout(timer);
  timer = setTimeout(check, 500);
}

export function startMorningBriefing(): void {
  powerMonitor.on("resume", rescheduleMorning);
  check();
}
