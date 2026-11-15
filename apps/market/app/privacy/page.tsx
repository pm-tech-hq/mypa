import type { Metadata } from "next";
import Link from "next/link";

import { ISSUES_URL, REPO_URL } from "@/lib/release";
import { pageMeta } from "@/lib/seo";

export const metadata: Metadata = pageMeta({
  title: "Privacy policy",
  description:
    "What the myPA app and my-pa.xyz collect, where it goes, and how Google, calendar and email data is handled. The app keeps your data on your PC.",
  path: "/privacy",
});

export default function Privacy() {
  return (
    <>
      <header className="page-head">
        <div className="wrap">
          <h1 className="p-h1">Privacy policy</h1>
          <p className="page-head__lead">
            myPA is a personal assistant that runs on your own computer. Your data stays there, and
            the app sends nothing to us.
            The website stores only what publishers and buyers need.
          </p>
        </div>
      </header>
      <section className="p-sec p-sec--auto" aria-label="Policy">
        <div className="wrap">
          <div className="prose">
            <p className="meta">Last updated 15 November 2026.</p>

            <h2>Who this covers</h2>
            <p>
              This policy covers the myPA desktop app and the website at my-pa.xyz, including the widget
              Marketplace. myPA is an open-source project; you can read every line of the code that does
              what this page describes <a href={REPO_URL}>on GitHub</a>.
            </p>

            <h2>The desktop app</h2>
            <p>
              <strong>Your data stays on your computer.</strong> Pages, widgets, tasks, notes, journal
              entries, expenses, transcripts and settings are saved in one file,{" "}
              <code>%APPDATA%\mypa\mypa.db</code>, with a backup beside it. myPA has no account, no
              analytics, no advertising and no crash reporting. We can&rsquo;t see your data.
            </p>
            <p>The app goes online only for these things:</p>
            <ul>
              <li>
                <strong>Updates.</strong> It asks GitHub for the newest release every few hours and
                downloads it from there.
              </li>
              <li>
                <strong>The widget catalog.</strong> It reads the signed list of widgets from my-pa.xyz
                and downloads the widgets you install.
              </li>
              <li>
                <strong>AI and speech models.</strong> When you choose a built-in model or voice, it is
                downloaded once from Hugging Face. After that it runs on your computer.
              </li>
              <li>
                <strong>Accounts you connect.</strong> Calendars and inboxes talk only to their own
                provider: Google, Microsoft, Zoho, iCloud, Fastmail, or the CalDAV or IMAP server you
                enter. Passwords, app passwords and sign-in tokens are encrypted with Windows&rsquo;
                keychain.
              </li>
              <li>
                <strong>An AI service of your own.</strong> If you add an OpenAI, Anthropic or other key,
                the text you ask about is sent to that service under its own terms. With the built-in
                model nothing leaves your computer.
              </li>
              <li>
                <strong>Voices.</strong> If you pick an OpenAI or ElevenLabs voice, the text being read
                aloud goes to that service, with your own key.
              </li>
              <li>
                <strong>Links you transcribe.</strong> A web page or media link is fetched from where it
                lives.
              </li>
              <li>
                <strong>Marketplace widgets.</strong> A widget reaches only the websites it lists and you
                approve when you install it, such as a weather service.
              </li>
            </ul>

            <h2>Google user data</h2>
            <p>
              If you connect a Google account, myPA asks for your email address, access to Google
              Calendar (to show, add and change events) and, if you add Gmail, access to your mailbox (to
              read, sort, archive and send mail when you tell it to). This data is fetched by the app on
              your computer, shown to you there and cached in your local database. It is never sent to
              myPA&rsquo;s servers, sold, used for advertising, or used to train AI models.
            </p>
            <p>
              If you ask an AI feature about an email or event and you have chosen your own AI service,
              that content goes to that service only to answer you. With the built-in model it stays on
              your computer. You can disconnect a Google account in the app at any time, which deletes its
              tokens and cached data, and you can revoke access in your Google Account settings.
            </p>
            <p>
              myPA&rsquo;s use and transfer of information received from Google APIs adheres to the{" "}
              <a href="https://developers.google.com/terms/api-services-user-data-policy">
                Google API Services User Data Policy
              </a>
              , including the Limited Use requirements.
            </p>

            <h2>The website</h2>
            <p>
              Browsing my-pa.xyz needs no account and sets no tracking cookies. The site is hosted by
              Vercel, which keeps standard server logs, such as IP addresses and requested pages, to run
              and protect the service.
            </p>
            <h3>Publishers</h3>
            <p>
              If you sign in to publish widgets, we receive your GitHub ID, username, name, email address
              and profile picture from GitHub, and store them with your widgets. A session cookie keeps
              you signed in. Widget files are stored with Vercel Blob; records are kept in a Neon Postgres
              database. To be paid, you connect a Stripe account; Stripe holds your payout details, not
              us.
            </p>
            <h3>Buyers</h3>
            <p>
              Paid widgets are bought through Stripe Checkout. Stripe handles your card. We keep your
              email address, what you bought, the amount and your licence key, so we can send the key and
              help if it goes missing.
            </p>

            <h2>Keeping and deleting data</h2>
            <p>
              App data is yours: delete <code>mypa.db</code> and it is gone. Website records are kept
              while your publisher account or licence is in use. To have them deleted, open an issue or
              contact us through{" "}
              <a href={ISSUES_URL}>GitHub</a>, and we will remove them unless the law requires us to keep
              a payment record.
            </p>

            <h2>Children</h2>
            <p>myPA is not directed at children under 13, and the website does not knowingly collect their data.</p>

            <h2>Changes</h2>
            <p>
              If this policy changes, the date at the top changes too, and the{" "}
              <Link href="/changelog">changelog</Link> mentions changes that affect the app.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
