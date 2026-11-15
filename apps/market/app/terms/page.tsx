import type { Metadata } from "next";
import Link from "next/link";

import { ISSUES_URL, REPO_URL } from "@/lib/release";

export const metadata: Metadata = {
  title: "Terms",
  description: "The licences myPA is released under, and the rules for the widget Marketplace.",
};

export default function Terms() {
  return (
    <>
      <header className="page-head">
        <div className="wrap">
          <h1 className="p-h1">Terms of use</h1>
          <p className="page-head__lead">
            myPA is free, open-source software. These terms cover using the app, this website and the
            widget Marketplace.
          </p>
        </div>
      </header>
      <section className="p-sec p-sec--auto" aria-label="Terms">
        <div className="wrap">
          <div className="prose">
            <p className="meta">Last updated 15 November 2026.</p>

            <h2>The software and its licences</h2>
            <p>
              The myPA app, this website, the design system and the official widgets are released under
              the <a href={`${REPO_URL}/blob/main/LICENSE`}>GNU AGPL-3.0</a>. You may use, study, change
              and share them. If you distribute a changed version, or run one as a network service, you
              must publish your changes under the same licence.
            </p>
            <p>
              The widget SDK, its command-line tool and starter template are released under the MIT
              licence, so widgets you build can be licensed however you like: open or closed, free or
              paid.
            </p>

            <h2>No warranty</h2>
            <p>
              myPA is provided as it is, without warranty of any kind, as the licences say. It is early
              software and things will change. Keep a copy of your data file if it matters to you; the{" "}
              <Link href="/help#data">help page</Link> says how.
            </p>

            <h2>Accounts and services you connect</h2>
            <p>
              When you connect a calendar, an inbox or an AI service, your use of it stays under that
              provider&rsquo;s own terms. myPA acts on your instructions and never sends email for you.
              You are responsible for what you ask it to change.
            </p>

            <h2>The Marketplace</h2>
            <h3>Installing widgets</h3>
            <p>
              Widgets marked Official are made by myPA. All other widgets are made by their publishers,
              who are responsible for them. Every widget runs in a sandbox with only the permissions you
              approve, and we review widgets before they are listed, but we can&rsquo;t promise any
              third-party widget is free of faults.
            </p>
            <h3>Buying widgets</h3>
            <p>
              Some widgets are paid. Payment is processed by Stripe, and a licence key is issued when it
              succeeds. If a key doesn&rsquo;t arrive or stops working,{" "}
              <a href={ISSUES_URL}>tell us on GitHub</a> and we will help.
            </p>
            <h3>Publishing widgets</h3>
            <p>
              To publish, you sign in with GitHub. You must own or have the right to publish what you
              upload, describe its permissions truthfully, and not upload anything harmful or unlawful.
              Paid widgets are paid out through Stripe Connect, less Stripe&rsquo;s fees and the
              Marketplace fee shown in your dashboard. We may refuse, remove or unlist a widget that
              breaks these rules.
            </p>

            <h2>The name and logo</h2>
            <p>
              The licences cover the code, not the brand. &ldquo;myPA&rdquo;, its logo and the Official
              mark identify this project. You are welcome to fork it; please give your fork a different
              name and icon.
            </p>

            <h2>Changes and contact</h2>
            <p>
              We may update these terms; the date at the top shows the latest version. Questions go to{" "}
              <a href={ISSUES_URL}>GitHub issues</a>.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
