import { useEffect, useMemo, useState, type ReactNode } from "react";

import {
  AlertCircle,
  CalendarClock,
  ChevronRight,
  Loader2,
  Mic,
  Square,
  Video,
  Volume2,
  X,
} from "lucide-react";

import {
  DEFAULT_MEETING_SETTINGS,
  type MeetingSettings,
  type WidgetRow,
} from "../../../shared/types";
import { meetingName } from "../lib/calendar";
import {
  callLink,
  currentCall,
  formatClock,
  meetingOptions,
  meetingsOf,
  type Meeting,
} from "../lib/meetings";
import {
  clearError,
  discardRecording,
  dismissPrompt,
  startRecording,
  stopRecording,
  useRecorder,
  type RecorderState,
} from "../lib/recorder";
import { useReadyStore } from "../lib/store";
import { formatCreatedAt, formatDuration } from "../lib/transcribe";
import { useUndo } from "../lib/useUndo";
import "../styles/meeting.css";
import { MeetingDetail } from "./MeetingDetail";
import { Button } from "./ui/button";
import { UndoToast } from "./UndoToast";

/** A noticed meeting stays on offer this long. */
const PROMPT_MS = 15 * 60_000;
/** The meeting's sound silent this long while recording: say so. */
const QUIET_WARN_MS = 30_000;

export function MeetingWidget({ widget }: { widget: WidgetRow }) {
  const { snapshot, actions } = useReadyStore();
  const settings: MeetingSettings = { ...DEFAULT_MEETING_SETTINGS, ...widget.settings };
  const rec = useRecorder();
  const undo = useUndo(widget.id);
  const [openId, setOpenId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  const meetings = useMemo(
    () => meetingsOf(snapshot).filter((m) => !undo.hidden.has(m.row.id)),
    [snapshot, undo.hidden],
  );
  const call = currentCall(snapshot, now);
  const open = meetings.find((m) => m.row.id === openId) ?? null;

  const start = (title: string, eventId: string | null) => {
    // a call on right now is what's being recorded, unless told otherwise
    const onNow = !eventId && call && call.start <= Date.now() ? call : null;
    void startRecording(
      {
        title: title.trim() || onNow?.title || "",
        eventId: eventId ?? onNow?.id ?? null,
        options: meetingOptions(settings),
      },
      settings.meetingMic,
    );
    setName("");
  };

  const remove = (m: Meeting) => {
    if (openId === m.row.id) setOpenId(null);
    undo.schedule(m.row.id, `Deleted “${m.row.title}”`, () => void actions.deleteTranscript(m.row.id));
  };

  const busy = rec.status !== "idle";
  const prompt = rec.prompt && now - rec.prompt.at < PROMPT_MS && !busy ? rec.prompt : null;

  return (
    <div className="mtg">
      {busy ? (
        <RecordingPanel rec={rec} />
      ) : open ? null : (
        <div className="mtg__start">
          {prompt && (
            <div className="mtg__offer" role="status">
              <span className="mtg__offer-icon" aria-hidden>
                {prompt.reason === "mic" ? <Mic size={14} /> : <CalendarClock size={14} />}
              </span>
              <span className="mtg__offer-text">
                {prompt.reason === "mic"
                  ? `${prompt.app} is using your microphone. Record this call?`
                  : `“${prompt.title}” is starting. Record it?`}
              </span>
              <Button
                size="sm"
                onClick={() => start(prompt.reason === "calendar" ? prompt.title : "", prompt.eventId)}
              >
                Record
              </Button>
              <button
                type="button"
                className="icon-btn"
                aria-label="Not now"
                title="Not now"
                onClick={dismissPrompt}
              >
                <X size={14} />
              </button>
            </div>
          )}

          {call && !prompt && <CallCard call={call} now={now} onRecord={start} />}

          <div className="mtg__record-row">
            <input
              className="mtg__name"
              value={name}
              placeholder={call && call.start <= now ? call.title : "Meeting name (optional)"}
              aria-label="Meeting name"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && start(name, null)}
            />
            <Button className="mtg__record" onClick={() => start(name, null)}>
              <span className="mtg__dot" aria-hidden />
              Record
            </Button>
          </div>
          <p className="mtg__hint">
            Records your microphone and this computer's sound, so it works with Meet, Zoom, Zoho,
            Teams or any other call. Everything stays on this computer.{" "}
            <strong>Let everyone know you're recording.</strong>
          </p>
          {rec.error && (
            <p className="mtg__notice" role="alert">
              <AlertCircle size={13} aria-hidden />
              <span>{rec.error}</span>
              <button type="button" aria-label="Dismiss" onClick={clearError}>
                <X size={12} />
              </button>
            </p>
          )}
        </div>
      )}

      {open ? (
        <MeetingDetail
          m={open}
          settings={settings}
          onBack={() => setOpenId(null)}
          onDelete={() => remove(open)}
        />
      ) : (
        <div className="mtg__scroll">
          {meetings.length === 0 ? (
            <div className="blankstate">
              <span className="blankstate__icon">
                <Video size={16} />
              </span>
              <p className="blankstate__title">No meetings yet</p>
              <p className="blankstate__text">
                Press Record when a call starts. Afterwards you get the transcript, a summary, the
                decisions and who's doing what.
              </p>
            </div>
          ) : (
            <ul className="mtg__list">
              {meetings.map((m) => (
                <MeetingItem
                  key={m.row.id}
                  m={m}
                  live={rec.id === m.row.id}
                  onOpen={() => setOpenId(m.row.id)}
                  onDelete={() => remove(m)}
                />
              ))}
            </ul>
          )}
        </div>
      )}

      {undo.latest && (
        <UndoToast
          key={undo.latest.id}
          label={undo.latest.label}
          onUndo={() => undo.undo(undo.latest!.id)}
          onDismiss={() => undo.finish(undo.latest!.id)}
        />
      )}
    </div>
  );
}

