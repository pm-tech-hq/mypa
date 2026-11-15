import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  Archive,
  ArchiveRestore,
  ArrowUp,
  Check,
  Inbox,
  Loader2,
  MailOpen,
  Mail,
  Paperclip,
  PenSquare,
  RefreshCw,
  Search,
  Sparkles,
  Star,
  Tags,
  Trash2,
  X,
} from "lucide-react";

import {
  DEFAULT_CATEGORIES,
  EMAIL_FOLDERS,
  type EmailAccount,
  type EmailAction,
  type EmailFolder,
  type EmailSummary,
} from "../../../shared/email";
import type { TutorConfig } from "../../../shared/tutor";
import type { EmailSettings, WidgetRow } from "../../../shared/types";
import { askAssistant } from "../lib/askAssistant";
import {
  catchUpMessages,
  dayGroup,
  newCompose,
  onMailChanged,
  parseSort,
  personName,
  replyCompose,
  shortWhen,
  sortMessages,
  useEmailState,
  type ComposeState,
} from "../lib/email";
import { streamChat, type ChatHandle } from "../lib/flashcards";
import { useReadyStore } from "../lib/store";
import { errorText } from "../lib/tutor";
import { accountHue, Avatar, CategoryPicker, hueStyle } from "./EmailBits";
import { clearUnsent, EmailCompose, readUnsent } from "./EmailCompose";
import { EmailReader } from "./EmailReader";
import { Markdown } from "./Markdown";
import "../styles/email.css";

type View =
  | { kind: "list" }
  | { kind: "read"; summary: EmailSummary }
  | { kind: "compose"; draft: ComposeState; back: View };

interface Undo {
  label: string;
  run: (() => Promise<void>) | null;
}

const PAGE = 60;
/** How many emails one "Sort" sends to the AI. */
const SORT_BATCH = 40;

const ASK_IDEAS = [
  "Which emails need a reply?",
  "Find everything from Stripe",
  "Delete all promotions",
  "Sort my inbox into categories",
];

/** Picks the AI the widget uses: the saved choice, else a provider, else the built-in model. */
export function useEmailAi(widget: WidgetRow): {
  target: string;
  config: TutorConfig | null;
  setTarget: (t: string) => void;
} {
  const { actions } = useReadyStore();
  const [config, setConfig] = useState<TutorConfig | null>(null);
  useEffect(() => {
    void window.mypa.tutor.getConfig().then(setConfig);
  }, []);
  const saved = widget.settings.emailAi;
  const valid = saved === "local" || saved === "off" || config?.providers.some((p) => p.id === saved);
  const target = saved && valid ? saved : (config?.providers[0]?.id ?? "local");
  return {
    target,
    config,
    setTarget: (t) => void actions.updateWidgetSettings(widget.id, { emailAi: t }),
  };
}

/** The categories to offer: the usual ones plus any the user or the AI made up. */
function categoryChoices(messages: EmailSummary[] | null): string[] {
  const out: string[] = [...DEFAULT_CATEGORIES];
  for (const m of messages ?? [])
    if (m.category && !out.some((c) => c.toLowerCase() === m.category!.toLowerCase()))
      out.push(m.category);
  return out;
}

