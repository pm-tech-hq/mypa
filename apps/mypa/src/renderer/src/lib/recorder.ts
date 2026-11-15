/**
 * The Meeting recorder. One for the whole app, outside any widget, so a
 * recording carries on while you switch pages or the widget is closed.
 *
 * Two tracks: your microphone ("me") and everything this computer plays
 * ("them", the system sound the web API calls loopback). Each is recorded as
 * webm/opus and handed to the main process every few seconds, which appends
 * it to a file: a crash loses seconds, not the meeting.
 */
import { useSyncExternalStore } from "react";

import type { MeetingEvent, MeetingTrack } from "../../../shared/meetings";
import type { StartMeetingInput } from "../../../shared/types";

/** How often recorded audio is saved to disk. */
const SLICE_MS = 5000;
/** Below this level (0–1 RMS) a track counts as silent. */
const SILENT = 0.004;

export type RecorderStatus = "idle" | "starting" | "recording" | "stopping";

export interface MeetingPrompt {
  reason: "calendar" | "mic";
  title: string;
  eventId: string | null;
  app: string | null;
  at: number;
}

export interface RecorderState {
  status: RecorderStatus;
  id: string | null;
  title: string;
  startedAt: number;
  /** Which tracks are being recorded. */
  mic: boolean;
  /** The microphone being recorded, e.g. "Microphone (Realtek(R) Audio)". */
  micLabel: string;
  system: boolean;
  /** 0–1, for the level meters. */
  micLevel: number;
  systemLevel: number;
  /** How long the computer's sound has been silent, ms. */
  systemQuietMs: number;
  /** Why the last start failed, or what's missing. */
  error: string | null;
  warning: string | null;
  /** A meeting myPA noticed starting. */
  prompt: MeetingPrompt | null;
}

const IDLE: RecorderState = {
  status: "idle",
  id: null,
  title: "",
  startedAt: 0,
  mic: false,
  micLabel: "",
  system: false,
  micLevel: 0,
  systemLevel: 0,
  systemQuietMs: 0,
  error: null,
  warning: null,
  prompt: null,
};

let state: RecorderState = IDLE;
const listeners = new Set<() => void>();

function set(patch: Partial<RecorderState>): void {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useRecorder(): RecorderState {
  return useSyncExternalStore(subscribe, () => state);
}

/* ------------------------------------------------------------ capture -- */

interface Capture {
  track: MeetingTrack;
  stream: MediaStream;
  recorder: MediaRecorder;
  analyser: AnalyserNode;
}

let captures: Capture[] = [];
let audioContext: AudioContext | null = null;
let meter: number | undefined;
/** Saves in flight, so stopping waits for the last piece. */
let saving: Promise<unknown> = Promise.resolve();

function level(analyser: AnalyserNode, buf: Float32Array<ArrayBuffer>): number {
  analyser.getFloatTimeDomainData(buf);
  let sum = 0;
  for (const x of buf) sum += x * x;
  return Math.sqrt(sum / buf.length);
}

/** The computer's sound. The web API only offers it alongside a screen, so the picture is dropped at once. */
async function systemSound(): Promise<MediaStream | null> {
  try {
    const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    for (const v of display.getVideoTracks()) {
      v.stop();
      display.removeTrack(v);
    }
    return display.getAudioTracks().length ? display : null;
  } catch {
    return null;
  }
}

/** How long a microphone gets to send any sound at all before it counts as dead. */
const PROBE_MS = 1500;
/**
 * Peak level (−80 dBFS) a working microphone passes. A real mic's noise floor
 * in a quiet room sits around −70 to −45 dBFS; a dead virtual mic (Camo with no
 * phone) flickers at the last bit, −90 dBFS.
 */
const ALIVE_PEAK = 1e-4;

/**
 * Whether a microphone sends more than near-digital silence. Virtual mics
 * (Camo, OBS, Voicemod…) often sit as the Windows default and send nothing
 * while their app isn't streaming. A real mic in a quiet room still has a
 * noise floor, so it's probed raw: no noise suppression to flatten that floor.
 */
async function sendsSound(deviceId: string): Promise<boolean> {
  let stream: MediaStream | null = null;
  const ctx = new AudioContext();
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: { exact: deviceId },
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    const until = Date.now() + PROBE_MS;
    while (Date.now() < until) {
      await new Promise((r) => setTimeout(r, 100));
      analyser.getFloatTimeDomainData(buf);
      if (buf.some((x) => Math.abs(x) > ALIVE_PEAK)) return true;
    }
    return false;
  } catch {
    return false;
  } finally {
    stream?.getTracks().forEach((t) => t.stop());
    void ctx.close().catch(() => {});
  }
}

/** Strips Chromium's "Default - " / "Communications - " prefix, so the entry matches its device. */
function plainLabel(label: string): string {
  return label.replace(/^(Default|Communications) - /, "");
}

interface Mic {
  stream: MediaStream;
  label: string;
  /** The default (or chosen) microphone was silent, so another one is used. */
  switchedFrom: string | null;
  /** Every microphone tried was silent: recording anyway, but say so. */
  silent: boolean;
}

