import { useMemo, useState } from "react";

import {
  AlertCircle,
  Check,
  ChevronLeft,
  Copy,
  Download,
  FolderOpen,
  ListPlus,
  Loader2,
  RotateCcw,
  Send,
  Sparkles,
  Trash2,
} from "lucide-react";

import type { MeetingSettings } from "../../../shared/types";
import { askAssistant } from "../lib/askAssistant";
import {
  meetingOptions,
  parseTranscript,
  speakerColor,
  speakerLabels,
  type Meeting,
} from "../lib/meetings";
import { useReadyStore } from "../lib/store";
import { formatDuration } from "../lib/transcribe";
import { EditableText } from "./EditableText";
import { Button } from "./ui/button";
import { Progress } from "./ui/progress";

type Tab = "notes" | "transcript";

export function MeetingDetail({
  m,
  settings,
  onBack,
  onDelete,
}: {
  m: Meeting;
  settings: MeetingSettings;
  onBack: () => void;
  onDelete: () => void;
}) {
  const { actions } = useReadyStore();
  const { row, meeting } = m;
  const [tab, setTab] = useState<Tab>("notes");
  const duration = formatDuration(row.durationMs);
  const when = new Date(meeting.startedAt).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <div className="mtg__detail">
      <div className="mtg__detail-head">
        <button type="button" className="mtg__back" onClick={onBack}>
          <ChevronLeft size={14} aria-hidden />
          Meetings
        </button>
        <EditableText
          className="mtg__detail-title"
          label="Meeting name"
          value={row.title}
          onSave={(title) => void actions.renameTranscript(row.id, title)}
        />
        <span className="mtg__detail-meta num">
          {when}
          {duration && ` · ${duration}`}
        </span>
      </div>

      {row.status !== "done" ? (
        <Processing m={m} settings={settings} />
      ) : (
        <>
          <div className="mtg__tabs" role="tablist" aria-label="Meeting">
            {(["notes", "transcript"] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                className={tab === t ? "is-on" : ""}
                onClick={() => setTab(t)}
              >
                {t === "notes" ? "Notes" : "Transcript"}
              </button>
            ))}
          </div>
          <div className="mtg__scroll" role="tabpanel">
            {tab === "notes" ? (
              <Notes m={m} settings={settings} />
            ) : (
              <Transcript m={m} onDelete={onDelete} />
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Processing({ m, settings }: { m: Meeting; settings: MeetingSettings }) {
  const { row } = m;
  if (row.status === "error") {
    return (
      <div className="mtg__state">
        <p className="mtg__notice" role="alert">
          <AlertCircle size={13} aria-hidden />
          <span>{row.errorMessage ?? "Something went wrong."}</span>
        </p>
        {m.meeting.hasAudio && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => void window.mypa.meetings.retry(row.id, meetingOptions(settings))}
          >
            <RotateCcw />
            Try again
          </Button>
        )}
      </div>
    );
  }
  return (
    <div className="mtg__state">
      <p className="mtg__state-text">
        {row.status === "recording"
          ? "Still recording."
          : row.status === "pending"
            ? "Waiting to transcribe…"
            : `Transcribing on this computer… ${Math.round(row.progress)}%`}
      </p>
      {row.status === "processing" && <Progress value={row.progress} />}
      <p className="mtg__hint">
        A one-hour meeting takes a few minutes. You can keep using myPA meanwhile.
      </p>
    </div>
  );
}

function aiFor(settings: MeetingSettings): string {
  return settings.meetingAi === "off" ? "local" : settings.meetingAi;
}

function Notes({ m, settings }: { m: Meeting; settings: MeetingSettings }) {
  const { row, meeting } = m;
  const [question, setQuestion] = useState("");
  const status = meeting.summaryStatus;
  const write = () => void window.mypa.meetings.summarize(row.id, aiFor(settings));
  const nameOf = (label: string | null) => (label ? (meeting.speakerNames[label] ?? label) : null);
  const open = meeting.actionItems.map((a, i) => ({ a, i })).filter(({ a }) => !a.taskId);

  const ask = () => {
    const q = question.trim();
    if (!q) return;
    askAssistant(`About my meeting “${row.title}” (transcript id ${row.id}): ${q}`);
    setQuestion("");
  };

  return (
    <div className="mtg__notes">
      {(status === "waiting" || status === "running") && (
        <p className="mtg__state-text">
          <Loader2 size={13} className="mtg__spin" aria-hidden />
          {status === "waiting"
            ? "Waiting to write the notes…"
            : settings.meetingAi === "local"
              ? "Writing the notes on this computer. This can take a minute or two."
              : "Writing the notes…"}
        </p>
      )}
      {status === "error" && (
        <div className="mtg__state">
          <p className="mtg__notice" role="alert">
            <AlertCircle size={13} aria-hidden />
            <span>{meeting.summaryError ?? "The notes couldn't be written."}</span>
          </p>
          <Button size="sm" variant="outline" onClick={write}>
            <RotateCcw />
            Try again
          </Button>
        </div>
      )}
      {(status === "off" || status === "none") && (
        <div className="mtg__state">
          <p className="mtg__state-text">No notes yet.</p>
          <Button size="sm" onClick={write}>
            <Sparkles />
            Write notes
          </Button>
        </div>
      )}

      {status === "done" && (
        <>
          <section className="mtg__section">
            <h4>Summary</h4>
            <p>{meeting.summary || "No summary."}</p>
          </section>
          <section className="mtg__section">
            <h4>Decisions</h4>
            {meeting.decisions.length ? (
              <ul className="mtg__bullets">
                {meeting.decisions.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            ) : (
              <p className="mtg__none">None noted.</p>
            )}
          </section>
          <section className="mtg__section">
            <h4>
              Action items
              {open.length > 1 && (
                <button
                  type="button"
                  className="mtg__link"
                  onClick={() => {
                    // one at a time, in order, so each lands in the To-do list
                    void open.reduce<Promise<void>>(
                      (p, { i }) => p.then(() => window.mypa.meetings.addAction(row.id, i)),
                      Promise.resolve(),
                    );
                  }}
                >
                  Add all to To-do
                </button>
              )}
            </h4>
            {meeting.actionItems.length ? (
              <ul className="mtg__actions">
                {meeting.actionItems.map((a, i) => (
                  <li key={i}>
                    <span className="mtg__action-text">
                      {a.owner && <span className="mtg__owner">{nameOf(a.owner)}</span>}
                      {a.text}
                    </span>
                    {a.taskId ? (
                      <span className="mtg__added">
                        <Check size={12} aria-hidden />
                        In To-do
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="mtg__add"
                        title="Add to the To-do list"
                        onClick={() => void window.mypa.meetings.addAction(row.id, i)}
                      >
                        <ListPlus size={12} aria-hidden />
                        To-do
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mtg__none">Nobody took on a task.</p>
            )}
          </section>
          <button type="button" className="mtg__link mtg__rewrite" onClick={write}>
            <RotateCcw size={11} aria-hidden />
            Write the notes again
          </button>
        </>
      )}

      <div className="mtg__ask">
        <input
          value={question}
          placeholder="Ask about this meeting…"
          aria-label="Ask the Assistant about this meeting"
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && ask()}
        />
        <button type="button" aria-label="Ask" disabled={!question.trim()} onClick={ask}>
          <Send size={13} />
        </button>
      </div>
      <p className="mtg__hint">
        The Assistant can answer from this meeting and your others. Flashcards and the Tutor can
        use it too.
      </p>
    </div>
  );
}

function Transcript({ m, onDelete }: { m: Meeting; onDelete: () => void }) {
  const { row, meeting } = m;
  const lines = useMemo(() => parseTranscript(row.text), [row.text]);
  const labels = useMemo(() => speakerLabels(lines, meeting.speakerNames), [lines, meeting.speakerNames]);
  const byName = useMemo(
    () => new Map(Object.entries(meeting.speakerNames).map(([label, name]) => [name, label])),
    [meeting.speakerNames],
  );
  const [renaming, setRenaming] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const copy = () => {
    window.mypa.copyText(row.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="mtg__transcript">
      {labels.length > 0 && (
        <div className="mtg__speakers" aria-label="Speakers">
          {labels.map((label) =>
            renaming === label ? (
              <EditableText
                key={label}
                autoEdit
                className="mtg__speaker"
                label={`Name for ${label}`}
                value={meeting.speakerNames[label] ?? label}
                onSave={(name) => void window.mypa.meetings.renameSpeaker(row.id, label, name)}
                onEditEnd={() => setRenaming(null)}
              />
            ) : (
              <button
                key={label}
                type="button"
                className="mtg__speaker"
                disabled={label === "Me"}
                title={label === "Me" ? "You" : "Rename"}
                onClick={() => setRenaming(label)}
              >
                <span className="mtg__speaker-dot" style={{ background: speakerColor(label, labels) }} />
                {meeting.speakerNames[label] ?? label}
              </button>
            ),
          )}
          {labels.some((l) => /^Speaker \d+$/.test(l) && !meeting.speakerNames[l]) && (
            <span className="mtg__hint">Click a speaker to name them.</span>
          )}
        </div>
      )}

      {lines.length === 0 ? (
        <p className="mtg__none">No speech was heard in this recording.</p>
      ) : (
        <ol className={`mtg__lines${lines.some((l) => l.time.length > 5) ? " mtg__lines--hours" : ""}`}>
          {lines.map((l, i) => {
            const label = byName.get(l.name) ?? l.name;
            return (
              <li key={i}>
                <span className="mtg__line-time num">{l.time}</span>
                <span className="mtg__line-name" style={{ color: speakerColor(label, labels) }}>
                  {l.name}
                </span>
                <span className="mtg__line-text">{l.text}</span>
              </li>
            );
          })}
        </ol>
      )}

      <div className="mtg__tools">
        <button type="button" onClick={copy}>
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? "Copied" : "Copy"}
        </button>
        <button type="button" onClick={() => void window.mypa.db.exportTranscript(row.id)}>
          <Download size={12} aria-hidden />
          Save as…
        </button>
        {meeting.hasAudio && (
          <>
            <button type="button" onClick={() => void window.mypa.meetings.openFolder(row.id)}>
              <FolderOpen size={12} aria-hidden />
              Audio
            </button>
            <button type="button" onClick={() => void window.mypa.meetings.deleteAudio(row.id)}>
              <Trash2 size={12} aria-hidden />
              Delete audio
            </button>
          </>
        )}
        <button type="button" className="mtg__tools-danger" onClick={onDelete}>
          <Trash2 size={12} aria-hidden />
          Delete meeting
        </button>
      </div>
    </div>
  );
}
