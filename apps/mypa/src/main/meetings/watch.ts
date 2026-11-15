/**
 * Offers to record when a meeting seems to start: a calendar event with a
 * meeting link reaching its start time, or a call app (Zoom, Teams, a
 * browser for Meet or Zoho…) switching the microphone on. Only while some
 * page has a Meetings widget with prompts on, and never mid-recording.
 *
 * The microphone check reads the list Windows keeps of which apps are using
 * the mic (the same one behind the taskbar's mic icon). It is only ever read.
 */
import { execFile } from "node:child_process";
import { basename } from "node:path";

import { BrowserWindow } from "electron";

import { MEETINGS_IPC, type MeetingEvent } from "../../shared/meetings";
import * as db from "../db";
import { notify } from "../system";
import { isRecording } from "./process";

const CALENDAR_TICK_MS = 30_000;
const MIC_TICK_MS = 8_000;
/** A meeting that started this recently is still worth offering. */
const GRACE_MS = 3 * 60_000;
/** After one offer, stay quiet this long (a calendar offer and the mic turning on are one meeting). */
const QUIET_MS = 10 * 60_000;

const MIC_KEY =
  "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone";

/** Apps used for calls, by the exe or package name Windows lists, and how to name them. */
const CALL_APPS: [RegExp, string][] = [
  [/zoom/i, "Zoom"],
  [/teams/i, "Teams"],
  [/webex|ciscocollab/i, "Webex"],
  [/zoho/i, "Zoho Meeting"],
  [/slack/i, "Slack"],
  [/discord/i, "Discord"],
  [/skype/i, "Skype"],
  [/whatsapp/i, "WhatsApp"],
  [/telegram/i, "Telegram"],
  [/signal/i, "Signal"],
  [/goto|gotomeeting/i, "GoTo"],
  [/ringcentral/i, "RingCentral"],
  [/chrome\.exe/i, "Chrome"],
  [/msedge\.exe/i, "Edge"],
  [/brave\.exe/i, "Brave"],
  [/firefox\.exe/i, "Firefox"],
  [/opera\.exe/i, "Opera"],
  [/vivaldi\.exe/i, "Vivaldi"],
  [/arc\.exe/i, "Arc"],
];

let lastOffer = 0;
let micInUse = new Set<string>();

function send(event: MeetingEvent): void {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(MEETINGS_IPC.event, event);
}

function offer(event: Extract<MeetingEvent, { type: "prompt" }>, body: string): void {
  lastOffer = Date.now();
  send(event);
  notify({
    title: event.reason === "calendar" ? `Record “${event.title}”?` : "Record this call?",
    body,
    onClick: () => send({ ...event, open: true }),
  });
}

/* ------------------------------------------------------------ calendar -- */

const LINK = /https?:\/\/[^\s"'<>]*(?:zoom\.us|meet\.google|teams\.(?:microsoft|live)|webex|zoho)[^\s"'<>]*/i;

function checkCalendar(): void {
  if (isRecording() || Date.now() - lastOffer < QUIET_MS || !db.meetingPromptsWanted()) return;
  const now = Date.now();
  const due = db
    .reminderCandidates(now - GRACE_MS, now + 60_000)
    .filter((e) => e.meetingUrl || LINK.test(e.location));
  if (due.length === 0) return;

  const done = db.getMetaJson<string[]>("meetingPrompted", []);
  const e = due.find((d) => !done.includes(`${d.id}|${d.start}`));
  if (!e) return;
  const cutoff = now - 86_400_000;
  db.setMetaJson("meetingPrompted", [
    ...done.filter((k) => Number(k.split("|").pop()) > cutoff),
    `${e.id}|${e.start}`,
  ]);
  offer(
    { type: "prompt", reason: "calendar", title: e.title, eventId: e.id, app: null },
    "It's starting now. Click to open myPA and record it.",
  );
}

/* ----------------------------------------------------------------- mic -- */

/** Names of call apps using the microphone right now. */
function callAppsOnMic(): Promise<Set<string>> {
  return new Promise((resolve) => {
    execFile(
      "reg",
      ["query", MIC_KEY, "/s", "/v", "LastUsedTimeStop"],
      { windowsHide: true, timeout: 5000 },
      (_err, stdout) => {
        const apps = new Set<string>();
        let key = "";
        for (const line of String(stdout ?? "").split(/\r?\n/)) {
          if (line.startsWith("HKEY_")) key = line;
          // a stop time of zero: still in use
          else if (/LastUsedTimeStop\s+REG_QWORD\s+0x0\s*$/i.test(line)) {
            const name = basename(key.replace(/#/g, "\\"));
            const match = CALL_APPS.find(([re]) => re.test(name));
            if (match) apps.add(match[1]);
          }
        }
        resolve(apps);
      },
    );
  });
}

async function checkMic(): Promise<void> {
  const now = await callAppsOnMic();
  const started = [...now].filter((a) => !micInUse.has(a));
  micInUse = now;
  if (started.length === 0 || isRecording() || Date.now() - lastOffer < QUIET_MS) return;
  if (!db.meetingPromptsWanted()) return;
  const app = started[0]!;
  offer(
    { type: "prompt", reason: "mic", title: `${app} call`, eventId: null, app },
    `${app} is using your microphone. Click to open myPA and record the call.`,
  );
}

export function startMeetingWatch(): void {
  setInterval(checkCalendar, CALENDAR_TICK_MS);
  if (process.platform === "win32") {
    // what's already on the mic at startup isn't a call that just started
    void callAppsOnMic().then((apps) => {
      micInUse = apps;
      setInterval(() => void checkMic(), MIC_TICK_MS);
    });
  }
}