function CallCard({
  call,
  now,
  onRecord,
}: {
  call: NonNullable<ReturnType<typeof currentCall>>;
  now: number;
  onRecord: (title: string, eventId: string | null) => void;
}) {
  const link = callLink(call)!;
  const mins = Math.round((call.start - now) / 60_000);
  const when = mins <= 0 ? "Now" : `In ${mins} min`;
  return (
    <div className="mtg__call">
      <span className="mtg__call-bar" style={{ background: call.color }} aria-hidden />
      <div className="mtg__call-main">
        <span className="mtg__call-when">
          {when} · {meetingName(link)}
        </span>
        <span className="mtg__call-title">{call.title}</span>
      </div>
      <Button
        size="sm"
        onClick={() => {
          // start first, while the click still counts as one
          onRecord(call.title, call.id);
          void window.mypa.market.openExternal(link);
        }}
      >
        Join & record
      </Button>
      <Button size="sm" variant="outline" onClick={() => onRecord(call.title, call.id)}>
        Record
      </Button>
    </div>
  );
}

function Meter({
  label,
  icon,
  level,
  on,
  source,
}: {
  label: string;
  icon: ReactNode;
  level: number;
  on: boolean;
  source?: string;
}) {
  // speech sits around 0.02–0.2 RMS; a log scale makes quiet voices visible
  const pct = on ? Math.max(0, Math.min(100, ((Math.log10(level + 1e-4) + 3) / 2.3) * 100)) : 0;
  return (
    <div className={`mtg__meter${on ? "" : " is-off"}`} title={on ? source || undefined : `${label}: not recorded`}>
      <span className="mtg__meter-label">
        {icon}
        {label}
      </span>
      <span className="mtg__meter-track" aria-hidden>
        <span className="mtg__meter-fill" style={{ width: `${pct}%` }} />
      </span>
    </div>
  );
}

