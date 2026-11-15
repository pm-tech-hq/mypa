/** The Meeting recorder: records a call on this computer (your mic and the
 *  computer's sound as two tracks), then transcribes and summarizes it, all
 *  on-device. Shared between the main process and the UI. */
import type { MeetingOptions, StartMeetingInput } from "./types";

export type MeetingTrack = "me" | "them";

/** Pushed by main. */
export type MeetingEvent =
  /** A meeting looks like it's starting: offer to record it. */
  | {
      type: "prompt";
      reason: "calendar" | "mic";
      title: string;
      eventId: string | null;
      /** The app using the mic ("Zoom", "Brave"…), for `mic`. */
      app: string | null;
      /** The user clicked the notification: show the Meetings widget. */
      open?: boolean;
    }
  /** The app is closing: stop and save the recording now. */
  | { type: "finish" };

export const MEETINGS_IPC = {
  start: "meetings:start",
  append: "meetings:append",
  stop: "meetings:stop",
  discard: "meetings:discard",
  retry: "meetings:retry",
  summarize: "meetings:summarize",
  renameSpeaker: "meetings:renameSpeaker",
  addAction: "meetings:addAction",
  openFolder: "meetings:openFolder",
  deleteAudio: "meetings:deleteAudio",
  event: "meetings:event",
} as const;

export interface MypaMeetings {
  /** Starts a meeting record; resolves with its id. */
  start: (input: StartMeetingInput) => Promise<string>;
  /** Appends a piece of one track's audio (webm/opus) to its file. */
  append: (id: string, track: MeetingTrack, data: ArrayBuffer) => Promise<void>;
  /** Recording finished: transcribe and summarize it in the background. */
  stop: (id: string) => Promise<void>;
  /** Throws the recording away. */
  discard: (id: string) => Promise<void>;
  /** Transcribe again (e.g. after it failed), with these options. */
  retry: (id: string, options: MeetingOptions) => Promise<void>;
  /** Write the summary again with this AI ("local" or a provider id). */
  summarize: (id: string, ai: string) => Promise<void>;
  /** Give a speaker a name; an empty name goes back to "Speaker N". */
  renameSpeaker: (id: string, label: string, name: string) => Promise<void>;
  /** Adds an action item to the To-do list (Today). */
  addAction: (id: string, index: number) => Promise<void>;
  openFolder: (id: string) => Promise<void>;
  deleteAudio: (id: string) => Promise<void>;
  onEvent: (cb: (e: MeetingEvent) => void) => () => void;
}