export function EmailWidget({
  widget,
  onOpenSettings,
}: {
  widget: WidgetRow;
  onOpenSettings: () => void;
}) {
  const { actions } = useReadyStore();
  const { accounts, drafts } = useEmailState();
  const prefs: EmailSettings = {
    emailAccounts: widget.settings.emailAccounts ?? null,
    emailFolder: widget.settings.emailFolder ?? "inbox",
    emailAi: widget.settings.emailAi ?? "",
  };
  const ai = useEmailAi(widget);
  const setPrefs = (p: Partial<EmailSettings>) => void actions.updateWidgetSettings(widget.id, p);

  const shown = useMemo(
    () =>
      (accounts ?? []).filter((a) => !prefs.emailAccounts || prefs.emailAccounts.includes(a.id)),
    [accounts, prefs.emailAccounts],
  );
  const shownIds = shown.map((a) => a.id).join(",");
  const labelOf = useCallback(
    (id: string) => accounts?.find((a) => a.id === id)?.label ?? "",
    [accounts],
  );

  const [view, setView] = useState<View>({ kind: "list" });
  const [messages, setMessages] = useState<EmailSummary[] | null>(null);
  const [errors, setErrors] = useState<{ accountId: string; message: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [category, setCategory] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [undo, setUndo] = useState<Undo | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const undoTimer = useRef<number | undefined>(undefined);
  const listSeq = useRef(0);

  const load = useCallback(async () => {
    if (!shownIds) {
      setMessages([]);
      return;
    }
    const seq = ++listSeq.current;
    setLoading(true);
    try {
      const res = await window.mypa.email.list({
        accountIds: shownIds.split(","),
        folder: prefs.emailFolder,
        search: search || undefined,
        unreadOnly,
        limit: PAGE,
      });
      if (seq !== listSeq.current) return;
      setMessages(res.messages);
      setErrors(res.errors);
    } catch (err) {
      if (seq === listSeq.current) setErrors([{ accountId: "", message: errorText(err) }]);
    } finally {
      if (seq === listSeq.current) setLoading(false);
    }
  }, [shownIds, prefs.emailFolder, search, unreadOnly]);

  useEffect(() => {
    void load();
  }, [load]);

  // another folder or account: start fresh
  const where = `${shownIds}|${prefs.emailFolder}`;
  const [lastWhere, setLastWhere] = useState(where);
  if (where !== lastWhere) {
    setLastWhere(where);
    setSelected(new Set());
    setCategory(null);
  }

  // keep the list current as syncs, actions and the Assistant change mail
  useEffect(
    () =>
      onMailChanged((accountId) => {
        if (shownIds.split(",").includes(accountId)) void load();
      }),
    [load, shownIds],
  );

  useEffect(() => () => window.clearTimeout(undoTimer.current), []);

  const showUndo = (u: Undo) => {
    window.clearTimeout(undoTimer.current);
    setUndo(u);
    undoTimer.current = window.setTimeout(() => setUndo(null), 8_000);
  };

  /** Optimistic: the list changes now, the server follows. */
  const act = async (list: EmailSummary[], action: EmailAction) => {
    setActionError(null);
    const ids = list.map((m) => m.id);
    const removes = action === "archive" || action === "trash" || action === "inbox";
    setMessages((cur) =>
      cur
        ? removes
          ? cur.filter((m) => !ids.includes(m.id))
          : cur.map((m) =>
              ids.includes(m.id)
                ? {
                    ...m,
                    ...(action === "read" || action === "unread" ? { seen: action === "read" } : {}),
                    ...(action === "star" || action === "unstar"
                      ? { flagged: action === "star" }
                      : {}),
                  }
                : m,
            )
        : cur,
    );
    try {
      const { undoToken } = await window.mypa.email.act(ids, action);
      if (removes) {
        const what = ids.length > 1 ? `${ids.length} emails` : "";
        const label =
          action === "archive"
            ? `Archived ${what}`
            : action === "inbox"
              ? `Moved ${what} to inbox`
              : prefs.emailFolder === "trash"
                ? `Deleted ${what} for good`
                : `Moved ${what} to trash`;
        showUndo({
          label: label.replace(/\s+/g, " ").trim(),
          run: undoToken ? () => window.mypa.email.undo(undoToken) : null,
        });
      }
    } catch (err) {
      setActionError(errorText(err));
      void load();
    }
  };

  const runUndo = async () => {
    if (!undo?.run) return;
    const run = undo.run;
    setUndo(null);
    try {
      await run();
      await load();
    } catch (err) {
      setActionError(errorText(err));
    }
  };

  const setCategoryOf = async (list: EmailSummary[], next: string | null) => {
    const before = list.map((m) => ({ id: m.id, category: m.category }));
    const ids = new Set(list.map((m) => m.id));
    setMessages((cur) => cur && cur.map((m) => (ids.has(m.id) ? { ...m, category: next } : m)));
    try {
      await window.mypa.email.setCategories(list.map((m) => ({ id: m.id, category: next })));
      showUndo({
        label: next ? `Moved to ${next}` : "Category removed",
        run: () => window.mypa.email.setCategories(before),
      });
    } catch (err) {
      setActionError(errorText(err));
    }
  };

  /* -------- AI: catch up and sort -------- */
  const [panel, setPanel] = useState<{
    title: string;
    text: string;
    busy: boolean;
    error?: string;
  } | null>(null);
  const aiHandle = useRef<ChatHandle | null>(null);
  const closePanel = () => {
    aiHandle.current?.cancel();
    aiHandle.current = null;
    setPanel(null);
  };

  const runCatchUp = async () => {
    aiHandle.current?.cancel();
    setPanel({ title: "Catch up", text: "", busy: true });
    try {
      const res = await window.mypa.email.list({
        accountIds: shownIds.split(","),
        folder: "inbox",
        unreadOnly: true,
        limit: 30,
      });
      if (res.messages.length === 0) {
        setPanel({ title: "Catch up", text: "You're all caught up: no unread email.", busy: false });
        return;
      }
      const h = streamChat(ai.target, catchUpMessages(res.messages, labelOf), {
        delta: (text) => setPanel({ title: "Catch up", text, busy: true }),
      });
      aiHandle.current = h;
      const text = await h.done;
      if (aiHandle.current === h) setPanel({ title: "Catch up", text, busy: false });
    } catch (err) {
      setPanel({ title: "Catch up", text: "", busy: false, error: errorText(err) });
    }
  };

  const [sorting, setSorting] = useState<number | null>(null);
  const runSort = async () => {
    const todo = (messages ?? []).filter((m) => !m.category).slice(0, SORT_BATCH);
    if (todo.length === 0) {
      showUndo({ label: "Everything here is sorted", run: null });
      return;
    }
    aiHandle.current?.cancel();
    setPanel(null);
    setSorting(todo.length);
    const choices = categoryChoices(messages);
    const h = streamChat(ai.target, sortMessages(todo, choices));
    aiHandle.current = h;
    try {
      const text = await h.done;
      if (aiHandle.current !== h) return;
      const sorted = parseSort(text, todo, choices);
      if (sorted.size === 0)
        throw new Error("The AI's answer couldn't be read. Try again, or pick another AI in settings.");
      const patches = [...sorted].map(([id, c]) => ({ id, category: c }));
      setMessages(
        (cur) => cur && cur.map((m) => (sorted.has(m.id) ? { ...m, category: sorted.get(m.id)! } : m)),
      );
      await window.mypa.email.setCategories(patches);
      showUndo({
        label: `Sorted ${sorted.size} ${sorted.size === 1 ? "email" : "emails"}`,
        run: () =>
          window.mypa.email.setCategories(patches.map((p) => ({ id: p.id, category: null }))),
      });
    } catch (err) {
      setPanel({ title: "Sort", text: "", busy: false, error: errorText(err) });
    } finally {
      if (aiHandle.current === h) aiHandle.current = null;
      setSorting(null);
    }
  };
  useEffect(() => () => aiHandle.current?.cancel(), []);

  /* -------- drafts from the Assistant -------- */
  /** An Assistant draft opens like your own: signature, and for a reply the quoted original. */
  const openDraft = async (d: (typeof drafts)[number]) => {
    const account = accounts?.find((a) => a.id === d.accountId) ?? shown[0];
    let base = newCompose(account);
    if (d.replyToId) {
      try {
        base = replyCompose(await window.mypa.email.open(d.replyToId), account, false);
      } catch {
        /* the original moved or went away: the draft still opens, unthreaded */
      }
    }
    setView({
      kind: "compose",
      back: { kind: "list" },
      draft: {
        ...base,
        accountId: account?.id ?? "",
        to: d.to || base.to,
        cc: d.cc || base.cc,
        subject: d.subject || base.subject,
        text: base.text.trim()
          ? `${d.text.trim()}\n\n${base.text.replace(/^\n+/, "")}`
          : d.text.trim(),
        replyToId: base.replyToId,
        draftId: d.id,
      },
    });
  };

  if (accounts === null) {
    return (
      <div className="email email--center">
        <Loader2 size={16} className="email__spin" aria-label="Loading" />
      </div>
    );
  }

  if (accounts.length === 0) {
    return (
      <div className="email email--center">
        <span className="email__hero" aria-hidden="true">
          <Mail size={22} />
        </span>
        <p className="email__empty-title">Connect your email</p>
        <p className="email__empty-text">
          Gmail, Zoho Mail or any IMAP account, as many as you like. You'll need an app password
          from your provider's security settings.
        </p>
        <button type="button" className="btn" onClick={onOpenSettings}>
          Connect an account
        </button>
      </div>
    );
  }

  if (view.kind === "read") {
    return (
      <EmailReader
        summary={view.summary}
        account={accounts.find((a) => a.id === view.summary.accountId)}
        aiTarget={ai.target}
        categories={categoryChoices(messages)}
        onBack={() => setView({ kind: "list" })}
        onCompose={(draft) => setView({ kind: "compose", draft, back: view })}
        onAct={async (action) => {
          setView({ kind: "list" });
          await act([view.summary], action);
        }}
        onCategory={(c) => {
          setView({ kind: "read", summary: { ...view.summary, category: c } });
          void setCategoryOf([view.summary], c);
        }}
        onFlags={(patch) =>
          setMessages((cur) =>
            cur ? cur.map((m) => (m.id === view.summary.id ? { ...m, ...patch } : m)) : cur,
          )
        }
      />
    );
  }

  if (view.kind === "compose") {
    return (
      <EmailCompose
        widgetId={widget.id}
        initial={view.draft}
        accounts={accounts}
        aiTarget={ai.target}
        onClose={(sent) => {
          if (view.draft.draftId) void window.mypa.email.dismissDraft(view.draft.draftId);
          setView(sent ? { kind: "list" } : view.back);
          if (sent) showUndo({ label: "Sent", run: null });
        }}
      />
    );
  }

  const folder = prefs.emailFolder;
  const unsent = readUnsent(widget.id);
  const many = shown.length > 1;
  const unread = shown.reduce((n, a) => n + a.unread, 0);
  const accountErrors = shown.filter((a) => a.status === "error");

  const inUse = new Map<string, number>();
  for (const m of messages ?? [])
    if (m.category) inUse.set(m.category, (inUse.get(m.category) ?? 0) + 1);
  const visible = (messages ?? []).filter((m) => !category || m.category === category);
  const picked = visible.filter((m) => selected.has(m.id));
  const selecting = picked.length > 0;
  const toggle = (id: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const bulk = (action: EmailAction) => {
    setSelected(new Set());
    void act(picked, action);
  };
  const allStarred = picked.every((m) => m.flagged);

  return (
    <div className="email">
      {selecting ? (
        <div className="email__bar email__bar--select">
          <IconButton label="Clear selection" onClick={() => setSelected(new Set())}>
            <X size={15} />
          </IconButton>
          <span className="email__count num">{picked.length} selected</span>
          {picked.length < visible.length && (
            <button
              type="button"
              className="email__link"
              onClick={() => setSelected(new Set(visible.map((m) => m.id)))}
            >
              All {visible.length}
            </button>
          )}
          <span className="email__spacer" />
          {folder === "inbox" || folder === "starred" || folder === "sent" ? (
            <IconButton label="Archive" onClick={() => bulk("archive")}>
              <Archive size={14} />
            </IconButton>
          ) : (
            <IconButton label="Move to inbox" onClick={() => bulk("inbox")}>
              <Inbox size={14} />
            </IconButton>
          )}
          <IconButton
            label={folder === "trash" ? "Delete for good" : "Delete"}
            onClick={() => bulk("trash")}
          >
            <Trash2 size={14} />
          </IconButton>
          {picked.some((m) => !m.seen) ? (
            <IconButton label="Mark as read" onClick={() => bulk("read")}>
              <MailOpen size={14} />
            </IconButton>
          ) : (
            <IconButton label="Mark as unread" onClick={() => bulk("unread")}>
              <Mail size={14} />
            </IconButton>
          )}
          <IconButton
            label={allStarred ? "Remove star" : "Star"}
            onClick={() => bulk(allStarred ? "unstar" : "star")}
          >
            <Star size={14} />
          </IconButton>
          <CategoryPicker
            choices={categoryChoices(messages)}
            current={null}
            onPick={(c) => {
              setSelected(new Set());
              void setCategoryOf(picked, c);
            }}
          />
        </div>
      ) : (
        <div className="email__bar">
          {accounts.length > 1 ? (
            <AccountPicker
              accounts={accounts}
              value={prefs.emailAccounts?.length === 1 ? prefs.emailAccounts[0]! : "all"}
              onChange={(v) => setPrefs({ emailAccounts: v === "all" ? null : [v] })}
            />
          ) : (
            <span className="email__who" title={accounts[0]!.address}>
              {accounts[0]!.label}
            </span>
          )}
          <span className="email__spacer" />
          <IconButton
            label="Search"
            on={searchOpen}
            onClick={() => {
              setSearchOpen((o) => !o);
              if (searchOpen) {
                setQuery("");
                setSearch("");
              }
            }}
          >
            <Search size={14} />
          </IconButton>
          <IconButton
            label="Check for new mail"
            disabled={loading}
            onClick={async () => {
              await Promise.all(shown.map((a) => window.mypa.email.syncAccount(a.id)));
              await load();
            }}
          >
            <RefreshCw size={14} className={loading ? "email__spin" : undefined} />
          </IconButton>
          <button
            type="button"
            className="email__write"
            onClick={() =>
              setView({ kind: "compose", back: { kind: "list" }, draft: newCompose(shown[0]) })
            }
          >
            <PenSquare size={13} />
            Write
          </button>
        </div>
      )}

      <nav className="email__tabs" aria-label="Folders">
        {EMAIL_FOLDERS.map((f) => (
          <button
            key={f.id}
            type="button"
            className={`email__tab${f.id === folder ? " is-on" : ""}`}
            aria-current={f.id === folder ? "page" : undefined}
            onClick={() => setPrefs({ emailFolder: f.id })}
          >
            {f.label}
            {f.id === "inbox" && unread > 0 && <span className="email__badge num">{unread}</span>}
          </button>
        ))}
      </nav>

      {searchOpen && (
        <form
          className="email__search"
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(query.trim());
          }}
        >
          <Search size={13} className="email__search-icon" aria-hidden="true" />
          <input
            autoFocus
            className="email__search-input"
            placeholder={`Search ${EMAIL_FOLDERS.find((f) => f.id === folder)?.label.toLowerCase()}, then Enter`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setSearchOpen(false);
                setQuery("");
                setSearch("");
              }
            }}
          />
          <button
            type="button"
            className={`email__chip${unreadOnly ? " is-on" : ""}`}
            aria-pressed={unreadOnly}
            onClick={() => setUnreadOnly((u) => !u)}
          >
            Unread
          </button>
        </form>
      )}

      {inUse.size > 0 && (
        <div className="email__cats" role="toolbar" aria-label="Categories">
          <button
            type="button"
            className={`email__chip${category === null ? " is-on" : ""}`}
            aria-pressed={category === null}
            onClick={() => setCategory(null)}
          >
            All
          </button>
          {[...inUse]
            .sort((a, b) => b[1] - a[1])
            .map(([c, n]) => (
              <button
                key={c}
                type="button"
                className={`email__chip${category === c ? " is-on" : ""}`}
                aria-pressed={category === c}
                onClick={() => setCategory(category === c ? null : c)}
              >
                {c}
                <span className="email__chip-n num">{n}</span>
              </button>
            ))}
        </div>
      )}

      {accountErrors.map((a) => (
        <div key={a.id} className="email__notice" role="alert">
          <span>
            <strong>{a.label}:</strong> {a.errorMessage}
          </span>
          <button type="button" className="email__link" onClick={onOpenSettings}>
            Fix
          </button>
        </div>
      ))}
      {errors
        .filter((e) => !accountErrors.some((a) => a.id === e.accountId))
        .map((e) => (
          <div key={e.accountId} className="email__notice" role="alert">
            <span>
              {e.accountId ? <strong>{labelOf(e.accountId)}: </strong> : null}
              {e.message}
            </span>
          </div>
        ))}
      {actionError && (
        <div className="email__notice" role="alert">
          <span>{actionError}</span>
          <button type="button" className="email__link" onClick={() => setActionError(null)}>
            Dismiss
          </button>
        </div>
      )}

      {unsent && (
        <div className="email__draft">
          <PenSquare size={13} aria-hidden="true" />
          <span className="email__draft-text">
            Unsent: <strong>{unsent.subject || unsent.to || "(no subject)"}</strong>
          </span>
          <button
            type="button"
            className="email__link"
            onClick={() => setView({ kind: "compose", back: { kind: "list" }, draft: unsent })}
          >
            Continue
          </button>
          <button
            type="button"
            className="email__icon email__icon--sm"
            aria-label="Discard unsent email"
            onClick={() => {
              clearUnsent(widget.id);
              showUndo({ label: "Discarded", run: null });
            }}
          >
            <X size={12} />
          </button>
        </div>
      )}

      {drafts.slice(0, 2).map((d) => (
        <div key={d.id} className="email__draft">
          <Sparkles size={13} aria-hidden="true" />
          <span className="email__draft-text">
            The Assistant wrote a draft: <strong>{d.subject || "(no subject)"}</strong>
          </span>
          <button type="button" className="email__link" onClick={() => void openDraft(d)}>
            Review
          </button>
          <button
            type="button"
            className="email__icon email__icon--sm"
            aria-label="Discard draft"
            onClick={() => void window.mypa.email.dismissDraft(d.id)}
          >
            <X size={12} />
          </button>
        </div>
      ))}

      {panel && (
        <div className="email__catchup">
          <div className="email__catchup-head">
            <Sparkles size={13} aria-hidden="true" />
            <span>{panel.title}</span>
            {panel.busy && <Loader2 size={12} className="email__spin" aria-label="Writing" />}
            <span className="email__spacer" />
            <button
              type="button"
              className="email__icon email__icon--sm"
              aria-label="Close"
              onClick={closePanel}
            >
              <X size={12} />
            </button>
          </div>
          {panel.error ? (
            <p className="email__catchup-error">{panel.error}</p>
          ) : panel.text ? (
            <Markdown text={panel.text} className="email__catchup-body note__md" />
          ) : (
            <p className="email__catchup-wait">Reading your unread mail…</p>
          )}
        </div>
      )}

      <div className="email__list" role="list" aria-busy={loading}>
        {messages === null ? (
          <p className="email__empty-text email__list-msg">
            <Loader2 size={13} className="email__spin" /> Loading…
          </p>
        ) : visible.length === 0 ? (
          <div className="email__list-empty">
            <span className="email__hero" aria-hidden="true">
              {folder === "inbox" && !search && !unreadOnly && !category ? (
                <Check size={20} />
              ) : (
                <Inbox size={20} />
              )}
            </span>
            <p className="email__empty-text">
              {search
                ? "Nothing matches that search."
                : category
                  ? `Nothing in ${category} here.`
                  : unreadOnly
                    ? "No unread mail here."
                    : folder === "inbox"
                      ? shown.every((a) => a.lastSyncedAt == null)
                        ? "Checking your inbox…"
                        : "Inbox zero. Nice."
                      : "Nothing here."}
            </p>
          </div>
        ) : (
          visible.map((m, i) => {
            const group = dayGroup(m.date);
            const prev = visible[i - 1];
            return (
              <div key={m.id} role="presentation">
                {(!prev || dayGroup(prev.date) !== group) && (
                  <div className="email__group">{group}</div>
                )}
                <Row
                  m={m}
                  account={
                    many
                      ? { label: labelOf(m.accountId), hue: accountHue(accounts, m.accountId) }
                      : undefined
                  }
                  folder={folder}
                  selected={selected.has(m.id)}
                  selecting={selecting}
                  onToggle={() => toggle(m.id)}
                  onOpen={() => {
                    setMessages((cur) =>
                      cur ? cur.map((x) => (x.id === m.id ? { ...x, seen: true } : x)) : cur,
                    );
                    setView({ kind: "read", summary: m });
                  }}
                  onAct={(a) => void act([m], a)}
                />
              </div>
            );
          })
        )}
      </div>

      {ai.target !== "off" && (
        <AskBar sorting={sorting} onCatchUp={() => void runCatchUp()} onSort={() => void runSort()} />
      )}

      {undo && (
        <div className="email__undo" role="status">
          <span>{undo.label}</span>
          {undo.run && (
            <button type="button" className="email__link" onClick={() => void runUndo()}>
              Undo
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function IconButton({
  label,
  on,
  disabled,
  onClick,
  children,
}: {
  label: string;
  on?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={`email__icon${on ? " is-on" : ""}`}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function AccountPicker({
  accounts,
  value,
  onChange,
}: {
  accounts: EmailAccount[];
  value: string;
  onChange: (v: string) => void;
}) {
  const showing = value === "all" ? accounts : accounts.filter((a) => a.id === value);
  return (
    <label className="email__acct-pick">
      <span className="email__acct-dots" aria-hidden="true">
        {showing.slice(0, 3).map((a) => (
          <span
            key={a.id}
            className="email__acct-dot"
            style={hueStyle(accountHue(accounts, a.id))}
          />
        ))}
      </span>
      <select aria-label="Accounts" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="all">All accounts</option>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.label}
            {a.unread ? ` (${a.unread})` : ""}
          </option>
        ))}
      </select>
    </label>
  );
}

function AskBar({
  sorting,
  onCatchUp,
  onSort,
}: {
  sorting: number | null;
  onCatchUp: () => void;
  onSort: () => void;
}) {
  const [text, setText] = useState("");
  const [idea] = useState(() => ASK_IDEAS[Math.floor(Math.random() * ASK_IDEAS.length)]!);
  const submit = () => {
    const t = text.trim();
    if (!t) return;
    // the Assistant picks its email tools from the words used; make sure it knows
    askAssistant(/e-?mail|mail|inbox/i.test(t) ? t : `In my email: ${t}`);
    setText("");
  };
  return (
    <div className="email__ask">
      <form
        className="email__ask-box"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Sparkles size={14} className="email__ask-icon" aria-hidden="true" />
        <input
          className="email__ask-input"
          aria-label="Ask the Assistant about your email"
          placeholder={`Ask AI: “${idea}”`}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button
          type="submit"
          className="email__ask-send"
          aria-label="Ask"
          title="Ask the Assistant (it asks you before moving or deleting mail)"
          disabled={!text.trim()}
        >
          <ArrowUp size={13} />
        </button>
      </form>
      <button
        type="button"
        className="email__chip email__chip--ai"
        title="What's in your unread mail"
        onClick={onCatchUp}
      >
        <Sparkles size={12} />
        Catch up
      </button>
      <button
        type="button"
        className="email__chip email__chip--ai"
        disabled={sorting !== null}
        onClick={onSort}
        title="Sort these emails into categories"
      >
        {sorting !== null ? <Loader2 size={12} className="email__spin" /> : <Tags size={12} />}
        {sorting !== null ? `Sorting ${sorting}…` : "Sort"}
      </button>
    </div>
  );
}

function Row({
  m,
  account,
  folder,
  selected,
  selecting,
  onToggle,
  onOpen,
  onAct,
}: {
  m: EmailSummary;
  account: { label: string; hue: number } | undefined;
  folder: EmailFolder;
  selected: boolean;
  selecting: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onAct: (a: EmailAction) => void;
}) {
  const sent = folder === "sent";
  const person = sent ? (m.to[0] ?? m.from) : m.from;
  const who = sent ? `To: ${m.to.map(personName).join(", ") || "—"}` : personName(m.from);
  const cls = [
    "email__row",
    m.seen ? "" : "is-unread",
    selected ? "is-selected" : "",
    selecting ? "is-selecting" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={cls} role="listitem">
      <button
        type="button"
        className="email__pick"
        role="checkbox"
        aria-checked={selected}
        aria-label={`Select the email from ${personName(m.from)}`}
        onClick={onToggle}
      >
        <Avatar person={person} />
        <span className="email__pick-box" aria-hidden="true">
          <Check size={14} />
        </span>
      </button>
      <button type="button" className="email__row-main" onClick={selecting ? onToggle : onOpen}>
        <span className="email__row-top">
          <span className="email__from">{who}</span>
          {m.hasAttachments && (
            <Paperclip size={11} className="email__clip" aria-label="Has attachments" />
          )}
          {m.flagged && <Star size={11} className="email__star-on" aria-label="Starred" />}
          <span className="email__when num">{shortWhen(m.date)}</span>
          {!m.seen && <span className="email__dot" aria-label="Unread" />}
        </span>
        <span className="email__subject">{m.subject || "(no subject)"}</span>
        <span className="email__snippet">{m.snippet ?? ""}</span>
        {(m.category || account) && (
          <span className="email__tags">
            {m.category && <span className="email__tag">{m.category}</span>}
            {account && (
              <span
                className="email__tag email__tag--acct"
                style={hueStyle(account.hue)}
              >
                {account.label}
              </span>
            )}
          </span>
        )}
      </button>
      {!selecting && (
        <span className="email__row-actions">
          {folder === "inbox" || folder === "starred" || sent ? (
            <RowAction label="Archive" onClick={() => onAct("archive")}>
              <Archive size={13} />
            </RowAction>
          ) : (
            <RowAction label="Move to inbox" onClick={() => onAct("inbox")}>
              {folder === "archive" ? <ArchiveRestore size={13} /> : <Inbox size={13} />}
            </RowAction>
          )}
          <RowAction
            label={folder === "trash" ? "Delete for good" : "Delete"}
            onClick={() => onAct("trash")}
          >
            <Trash2 size={13} />
          </RowAction>
          <RowAction
            label={m.seen ? "Mark as unread" : "Mark as read"}
            onClick={() => onAct(m.seen ? "unread" : "read")}
          >
            {m.seen ? <Mail size={13} /> : <MailOpen size={13} />}
          </RowAction>
          <RowAction
            label={m.flagged ? "Remove star" : "Star"}
            on={m.flagged}
            onClick={() => onAct(m.flagged ? "unstar" : "star")}
          >
            <Star size={13} />
          </RowAction>
        </span>
      )}
    </div>
  );
}

function RowAction({
  label,
  on,
  onClick,
  children,
}: {
  label: string;
  on?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={`email__icon email__icon--sm${on ? " is-starred" : ""}`}
      title={label}
      aria-label={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
