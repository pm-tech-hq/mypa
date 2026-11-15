import type { Metadata } from "next";
import Link from "next/link";

import { ISSUES_URL } from "@/lib/release";
import { faqLd, JsonLd, pageMeta } from "@/lib/seo";

export const metadata: Metadata = pageMeta({
  title: "Help and FAQ",
  description:
    "Answers about installing and updating myPA, where your data is kept, the offline AI assistant, connecting Google, iCloud and IMAP accounts, and Marketplace widgets.",
  path: "/help",
});

interface QA {
  q: string;
  a: React.ReactNode;
  /** The answer as plain text, for search engines, when `a` has links in it. */
  plain?: string;
}

const GROUPS: { id: string; title: string; items: QA[] }[] = [
  {
    id: "install",
    title: "Installing and updating",
    items: [
      {
        q: "Which computers does myPA run on?",
        a: "64-bit Windows 10 and 11. It builds on macOS and Linux from the source code, but those builds aren't tested yet.",
      },
      {
        q: "Why does Windows warn me about the installer?",
        a: (
          <>
            The installer isn&rsquo;t code-signed yet, so SmartScreen doesn&rsquo;t recognise it. Choose
            More info, then Run anyway. The <Link href="/download">download page</Link> shows the screen
            you will see.
          </>
        ),
        plain:
          "The installer isn't code-signed yet, so SmartScreen doesn't recognise it. Choose More info, then Run anyway.",
      },
      {
        q: "Windows won't run the installer or an update at all. Why?",
        a: "Your computer probably has Smart App Control turned on. It allows only signed apps, with no way to make an exception. Until myPA's installer is signed, it can block both installs and updates.",
      },
      {
        q: "How do updates work?",
        a: "myPA checks for a new version every four hours and downloads it in the background. It installs when you restart myPA, or straight away from Restart to update in Settings.",
      },
      {
        q: "How do I uninstall it?",
        a: "From Windows Settings, Apps, like any other app. Your data stays in its folder, so a reinstall picks up where you left off.",
      },
    ],
  },
  {
    id: "data",
    title: "Your data",
    items: [
      {
        q: "Where is my data kept?",
        a: (
          <>
            In one file on your computer: <code>%APPDATA%\mypa\mypa.db</code>. myPA keeps a backup of the
            last good copy next to it, and saves in a way that survives a crash or power cut.
          </>
        ),
        plain:
          "In one file on your computer, %APPDATA%\\mypa\\mypa.db. myPA keeps a backup of the last good copy next to it, and saves in a way that survives a crash or power cut.",
      },
      {
        q: "Do I need an account?",
        a: "No. myPA has no sign-up. You only sign in to the calendars, inboxes or AI services you choose to connect.",
      },
      {
        q: "How do I keep a copy of my data?",
        a: "Close myPA and copy mypa.db somewhere safe. That one file holds your pages, widgets, tasks, notes and journal.",
      },
    ],
  },
  {
    id: "ai",
    title: "The Assistant and AI",
    items: [
      {
        q: "Do I need an AI subscription?",
        a: "No. myPA can download a model that runs on your own computer: Qwen 2.5 or Phi-4 mini, from about 750 MB to 2.7 GB. It works offline.",
      },
      {
        q: "Can I use ChatGPT or Claude instead?",
        a: "Yes. Add your own OpenAI or Anthropic key, or any OpenAI-compatible service. Your key is encrypted with Windows' keychain, and only the messages you send go to that service.",
      },
      {
        q: "Will the Assistant change things without asking?",
        a: "No. It shows what it will do and waits for your yes before it moves mail, changes your calendar or edits your lists. It deletes mail only to Trash, never sends email, and every change can be undone.",
      },
    ],
  },
  {
    id: "accounts",
    title: "Calendars and email",
    items: [
      {
        q: "Which calendars can I connect?",
        a: "Google, Zoho, iCloud, Fastmail and any CalDAV calendar, as many as you like. Outlook and other ICS links can be added read-only.",
      },
      {
        q: "Why does Google Calendar ask me for a client ID?",
        a: "Copies of myPA from this site don't include a Google app ID yet. The calendar settings walk you through making your own in Google Cloud Console once; after that, each Google account is one click.",
      },
      {
        q: "Which inboxes work?",
        a: "Gmail, Zoho Mail and any IMAP account, with an app password from your provider. Remote images stay hidden until you choose to show them.",
      },
    ],
  },
  {
    id: "widgets",
    title: "Marketplace widgets",
    items: [
      {
        q: "How do I install a widget?",
        a: (
          <>
            Inside myPA: Add widget, then Browse the marketplace. You can also look through the{" "}
            <Link href="/marketplace">Marketplace</Link> here first.
          </>
        ),
        plain: "Inside myPA, choose Add widget, then Browse the marketplace.",
      },
      {
        q: "Are widgets from other people safe?",
        a: "Each one runs in a sandbox and can only use what you approve when you install it, such as reading your tasks or reaching one website. A checkmark shows a publisher we have verified.",
      },
      {
        q: "Can I make my own?",
        a: (
          <>
            Yes. A widget is HTML, CSS and JavaScript with a small SDK. The{" "}
            <Link href="/developers">developer guide</Link> covers building, publishing and selling one.
          </>
        ),
        plain:
          "Yes. A widget is HTML, CSS and JavaScript with a small SDK. The developer guide on my-pa.xyz covers building, publishing and selling one.",
      },
    ],
  },
];

export default function Help() {
  const faq = GROUPS.flatMap((g) =>
    g.items.map((it) => ({ q: it.q, a: typeof it.a === "string" ? it.a : (it.plain ?? "") })),
  ).filter((it) => it.a);
  return (
    <>
      <JsonLd data={faqLd(faq)} />
      <header className="page-head">
        <div className="wrap">
          <h1 className="p-h1">Help and questions</h1>
          <p className="page-head__lead">
            Installing, updating, where your data lives, and connecting your accounts. Something
            missing?{" "}
            <a href={ISSUES_URL} className="link" rel="noopener">
              Ask on GitHub
            </a>
            .
          </p>
          <nav className="f-jump" aria-label="Topics">
            {GROUPS.map((g) => (
              <a key={g.id} href={`#${g.id}`} className="f-jump__link">
                {g.title}
              </a>
            ))}
          </nav>
        </div>
      </header>
      {GROUPS.map((g, i) => (
        <section
          key={g.id}
          id={g.id}
          className={`p-sec p-sec--auto f-area${i === GROUPS.length - 1 ? " dl-last" : ""}`}
          aria-labelledby={`${g.id}-h`}
        >
          <div className="wrap p-split">
            <h2 id={`${g.id}-h`} className="p-h2 help__h">
              {g.title}
            </h2>
            <dl className="faq prose-links">
              {g.items.map((it) => (
                <div key={it.q}>
                  <dt>{it.q}</dt>
                  <dd>{it.a}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>
      ))}
    </>
  );
}
