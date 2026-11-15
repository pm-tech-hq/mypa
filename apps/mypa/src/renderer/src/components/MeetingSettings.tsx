import { useEffect, useState } from "react";

import type { TutorConfig } from "../../../shared/tutor";
import {
  DEFAULT_MEETING_SETTINGS,
  type MeetingSettings,
  type WhisperModelSize,
  type WidgetRow,
} from "../../../shared/types";
import { useReadyStore } from "../lib/store";

/** The microphones Windows offers (without the "Default"/"Communications" aliases), kept current as devices come and go. */
function useMicrophones(): MediaDeviceInfo[] | null {
  const [mics, setMics] = useState<MediaDeviceInfo[] | null>(null);
  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const all = await navigator.mediaDevices.enumerateDevices();
        if (live)
          setMics(
            all.filter(
              (d) => d.kind === "audioinput" && d.deviceId !== "default" && d.deviceId !== "communications",
            ),
          );
      } catch {
        if (live) setMics([]);
      }
    };
    void load();
    navigator.mediaDevices.addEventListener("devicechange", load);
    return () => {
      live = false;
      navigator.mediaDevices.removeEventListener("devicechange", load);
    };
  }, []);
  return mics;
}

/** The Meetings widget's settings. They apply to recordings started after a change. */
export function MeetingSettingsForm({ widget }: { widget: WidgetRow }) {
  const { actions } = useReadyStore();
  const s: MeetingSettings = { ...DEFAULT_MEETING_SETTINGS, ...widget.settings };
  const set = (patch: Partial<MeetingSettings>) =>
    void actions.updateWidgetSettings(widget.id, patch);
  const [config, setConfig] = useState<TutorConfig | null>(null);
  useEffect(() => {
    void window.mypa.tutor.getConfig().then(setConfig);
  }, []);
  const mics = useMicrophones();
  const missing = s.meetingMic !== "" && mics !== null && !mics.some((m) => m.deviceId === s.meetingMic);

  return (
    <>
      <label className="wsettings__field">
        <span className="wsettings__label">Microphone</span>
        <select
          className="wsettings__input"
          value={s.meetingMic}
          onChange={(e) => set({ meetingMic: e.target.value })}
        >
          <option value="">Automatic</option>
          {missing && <option value={s.meetingMic}>A microphone that isn't connected</option>}
          {mics?.map((m, i) => (
            <option key={m.deviceId} value={m.deviceId}>
              {m.label || `Microphone ${i + 1}`}
            </option>
          ))}
        </select>
        <span className="wsettings__hint">
          Automatic uses the Windows default, unless it sends no sound at all (like a phone-camera
          app's mic when the phone isn't connected). Then it tries your other microphones.
          {missing && " The chosen one isn't connected, so Automatic is used."}
        </span>
      </label>

      <label className="wsettings__field">
        <span className="wsettings__label">Transcription accuracy</span>
        <select
          className="wsettings__input"
          value={s.modelSize}
          onChange={(e) => set({ modelSize: e.target.value as WhisperModelSize })}
        >
          <option value="tiny">Fast: ~40 MB</option>
          <option value="base">Balanced: ~75 MB</option>
          <option value="small">Most accurate: ~250 MB, slower</option>
        </select>
        <span className="wsettings__hint">
          Runs on this computer. Each size downloads once, the first time it's used. These models
          understand English.
        </span>
      </label>

      <label className="wsettings__field">
        <span className="wsettings__label">AI for the notes</span>
        <select
          className="wsettings__input"
          value={s.meetingAi}
          onChange={(e) => set({ meetingAi: e.target.value })}
        >
          <option value="local">Built-in (offline)</option>
          {config?.providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
          <option value="off">Off: transcript only</option>
        </select>
        <span className="wsettings__hint">
          The built-in model keeps everything on this computer. Ollama and LM Studio do too; any
          other provider receives the transcript. Models are set up in the Tutor.
        </span>
      </label>

      <label className="wsettings__toggle">
        <input
          type="checkbox"
          checked={s.meetingSpeakers}
          onChange={(e) => set({ meetingSpeakers: e.target.checked })}
        />
        <span>
          Tell the other people apart
          <small>
            Labels them Speaker 1, Speaker 2… by voice (a ~26 MB model). Off: everyone else is
            “Them”.
          </small>
        </span>
      </label>

      <label className="wsettings__toggle">
        <input
          type="checkbox"
          checked={s.meetingPrompt}
          onChange={(e) => set({ meetingPrompt: e.target.checked })}
        />
        <span>
          Offer to record when a call starts
          <small>
            When a calendar meeting with a call link begins, or Zoom, Teams, a browser or another
            call app turns on your microphone.
          </small>
        </span>
      </label>

      <label className="wsettings__toggle">
        <input
          type="checkbox"
          checked={s.meetingKeepAudio}
          onChange={(e) => set({ meetingKeepAudio: e.target.checked })}
        />
        <span>
          Keep the audio
          <small>About 40 MB an hour. Off: the audio is deleted once it's transcribed.</small>
        </span>
      </label>
    </>
  );
}
