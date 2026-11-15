/**
 * The welcome guide a new user sees on first launch: who they are, what they
 * want help with (which builds starter pages), what to connect, and a few
 * things worth knowing. Every step can be skipped; Settings opens it again.
 */
import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Brain,
  Calendar,
  Check,
  ChevronDown,
  Cpu,
  KeyRound,
  LayoutGrid,
  Lock,
  Mail,
  Sparkles,
  Zap,
} from "lucide-react";

import { hotkeyLabel } from "../../../shared/capture";
import {
  HOME_WIDGETS,
  STARTER_AREAS,
  type AreaId,
  type StarterPlan,
  type StarterWidget,
} from "../../../shared/onboarding";
import type { ProviderInfo } from "../../../shared/tutor";
import type { WidgetKind } from "../../../shared/types";
import { useReadyStore } from "../lib/store";
import { pageIcon } from "../lib/pageIcons";
import { DEFAULT_SIZE, GAP, MIN_H, MIN_W, type Size } from "../lib/widgets";
import { widgetKindMeta } from "../lib/widgetKinds";
import { BrandMark } from "./BrandMark";
import { CalendarAccounts } from "./CalendarAccounts";
import { EmailAccounts } from "./EmailAccounts";
import { PRESETS } from "./TutorSettings";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "./ui/dialog";
import "../styles/onboarding.css";

const STEPS = ["Welcome", "Your pages", "Connect", "Good to know"] as const;
const isMac = navigator.platform.toLowerCase().includes("mac");

/**
 * Starter layout: the widgets side by side in one row at their usual size,
 * leaving the rest of the board free. Shrinks them evenly only when the
 * board is too small to hold them; never stretches them to fill it.
 */
export function layout(kinds: WidgetKind[], board: Size): StarterWidget[] {
  if (!kinds.length) return [];
  const size = (k: WidgetKind) => DEFAULT_SIZE[k] ?? { w: 480, h: 600 };
  const totalW = kinds.reduce((t, k) => t + size(k).w, 0);
  const maxH = Math.max(...kinds.map((k) => size(k).h));
  const scale = Math.min(
    1,
    (board.w - GAP * (kinds.length + 1)) / totalW,
    (board.h - GAP * 2) / maxH,
  );
  let x = GAP;
  return kinds.map((k) => {
    const w = Math.max(MIN_W, Math.floor(size(k).w * scale));
    const h = Math.max(MIN_H, Math.floor(size(k).h * scale));
    const out = { kind: k, x, y: GAP, w, h };
    x += w + GAP;
    return out;
  });
}

