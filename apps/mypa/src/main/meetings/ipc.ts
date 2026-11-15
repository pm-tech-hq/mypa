/** The Meeting recorder's IPC, and saving a recording when the app closes mid-meeting. */
import { BrowserWindow, ipcMain, shell } from "electron";

import { MEETINGS_IPC, type MeetingEvent, type MeetingTrack } from "../../shared/meetings";
import type { MeetingOptions, StartMeetingInput } from "../../shared/types";
import { pushSnapshot } from "../broadcast";
import * as db from "../db";
import {
  appendAudio,
  autoTitle,
  deleteMeetingAudio,
  discardMeeting,
  isRecording,
  processMeeting,
  renameSpeaker,
  startMeeting,
  stopMeeting,
  summarizeMeeting,
} from "./process";

const MODEL_SIZES = new Set(["tiny", "base", "small"]);

function cleanOptions(o: MeetingOptions): MeetingOptions {
  return {
    modelSize: MODEL_SIZES.has(o?.modelSize) ? o.modelSize : "base",
    speakers: o?.speakers !== false,
    ai: typeof o?.ai === "string" && o.ai ? o.ai : "local",
    keepAudio: o?.keepAudio !== false,
  };
}

export function registerMeetingHandlers(): void {
  ipcMain.handle(MEETINGS_IPC.start, (_e, input: StartMeetingInput) => {
    const title = String(input?.title ?? "").trim().slice(0, 200) || autoTitle(Date.now());
    const eventId = typeof input?.eventId === "string" ? input.eventId : null;
    return startMeeting(title, eventId, cleanOptions(input?.options));
  });
  ipcMain.handle(MEETINGS_IPC.append, (_e, id: string, track: MeetingTrack, data: ArrayBuffer) =>
    data instanceof ArrayBuffer ? appendAudio(id, track, data) : undefined,
  );
  ipcMain.handle(MEETINGS_IPC.stop, (_e, id: string) => stopMeeting(id));
  ipcMain.handle(MEETINGS_IPC.discard, (_e, id: string) => discardMeeting(id));
  ipcMain.handle(MEETINGS_IPC.retry, (_e, id: string, options: MeetingOptions) => {
    db.resetTranscriptForRetry(id);
    pushSnapshot();
    void processMeeting(id, cleanOptions(options));
  });
  ipcMain.handle(MEETINGS_IPC.summarize, (_e, id: string, ai: string) => {
    if (typeof ai !== "string" || ai === "off") return;
    void summarizeMeeting(id, ai);
  });
  ipcMain.handle(MEETINGS_IPC.renameSpeaker, (_e, id: string, label: string, name: string) =>
    renameSpeaker(id, String(label), String(name ?? "")),
  );
  ipcMain.handle(MEETINGS_IPC.addAction, (_e, id: string, index: number) => {
    const meeting = db.getMeeting(id);
    const item = meeting?.actionItems[index];
    if (!meeting || !item || item.taskId) return;
    const owner = item.owner ? (meeting.speakerNames[item.owner] ?? item.owner) : null;
    const mine = !owner || /^(me|i)$/i.test(owner);
    const taskId = db.createTask({
      title: mine ? item.text : `${item.text} (${owner})`,
      project: "Meetings",
      section: "today",
    });
    const actionItems = meeting.actionItems.map((a, i) => (i === index ? { ...a, taskId } : a));
    db.updateMeeting(id, { actionItems });
    pushSnapshot();
  });
  ipcMain.handle(MEETINGS_IPC.openFolder, async (_e, id: string) => {
    const meeting = db.getMeeting(id);
    if (meeting?.hasAudio) await shell.openPath(meeting.audioDir);
  });
  ipcMain.handle(MEETINGS_IPC.deleteAudio, (_e, id: string) => deleteMeetingAudio(id));
}

/**
 * Asks the recorder to stop and save, and resolves once it has (or after a
 * few seconds, if the page doesn't answer: what's on disk is processed at
 * the next start either way).
 */
export function finishRecording(): Promise<void> {
  const event: MeetingEvent = { type: "finish" };
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(MEETINGS_IPC.event, event);
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = setInterval(() => {
      if (!isRecording() || Date.now() - started > 4000) {
        clearInterval(tick);
        resolve();
      }
    }, 100);
  });
}