function RecordingPanel({ rec }: { rec: RecorderState }) {
  const [confirm, setConfirm] = useState(false);
  const starting = rec.status === "starting";
  const stopping = rec.status === "stopping";
  const quiet = rec.status === "recording" && rec.system && rec.systemQuietMs > QUIET_WARN_MS;
  return (
    <div className="mtg__rec" aria-live="polite">
      <div className="mtg__rec-head">
        <span className={`mtg__rec-dot${rec.status === "recording" ? " is-live" : ""}`} aria-hidden />
        <span className="mtg__rec-state">
          {starting ? "Starting…" : stopping ? "Saving…" : "Recording"}
        </span>
        {rec.status === "recording" && (
          <span className="mtg__rec-time num">{formatClock(Date.now() - rec.startedAt)}</span>
        )}
        <Button
          size="sm"
          className="mtg__stop"
          disabled={rec.status !== "recording"}
          onClick={() => void stopRecording()}
        >
          {stopping ? <Loader2 className="mtg__spin" /> : <Square />}
          Stop
        </Button>
      </div>
      {rec.title && <p className="mtg__rec-title">{rec.title}</p>}
      {!starting && (
        <div className="mtg__meters">
          <Meter label="You" icon={<Mic size={12} />} level={rec.micLevel} on={rec.mic} source={rec.micLabel} />
          <Meter label="Meeting" icon={<Volume2 size={12} />} level={rec.systemLevel} on={rec.system} />
        </div>
      )}
      {(rec.warning || quiet) && (
        <p className="mtg__notice">
          <AlertCircle size={13} aria-hidden />
          <span>
            {rec.warning ??
              "Not hearing the meeting yet. Its sound has to play on this computer (speakers or headphones)."}
          </span>
        </p>
      )}
      {rec.status === "recording" && (
        <div className="mtg__rec-foot">
          {confirm ? (
            <>
              <span>Throw this recording away?</span>
              <button type="button" className="mtg__link mtg__link--danger" onClick={() => void discardRecording()}>
                Discard
              </button>
              <button type="button" className="mtg__link" onClick={() => setConfirm(false)}>
                Keep recording
              </button>
            </>
          ) : (
            <button type="button" className="mtg__link" onClick={() => setConfirm(true)}>
              Discard…
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** What a meeting is up to, for the list. */
export function meetingStage(m: Meeting, live: boolean): { label: string; busy: boolean; error?: boolean } {
  const { row, meeting } = m;
  if (row.status === "recording") return { label: live ? "Recording" : "Saving…", busy: true };
  if (row.status === "pending") return { label: "Waiting to transcribe", busy: true };
  if (row.status === "processing") return { label: `Transcribing ${Math.round(row.progress)}%`, busy: true };
  if (row.status === "error") return { label: "Couldn't transcribe", busy: false, error: true };
  if (row.wordCount === 0) return { label: "No speech heard", busy: false };
  if (meeting.summaryStatus === "waiting" || meeting.summaryStatus === "running")
    return { label: "Writing notes…", busy: true };
  if (meeting.summaryStatus === "error") return { label: "Notes failed", busy: false, error: true };
  const todo = meeting.actionItems.length;
  return { label: todo ? `${todo} action item${todo === 1 ? "" : "s"}` : "Ready", busy: false };
}

function MeetingItem({
  m,
  live,
  onOpen,
  onDelete,
}: {
  m: Meeting;
  live: boolean;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const stage = meetingStage(m, live);
  const duration = formatDuration(m.row.durationMs);
  return (
    <li className="mtg__item">
      <button type="button" className="mtg__item-main" onClick={onOpen} disabled={live}>
        <span className="mtg__item-title">{m.row.title}</span>
        <span className="mtg__item-meta num">
          <span>{formatCreatedAt(m.meeting.startedAt)}</span>
          {duration && <span>{duration}</span>}
          <span className={stage.error ? "is-error" : stage.busy ? "is-busy" : ""}>
            {stage.busy && <Loader2 size={11} className="mtg__spin" aria-hidden />}
            {stage.label}
          </span>
        </span>
      </button>
      {!live && (
        <button
          type="button"
          className="icon-btn mtg__item-delete"
          aria-label={`Delete ${m.row.title}`}
          title="Delete"
          onClick={onDelete}
        >
          <X size={14} />
        </button>
      )}
      {!live && <ChevronRight size={14} className="mtg__item-go" aria-hidden />}
    </li>
  );
}
