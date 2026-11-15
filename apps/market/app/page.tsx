/*
  Kind: software (a free desktop app). Main action: Download for Windows.
  Deal: hero split (the board window, one float card); nav-mega; footer-columns; close-type;
  rhythm space; buttons pill; mark: the client's own logo. Grounds: paper, topglow.
  Palette: the app's own (black on #f2f2f2, white panels, one ultramarine accent), kept by the
  user's choice so the site and the app read as one product. Type: Poppins, display 500.
  Moment: letters-assemble in the statement section (the claim builds itself as you reach it).
  Voice: plain-practical. "You" for the reader, myPA as the subject; 8 to 16 word sentences;
  no virtue words; the one admission is Windows only and the unsigned installer.
*/
import Link from "next/link";

import { CloudSun, Globe, Link2, Repeat, Target, Timer } from "lucide-react";

import { BoardWindow, AssistantFrame } from "@/components/product/Board";
import {
  CaptureVisual,
  ExpensesVisual,
  FlashcardsVisual,
  JournalVisual,
  PlannerVisual,
} from "@/components/product/Fragments";
import { Hub } from "@/components/product/Hub";
import { Moments } from "@/components/Moments";
import { Rise } from "@/components/Rise";
import { Seal } from "@/components/icons";
import { latestRelease, megabytes } from "@/lib/release";

export const revalidate = 3600;

