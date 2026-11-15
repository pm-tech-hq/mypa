/*
  Features: every built-in widget, grouped by the part of the day it serves, then the Assistant.
  Moment: liquid-type on the statement headline (it ripples under the pointer, plain at rest).
*/
import type { Metadata } from "next";
import Link from "next/link";

import { AssistantFrame } from "@/components/product/Board";
import { Moments } from "@/components/Moments";
import { AREAS, BUILT_IN_COUNT } from "@/lib/catalog";
import { pageMeta } from "@/lib/seo";

export const metadata: Metadata = pageMeta({
  title: "Features: 22 widgets for work, study and home",
  description:
    "To-do lists, a daily planner, calendar, email, flashcards, transcription, budgets and a locked journal: every widget built into myPA, and the AI assistant that works across them.",
  path: "/features",
});

const MODELS = [
  { name: "Qwen 2.5 · 0.5B", line: "The fastest. About a 750 MB download." },
  { name: "Qwen 2.5 · 1.5B", line: "The one we recommend. About 1.7 GB." },
  { name: "Phi-4 mini · 3.8B", line: "The most capable, and slow without a good processor. About 2.7 GB." },
];

export default function Features() {
  return (
    <>
      <section className="p-sec f-hero" aria-labelledby="f-h">
        <div className="wrap">
          <div data-moment="liquid-type" data-moment-opts='{"strength": 0.9}'>
            <h1 id="f-h" className="mo-lt__type f-hero__h">
              Every widget in myPA
            </h1>
          </div>
          <p className="page-head__lead f-hero__lead">
            Everything your assistant can do, running on your own computer. {BUILT_IN_COUNT} widgets
            come built in: put them on as many pages as you like, size them to fit, and ask the
            assistant to use any of them for you.
          </p>
          <nav className="f-jump" aria-label="Areas">
            {AREAS.map((a) => (
              <a key={a.id} href={`#${a.id}`} className="f-jump__link">
                {a.title}
              </a>
            ))}
            <a href="#assistant" className="f-jump__link">
              The Assistant
            </a>
          </nav>
        </div>
      </section>

      {AREAS.map((a) => (
        <section key={a.id} id={a.id} className="p-sec p-sec--auto f-area" aria-labelledby={`${a.id}-h`}>
          <div className="wrap p-split">
            <div className="p-split__text">
              <h2 id={`${a.id}-h`} className="p-h2">
                {a.title}
              </h2>
              <p className="p-head__line">{a.line}</p>
            </div>
            <dl className="rows rows--wide">
              {a.widgets.map((w) => (
                <div key={w.name} className="rows__row">
                  <dt>{w.name}</dt>
                  <dd>{w.line}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>
      ))}

      <section id="assistant" className="p-sec p-sec--auto f-area" aria-labelledby="assistant-h">
        <div className="wrap">
          <div className="p-head">
            <h2 id="assistant-h" className="p-h2">
              The Assistant works across every widget
            </h2>
            <p className="p-head__line">
              Ask it to plan your afternoon, find an email, add an event or tidy your lists. It shows
              you each change first. It deletes mail only to Trash and never sends anything for you.
            </p>
          </div>
          <AssistantFrame />
          <div className="f-models">
            <div>
              <h3 className="p-h3">The built-in model</h3>
              <p className="muted">
                Downloaded once, then it runs on your computer with no account and no internet.
              </p>
              <dl className="rows">
                {MODELS.map((m) => (
                  <div key={m.name} className="rows__row">
                    <dt>{m.name}</dt>
                    <dd>{m.line}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <div>
              <h3 className="p-h3">Or your own AI account</h3>
              <p className="muted">
                Add a key for OpenAI, Anthropic or any OpenAI-compatible service. Keys are encrypted with
                Windows&rsquo; own keychain and never shown again.
              </p>
              <h3 className="p-h3 f-models__h">It remembers what you tell it</h3>
              <p className="muted">
                Personal Memory lists what the Assistant has learned about you. Fix anything, hide it, or
                delete it.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="p-sec p-sec--auto f-area f-close" aria-labelledby="fclose-h">
        <div className="wrap">
          <h2 id="fclose-h" className="p-h2">
            Try every widget on your own board
          </h2>
          <p className="muted p-close__line">Free for Windows 10 and 11. The welcome guide sets up your first pages.</p>
          <div className="p-hero__ctas">
            <Link href="/download" className="btn btn--primary btn--lg">
              Download for Windows
            </Link>
            <Link href="/marketplace" className="btn btn--lg">
              Browse more widgets
            </Link>
          </div>
        </div>
      </section>

      <Moments />
    </>
  );
}