/** The microphone: the chosen one, else the Windows default, skipping any that send only silence. */
async function microphone(preferredId: string): Promise<Mic | null> {
  let inputs: MediaDeviceInfo[];
  try {
    inputs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audioinput");
  } catch {
    inputs = [];
  }
  const first = inputs.find((d) => d.deviceId === preferredId) ?? inputs.find((d) => d.deviceId === "default");
  const order = [
    ...(first ? [first] : []),
    ...inputs.filter((d) => d.deviceId !== "default" && d.deviceId !== "communications"),
  ];
  const tried = new Set<string>();
  let chosen: MediaDeviceInfo | null = null;
  for (const d of order) {
    const label = plainLabel(d.label);
    if (tried.has(label)) continue;
    tried.add(label);
    if (await sendsSound(d.deviceId)) {
      chosen = d;
      break;
    }
  }

  const use = chosen ?? first ?? null;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        ...(use ? { deviceId: { exact: use.deviceId } } : {}),
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    const label = plainLabel(use?.label || stream.getAudioTracks()[0]?.label || "Microphone");
    const firstLabel = first ? plainLabel(first.label) : null;
    return {
      stream,
      label,
      switchedFrom: chosen && firstLabel && firstLabel !== label ? firstLabel : null,
      silent: !chosen && order.length > 0,
    };
  } catch {
    return null;
  }
}

function capture(id: string, track: MeetingTrack, stream: MediaStream, ctx: AudioContext): Capture {
  const recorder = new MediaRecorder(stream, {
    mimeType: "audio/webm;codecs=opus",
    audioBitsPerSecond: 48_000,
  });
  recorder.ondataavailable = (e) => {
    if (e.data.size === 0) return;
    saving = saving.then(async () =>
      window.mypa.meetings.append(id, track, await e.data.arrayBuffer()),
    );
  };
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  ctx.createMediaStreamSource(stream).connect(analyser);
  for (const t of stream.getAudioTracks()) t.addEventListener("ended", onTrackEnded);
  recorder.start(SLICE_MS);
  return { track, stream, recorder, analyser };
}

/** A device was unplugged or the sound stopped being shared: once nothing's left, stop. */
function onTrackEnded(): void {
  const live = captures.some((c) => c.stream.getAudioTracks().some((t) => t.readyState === "live"));
  if (!live && state.status === "recording") void stopRecording();
}

/** `micId`: the microphone picked in the widget's settings, "" for automatic. */
export async function startRecording(input: StartMeetingInput, micId = ""): Promise<void> {
  if (state.status !== "idle") return;
  set({ ...IDLE, status: "starting", title: input.title, prompt: null });

  // The computer's sound first, while the click that started this still counts as one.
  const system = await systemSound();
  const found = await microphone(micId);
  const mic = found?.stream ?? null;
  if (!system && !mic) {
    set({
      status: "idle",
      error:
        "myPA couldn't hear your microphone or this computer's sound. Check that a microphone is connected and that Windows lets apps use it.",
    });
    return;
  }

  let id: string;
  try {
    id = await window.mypa.meetings.start(input);
  } catch (err) {
    for (const s of [system, mic]) s?.getTracks().forEach((t) => t.stop());
    set({ status: "idle", error: err instanceof Error ? err.message : String(err) });
    return;
  }

  audioContext = new AudioContext();
  captures = [];
  if (mic) captures.push(capture(id, "me", mic, audioContext));
  if (system) captures.push(capture(id, "them", system, audioContext));

  const startedAt = Date.now();
  set({
    status: "recording",
    id,
    startedAt,
    mic: Boolean(mic),
    micLabel: found?.label ?? "",
    system: Boolean(system),
    warning: !mic
      ? "Your microphone isn't being recorded, only the meeting's sound."
      : found?.silent
        ? `${found.label} is sending no sound, so your voice won't be heard. Pick another microphone in this widget's settings.`
        : found?.switchedFrom
          ? `${found.switchedFrom} is silent, so myPA is using ${found.label} instead.`
          : !system
            ? "Only your microphone is being recorded: myPA couldn't capture this computer's sound."
            : null,
  });

  const buf = new Float32Array(1024);
  let last = Date.now();
  meter = window.setInterval(() => {
    const now = Date.now();
    const levels: Record<MeetingTrack, number> = { me: 0, them: 0 };
    for (const c of captures) levels[c.track] = level(c.analyser, buf);
    set({
      micLevel: levels.me,
      systemLevel: levels.them,
      systemQuietMs: levels.them > SILENT ? 0 : state.systemQuietMs + (now - last),
    });
    last = now;
  }, 100);
}

async function finish(): Promise<string | null> {
  const id = state.id;
  window.clearInterval(meter);
  await Promise.all(
    captures.map(
      (c) =>
        new Promise<void>((resolve) => {
          if (c.recorder.state === "inactive") return resolve();
          // the last piece arrives just before "stop"
          c.recorder.addEventListener("stop", () => resolve(), { once: true });
          c.recorder.stop();
        }),
    ),
  );
  for (const c of captures) c.stream.getTracks().forEach((t) => t.stop());
  captures = [];
  await audioContext?.close().catch(() => {});
  audioContext = null;
  await saving.catch(() => {});
  return id;
}

export async function stopRecording(): Promise<void> {
  if (state.status !== "recording") return;
  set({ status: "stopping" });
  const id = await finish();
  if (id) await window.mypa.meetings.stop(id);
  set({ ...IDLE, prompt: state.prompt });
}

export async function discardRecording(): Promise<void> {
  if (state.status !== "recording") return;
  set({ status: "stopping" });
  const id = await finish();
  if (id) await window.mypa.meetings.discard(id);
  set({ ...IDLE, prompt: state.prompt });
}

export function dismissPrompt(): void {
  set({ prompt: null });
}

export function clearError(): void {
  set({ error: null });
}

/* --------------------------------------------------------- from main -- */

let wired = false;

/** Listens for the main process: meetings noticed starting, and the app closing. */
export function wireRecorder(): void {
  if (wired) return;
  wired = true;
  window.mypa.meetings.onEvent((e: MeetingEvent) => {
    if (e.type === "finish") void stopRecording();
    else if (state.status === "idle")
      set({
        prompt: { reason: e.reason, title: e.title, eventId: e.eventId, app: e.app, at: Date.now() },
      });
  });
}