export function Onboarding({ board }: { board: Size }) {
  const { snapshot, actions } = useReadyStore();
  const open = snapshot.meta.onboarding;
  const [step, setStep] = useState(0);
  const [name, setName] = useState(snapshot.meta.profile.name ?? "");
  const [areas, setAreas] = useState<Set<AreaId>>(new Set());
  const [built, setBuilt] = useState<string | null>(null);

  // every time the guide opens, it starts from the top
  useEffect(() => {
    if (!open) return;
    setStep(0);
    setName(snapshot.meta.profile.name ?? "");
    setBuilt(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const finish = () => void actions.setOnboarding(false);

  const next = async () => {
    if (step === 0 && name.trim() !== (snapshot.meta.profile.name ?? ""))
      await actions.setUserName(name);
    if (step === 1) {
      // built now, so leaving the guide later keeps the pages
      const plan: StarterPlan = {
        home: layout(HOME_WIDGETS, board),
        pages: STARTER_AREAS.filter((a) => areas.has(a.id)).map((a) => ({
          area: a.id,
          widgets: layout(a.widgets, board),
        })),
      };
      const r = await actions.applyStarterPlan(plan);
      const made = r.created.map(
        (id) => STARTER_AREAS.find((a) => a.id === id)!.page.title,
      );
      setBuilt(
        made.length
          ? made.length === 1
            ? `Added a page: ${made[0]}. It's in the sidebar on the left.`
            : `Added ${made.length} pages: ${made.join(", ")}. They're in the sidebar on the left.`
          : r.homeSet
            ? "Your Home page is ready."
            : areas.size
              ? "You already have those pages, so nothing new was added."
              : null,
      );
    }
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && finish()}>
      <DialogContent
        className="onb sm:max-w-[680px]"
        showCloseButton={false}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <div className="onb__top">
          <ol className="onb__steps" aria-label="Steps">
            {STEPS.map((s, i) => (
              <li
                key={s}
                className={
                  i === step ? "is-current" : i < step ? "is-done" : ""
                }
                aria-current={i === step ? "step" : undefined}
              >
                <span className="onb__dot">
                  {i < step ? <Check size={11} strokeWidth={3} /> : i + 1}
                </span>
                <span className="onb__step-label">{s}</span>
              </li>
            ))}
          </ol>
          <button type="button" className="onb__skip" onClick={finish}>
            Skip setup
          </button>
        </div>

        <div className="onb__body">
          {step === 0 && (
            <Welcome name={name} onName={setName} onEnter={() => void next()} />
          )}
          {step === 1 && <Areas picked={areas} onChange={setAreas} />}
          {step === 2 && <Connect built={built} />}
          {step === 3 && (
            <Tips
              hotkey={
                snapshot.meta.capture.hotkeyOn
                  ? snapshot.meta.capture.hotkey
                  : null
              }
            />
          )}
        </div>

        <div className="onb__foot">
          {step > 0 ? (
            <button
              type="button"
              className="onb__btn"
              onClick={() => setStep((s) => s - 1)}
            >
              <ArrowLeft size={14} /> Back
            </button>
          ) : (
            <span />
          )}
          {step < STEPS.length - 1 ? (
            <button
              type="button"
              className="onb__btn onb__btn--primary"
              onClick={() => void next()}
            >
              {step === 0
                ? "Get started"
                : step === 1
                  ? areas.size
                    ? "Set up my pages"
                    : "Just the Home page"
                  : "Next"}
              <ArrowRight size={14} />
            </button>
          ) : (
            <button
              type="button"
              className="onb__btn onb__btn--primary"
              onClick={finish}
            >
              Start using myPA <ArrowRight size={14} />
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------------------------------------------------------- welcome -- */

function Welcome({
  name,
  onName,
  onEnter,
}: {
  name: string;
  onName: (v: string) => void;
  onEnter: () => void;
}) {
  return (
    <div className="onb__welcome">
      <span className="onb__mark">
        <BrandMark />
      </span>
      <DialogTitle className="onb__title">Welcome to myPA</DialogTitle>
      <DialogDescription className="onb__lede">
        Your personal assistant on your desktop: lists, plans, notes and
        reminders on pages you arrange, and an Assistant that can work with all
        of them.
      </DialogDescription>
      <ul className="onb__points">
        <li>
          <Lock size={15} aria-hidden />
          <span>
            <strong>Everything stays on this computer.</strong> No myPA account.
            Your data only leaves when you connect something, like a calendar.
          </span>
        </li>
        <li>
          <LayoutGrid size={15} aria-hidden />
          <span>
            <strong>Widgets on pages.</strong> Add, move and resize them however
            suits you.
          </span>
        </li>
        <li>
          <Sparkles size={15} aria-hidden />
          <span>
            <strong>An Assistant that does things.</strong> Ask it to add a
            task, plan your day or remind you later.
          </span>
        </li>
      </ul>
      <label className="onb__name">
        <span>What should myPA call you?</span>
        <input
          className="field"
          value={name}
          maxLength={40}
          placeholder="Your first name (optional)"
          autoFocus
          onChange={(e) => onName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onEnter();
            }
          }}
        />
      </label>
    </div>
  );
}

/* ------------------------------------------------------------------ areas -- */

function KindList({ kinds }: { kinds: WidgetKind[] }) {
  return (
    <span className="onb__kinds">
      {kinds.map((k) => {
        const m = widgetKindMeta(k);
        const Icon = m.icon;
        return (
          <span key={k} className="onb__kind">
            <Icon size={12} aria-hidden /> {m.label}
          </span>
        );
      })}
    </span>
  );
}

function Areas({
  picked,
  onChange,
}: {
  picked: Set<AreaId>;
  onChange: (update: (prev: Set<AreaId>) => Set<AreaId>) => void;
}) {
  const toggle = (id: AreaId) =>
    onChange((prev) => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      return s;
    });
  return (
    <div className="onb__areas">
      <DialogTitle className="onb__h">What do you want help with?</DialogTitle>
      <DialogDescription className="onb__sub">
        Pick any. Each one gets its own page with the right widgets. You can
        change all of it later.
      </DialogDescription>
      <div className="onb__home">
        <strong>Home, for everyone</strong>
        <KindList kinds={HOME_WIDGETS} />
      </div>
      <div className="onb__grid" role="group" aria-label="Areas">
        {STARTER_AREAS.map((a) => {
          const Icon = pageIcon(a.page.icon);
          const on = picked.has(a.id);
          return (
            <button
              key={a.id}
              type="button"
              className={`onb__area${on ? " is-on" : ""}`}
              aria-pressed={on}
              onClick={() => toggle(a.id)}
            >
              <span className="onb__area-head">
                <span className="onb__area-icon">
                  <Icon size={15} aria-hidden />
                </span>
                <strong>{a.label}</strong>
                <span className="onb__check" aria-hidden>
                  {on && <Check size={12} strokeWidth={3} />}
                </span>
              </span>
              <span className="onb__area-blurb">{a.blurb}</span>
              <KindList kinds={a.widgets} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- connect -- */

function Fold({
  icon,
  title,
  hint,
  children,
}: {
  icon: ReactNode;
  title: string;
  hint: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section className={`onb__fold${open ? " is-open" : ""}`}>
      <button
        type="button"
        className="onb__fold-head"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="onb__fold-icon">{icon}</span>
        <span className="onb__fold-text">
          <strong>{title}</strong>
          <em>{hint}</em>
        </span>
        <ChevronDown size={16} className="onb__chev" aria-hidden />
      </button>
      {open && <div className="onb__fold-body">{children}</div>}
    </section>
  );
}

function Connect({ built }: { built: string | null }) {
  return (
    <div className="onb__connect">
      {built && (
        <p className="onb__built" role="status">
          <Check size={14} aria-hidden /> {built}
        </p>
      )}
      <DialogTitle className="onb__h">Connect what you use</DialogTitle>
      <DialogDescription className="onb__sub">
        All optional, and you can do it later from each widget. Nothing is
        shared until you connect it.
      </DialogDescription>
      <Fold
        icon={<Bot size={16} />}
        title="The Assistant's AI"
        hint="Built-in and private, or your own AI account"
      >
        <AiChoice />
      </Fold>
      <Fold
        icon={<Calendar size={16} />}
        title="Calendars"
        hint="Google, Outlook, iCloud and more. Events show in Calendar, Daily Planner and the Briefing."
      >
        <CalendarAccounts />
      </Fold>
      <Fold
        icon={<Mail size={16} />}
        title="Email"
        hint="Read and sort mail in the Email widget. myPA never sends without you."
      >
        <EmailAccounts />
      </Fold>
    </div>
  );
}

// services with a fixed address; local servers and "other" need more setup than a key
const CLOUD = PRESETS.filter(
  (p) =>
    p.model &&
    (p.type === "anthropic" || (p.baseUrl && !p.baseUrl.includes("localhost"))),
);

function AiChoice() {
  const [mode, setMode] = useState<"local" | "cloud">("local");
  const [local, setLocal] = useState<{
    model: string;
    state: string;
    pct: number;
  } | null>(null);
  const [preset, setPreset] = useState(CLOUD[0]!.label);
  const [key, setKey] = useState("");
  const [saved, setSaved] = useState<ProviderInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const assistant = window.mypa.assistant;

  useEffect(() => {
    let live = true;
    const poll = async () => {
      const cfg = await window.mypa.tutor.getConfig();
      const s = await assistant.modelStatus(cfg.localModel);
      if (!live) return;
      setLocal({
        model: cfg.localModel,
        state: s.state,
        pct: s.total > 0 ? Math.floor((s.done / s.total) * 100) : 0,
      });
    };
    void poll();
    const t = window.setInterval(() => void poll(), 1500);
    return () => {
      live = false;
      window.clearInterval(t);
    };
  }, [assistant]);

  const useLocal = async () => {
    const s = await assistant.getSettings();
    await assistant.saveSettings({ ...s, model: "local" });
    if (local && local.state !== "ready")
      await assistant.modelDownload(local.model as never);
  };

  const saveKey = async () => {
    const p = CLOUD.find((c) => c.label === preset)!;
    setError(null);
    try {
      const cfg = await window.mypa.tutor.saveProvider({
        name: p.label,
        type: p.type,
        baseUrl: p.baseUrl,
        model: p.model,
        apiKey: key.trim(),
      });
      const made =
        cfg.providers.find((x) => x.name === p.label) ??
        cfg.providers[cfg.providers.length - 1]!;
      const s = await assistant.getSettings();
      await assistant.saveSettings({ ...s, model: made.id });
      setSaved(made);
      setKey("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const downloading =
    local?.state === "downloading" || local?.state === "pausing";

  return (
    <div className="onb__ai">
      <div
        className="onb__choice"
        role="radiogroup"
        aria-label="AI for the Assistant"
      >
        <button
          type="button"
          role="radio"
          aria-checked={mode === "local"}
          className={mode === "local" ? "is-on" : ""}
          onClick={() => setMode("local")}
        >
          <Cpu size={15} aria-hidden />
          <strong>Built-in</strong>
          <em>
            Runs on this PC. Free and private, but small: good for questions,
            less reliable at actions.
          </em>
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={mode === "cloud"}
          className={mode === "cloud" ? "is-on" : ""}
          onClick={() => setMode("cloud")}
        >
          <KeyRound size={15} aria-hidden />
          <strong>My own AI account</strong>
          <em>
            Smarter and faster. What you ask, and what the Assistant needs to
            answer, goes to that company.
          </em>
        </button>
      </div>

      {mode === "local" ? (
        <div className="onb__ai-row">
          {local?.state === "ready" ? (
            <span className="onb__ok">
              <Check size={14} aria-hidden /> The built-in model is ready.
            </span>
          ) : downloading ? (
            <span className="onb__note">
              Downloading… {local?.pct ?? 0}%. It carries on while you use myPA.
            </span>
          ) : (
            <>
              <span className="onb__note">
                A one-time download of about 1.7 GB.
              </span>
              <button
                type="button"
                className="onb__btn"
                onClick={() => void useLocal()}
              >
                Download now
              </button>
            </>
          )}
        </div>
      ) : saved ? (
        <span className="onb__ok">
          <Check size={14} aria-hidden /> Saved. The Assistant uses {saved.name}
          . Change it any time in Assistant settings.
        </span>
      ) : (
        <form
          className="onb__key"
          onSubmit={(e) => {
            e.preventDefault();
            if (key.trim()) void saveKey();
          }}
        >
          <select
            className="field"
            value={preset}
            onChange={(e) => setPreset(e.target.value)}
            aria-label="Service"
          >
            {CLOUD.map((p) => (
              <option key={p.label}>{p.label}</option>
            ))}
          </select>
          <input
            className="field"
            type="password"
            autoComplete="off"
            placeholder="Paste your API key"
            aria-label="API key"
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
          <button
            type="submit"
            className="onb__btn onb__btn--primary"
            disabled={!key.trim()}
          >
            Save
          </button>
          <span className="onb__note onb__note--wide">
            The key is stored encrypted on this computer and is only sent to{" "}
            {preset}.
          </span>
          {error && (
            <span className="onb__err" role="alert">
              {error}
            </span>
          )}
        </form>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------- tips -- */

function Tips({ hotkey }: { hotkey: string | null }) {
  const assistantKey = isMac ? "⌘K" : "Ctrl+K";
  return (
    <div className="onb__tips">
      <DialogTitle className="onb__h">A few things worth knowing</DialogTitle>
      <DialogDescription className="onb__sub">
        That's it. Here's how to get the most from it.
      </DialogDescription>
      <ul className="onb__tip-list">
        {hotkey && (
          <li>
            <span className="onb__tip-icon">
              <Zap size={16} aria-hidden />
            </span>
            <span>
              <strong>
                Jot anything, from anywhere:{" "}
                <kbd>{hotkeyLabel(hotkey, isMac)}</kbd>
              </strong>
              <em>
                Quick Capture opens over any app. Type “check the oven in 20
                min” and it becomes a reminder.
              </em>
            </span>
          </li>
        )}
        <li>
          <span className="onb__tip-icon">
            <Sparkles size={16} aria-hidden />
          </span>
          <span>
            <strong>
              Ask the Assistant: <kbd>{assistantKey}</kbd>
            </strong>
            <em>
              “Plan my day”, “add milk to the shopping list”, “what's on
              Thursday?”
            </em>
          </span>
        </li>
        <li>
          <span className="onb__tip-icon">
            <Brain size={16} aria-hidden />
          </span>
          <span>
            <strong>Tell it about yourself</strong>
            <em>
              Say “remember that I'm vegetarian” and it keeps it in mind. The
              Personal Memory widget shows everything it knows, so you can fix
              or delete any of it.
            </em>
          </span>
        </li>
        <li>
          <span className="onb__tip-icon">
            <LayoutGrid size={16} aria-hidden />
          </span>
          <span>
            <strong>Make it yours</strong>
            <em>
              Add widgets from + Add widget at the top. Drag a widget's title to
              move it, and its edges to resize.
            </em>
          </span>
        </li>
      </ul>
      <p className="onb__note">You can open this guide again from Settings.</p>
    </div>
  );
}