export default async function Home() {
  const rel = await latestRelease();
  const size = megabytes(rel.size);

  return (
    <>
      <section className="p-hero" data-enter aria-labelledby="hero-h">
        <div className="wrap p-hero__grid">
          <div className="p-hero__text">
            <Link href="/changelog" className="p-notice">
              <span className="p-notice__dot" aria-hidden />
              New in {rel.version}: updates install by themselves
            </Link>
            <h1 id="hero-h" className="p-h1">
              <Rise text="One board for your tasks, mail and calendar" />
            </h1>
            <p className="p-hero__lead" data-enter-up>
              myPA is a free Windows app that puts your to-do list, calendar, email and notes side by
              side, with an AI Assistant that runs on your own computer.
            </p>
            <div className="p-hero__ctas" data-enter-up>
              <Link href="/download" className="btn btn--primary btn--lg">
                Download for Windows
              </Link>
              <Link href="/features" className="btn btn--lg">
                See every widget
              </Link>
            </div>
            <ul className="p-facts" data-enter-up>
              <li>Free and open source</li>
              <li>Windows 10 and 11</li>
              <li>22 built-in widgets</li>
            </ul>
          </div>
          <div className="p-hero__art" data-enter-media>
            <BoardWindow />
            <div className="p-float" aria-hidden>
              <span className="p-float__dot" />
              <span>
                <b>Leave for the dentist</b>
                <span className="muted">In 20 minutes, at 15:10</span>
              </span>
            </div>
          </div>
        </div>
      </section>

      <section className="p-sec" id="assistant" aria-labelledby="assistant-h">
        <div className="wrap">
          <div className="p-head">
            <h2 id="assistant-h" className="p-h2">
              An Assistant that asks before it acts
            </h2>
            <p className="p-head__line">
              Tell it what you want in plain words. It reads your mail, calendar and lists, shows you
              what it will change, and waits for your yes. Every change can be undone.{" "}
              <Link href="/features#assistant" className="link">
                How the Assistant works
              </Link>
            </p>
          </div>
          <AssistantFrame />
        </div>
      </section>

      <section className="p-sec" id="widgets" aria-labelledby="widgets-h">
        <div className="wrap">
          <div className="p-head">
            <h2 id="widgets-h" className="p-h2">
              Widgets for work, study and home
            </h2>
            <p className="p-head__line">
              Drag them where you want them, one page per part of your life.{" "}
              <Link href="/features" className="link">
                See all 22 widgets
              </Link>
            </p>
          </div>
          <div className="bento">
            <article className="bt bt--7">
              <PlannerVisual />
              <div className="bt__text">
                <h3>Plans your day around meetings</h3>
                <p>The Daily Planner fills the gaps between calls with your tasks.</p>
              </div>
            </article>
            <article className="bt bt--5">
              <CaptureVisual />
              <div className="bt__text">
                <h3>Catches a thought from any app</h3>
                <p>Press Ctrl+Shift+Space, type it, and it lands as a task or reminder.</p>
              </div>
            </article>
            <article className="bt bt--4">
              <FlashcardsVisual />
              <div className="bt__text">
                <h3>Quizzes you on your notes</h3>
                <p>Cards come back on a spaced-repetition schedule.</p>
              </div>
            </article>
            <article className="bt bt--4">
              <ExpensesVisual />
              <div className="bt__text">
                <h3>Keeps spending inside a budget</h3>
                <p>Bills, categories and a month at a glance.</p>
              </div>
            </article>
            <article className="bt bt--4">
              <JournalVisual />
              <div className="bt__text">
                <h3>Locks a private journal</h3>
                <p>A passcode on every entry, reset with Windows Hello.</p>
              </div>
            </article>
          </div>
        </div>
      </section>

      <section className="p-sec p-statement" data-moment="letters-assemble" aria-labelledby="own-h">
        <div className="wrap">
          <h2 id="own-h" className="mo-la__type">
            Your desk, your data
          </h2>
          <p className="mo-la__sub">
            Everything you add is saved in one file on your computer. There is no account to make, and
            the built-in AI keeps working with the Wi-Fi off.
          </p>
        </div>
      </section>

      <section className="p-sec" id="privacy" aria-labelledby="privacy-h">
        <div className="wrap p-split">
          <div className="p-split__text">
            <h2 id="privacy-h" className="p-h2">
              What leaves your computer
            </h2>
            <p className="p-head__line">
              Only what you connect. Keys and app passwords are encrypted with Windows&rsquo; own
              keychain.
            </p>
            <Link href="/privacy" className="link">
              Read the privacy policy
            </Link>
          </div>
          <dl className="rows">
            <div className="rows__row">
              <dt>Tasks, notes, journal, money</dt>
              <dd>Nothing. They stay in one file on your computer.</dd>
            </div>
            <div className="rows__row">
              <dt>Built-in AI and transcription</dt>
              <dd>Nothing, after a one-time model download.</dd>
            </div>
            <div className="rows__row">
              <dt>Calendar and email</dt>
              <dd>Only to the provider you sign in to.</dd>
            </div>
            <div className="rows__row">
              <dt>Your own AI account</dt>
              <dd>Only the messages you send it, with your own key.</dd>
            </div>
            <div className="rows__row">
              <dt>Marketplace widgets</dt>
              <dd>Only to the sites each widget lists, after you allow them.</dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="p-sec" id="connects" aria-labelledby="connects-h">
        <div className="wrap p-split p-split--art">
          <Hub />
          <div className="p-split__text">
            <h2 id="connects-h" className="p-h2">
              Works with the accounts you already have
            </h2>
            <p className="p-head__line">
              Add as many calendars and inboxes as you like: Google, Zoho, iCloud, Fastmail or any
              CalDAV and IMAP account, plus read-only Outlook feeds. Bring an OpenAI or Anthropic key, or
              use the built-in model.
            </p>
          </div>
        </div>
      </section>

      <section className="p-sec" id="marketplace" aria-labelledby="market-h">
        <div className="wrap">
          <div className="p-head">
            <h2 id="market-h" className="p-h2">
              More widgets in the Marketplace
            </h2>
            <p className="p-head__line">
              Install them from inside myPA. Each one runs in a sandbox and sees only what you allow.{" "}
              <Link href="/marketplace" className="link">
                Browse the Marketplace
              </Link>
            </p>
          </div>
          <div className="shelf">
            {SHELF.map((w) => (
              <Link key={w.name} href="/marketplace" className="shelf__item">
                <span className="shelf__icon" aria-hidden>
                  <w.icon size={20} strokeWidth={1.75} />
                </span>
                <span className="shelf__name">
                  {w.name}
                  <Seal trust="official" size={14} />
                </span>
                <span className="muted">{w.line}</span>
              </Link>
            ))}
          </div>
          <p className="p-aside">
            Know some HTML and JavaScript? <Link href="/developers" className="link">Build a widget</Link> and
            sell it here, or give it away.
          </p>
        </div>
      </section>

      <section className="p-sec" id="questions" aria-labelledby="faq-h">
        <div className="wrap p-split">
          <div className="p-split__text">
            <h2 id="faq-h" className="p-h2">
              Questions before you install
            </h2>
            <Link href="/help" className="link">
              Read every answer
            </Link>
          </div>
          <dl className="faq">
            <div>
              <dt>Does it cost anything?</dt>
              <dd>No. myPA is free and open source. Some Marketplace widgets are paid, and say so.</dd>
            </div>
            <div>
              <dt>Does it run on a Mac?</dt>
              <dd>Not yet. myPA is built and tested on Windows 10 and 11.</dd>
            </div>
            <div>
              <dt>Why does Windows warn me when I install it?</dt>
              <dd>
                The installer isn&rsquo;t code-signed yet, so Windows doesn&rsquo;t recognise it. Choose
                More info, then Run anyway.
              </dd>
            </div>
            <div>
              <dt>Do I need an AI subscription?</dt>
              <dd>No. The built-in model runs on your computer. An OpenAI or Anthropic key is optional.</dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="p-sec p-close" aria-labelledby="close-h">
        <div className="wrap">
          <h2 id="close-h" className="p-h2 p-close__h">
            Put your whole day on one board
          </h2>
          <p className="muted p-close__line">
            Free · Windows 10 and 11 · Version {rel.version}
            {size ? ` · ${size}` : ""}
          </p>
          <Link href="/download" className="btn btn--primary btn--xl">
            Download for Windows
          </Link>
        </div>
      </section>

      <Moments />
    </>
  );
}

const SHELF = [
  { name: "Focus timer", line: "Focused blocks with breaks between", icon: Timer },
  { name: "Habits", line: "Tick each day, watch the streak", icon: Repeat },
  { name: "Today's focus", line: "Your most important open tasks", icon: Target },
  { name: "Weather", line: "The next six hours and four days", icon: CloudSun },
  { name: "World clock", line: "Who is awake, and who is working", icon: Globe },
  { name: "Quick links", line: "The tools you open most", icon: Link2 },
];
