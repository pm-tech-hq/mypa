import type { Metadata } from "next";
import Link from "next/link";

import { Download, ShieldAlert } from "lucide-react";

import { latestRelease, megabytes, releaseDate, REPO_URL } from "@/lib/release";
import { JsonLd, pageMeta, softwareLd } from "@/lib/seo";

export const revalidate = 3600;

export const metadata: Metadata = pageMeta({
  title: "Download myPA for Windows (free)",
  description:
    "Download the free myPA installer for Windows 10 and 11. Install steps, what to do when SmartScreen warns you, and what your PC needs.",
  path: "/download",
});

export default async function DownloadPage() {
  const rel = await latestRelease();
  const size = megabytes(rel.size);
  return (
    <>
      <JsonLd data={softwareLd(rel)} />
      <section className="p-sec dl-hero" aria-labelledby="dl-h">
        <div className="wrap dl-hero__grid">
          <div>
            <h1 id="dl-h" className="p-h1">
              Download myPA for Windows
            </h1>
            <p className="page-head__lead">
              A personal assistant that runs on your own computer. Free for 64-bit Windows 10 and
              11{size ? `, a ${size} download` : ""}. Version {rel.version}, released{" "}
              {releaseDate(rel.date)}.
            </p>
            <div className="p-hero__ctas">
              <a href={rel.installer} className="btn btn--primary btn--lg">
                <Download size={18} aria-hidden />
                Download myPA {rel.version}
              </a>
              <Link href="/changelog" className="btn btn--lg">
                See what&rsquo;s new
              </Link>
            </div>
            <p className="dl-note muted">
              Not on Windows? myPA builds on macOS and Linux from{" "}
              <a href={REPO_URL} className="link" rel="noopener">
                the source on GitHub
              </a>
              , but those builds aren&rsquo;t tested yet.
            </p>
          </div>
          <div className="dl-warn" aria-hidden>
            <div className="dl-warn__win">
              <p className="dl-warn__title">Windows protected your PC</p>
              <p className="dl-warn__text">
                Microsoft Defender SmartScreen prevented an unrecognised app from starting.
              </p>
              <p className="dl-warn__more">More info</p>
              <p className="dl-warn__app">
                App: myPA-Setup-{rel.version}.exe
                <br />
                Publisher: Unknown publisher
              </p>
              <div className="dl-warn__btns">
                <span className="dl-warn__run">Run anyway</span>
                <span className="dl-warn__no">Don&rsquo;t run</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="p-sec p-sec--auto f-area" aria-labelledby="steps-h">
        <div className="wrap p-split">
          <div className="p-split__text">
            <h2 id="steps-h" className="p-h2">
              Installing takes about a minute
            </h2>
            <p className="p-head__line">
              The installer isn&rsquo;t code-signed yet, so Windows doesn&rsquo;t recognise it the first
              time. That is the blue screen on the right.
            </p>
          </div>
          <ol className="steps-list">
            <li>
              <b>Open the file you downloaded.</b> It is called myPA-Setup-{rel.version}.exe.
            </li>
            <li>
              <b>If Windows says it protected your PC,</b> choose More info, then Run anyway.
            </li>
            <li>
              <b>Choose where to install it,</b> or keep the suggested folder. myPA adds a desktop and
              Start menu shortcut.
            </li>
            <li>
              <b>Follow the welcome guide.</b> Tell myPA what you want help with, and it sets up your
              first pages.
            </li>
          </ol>
        </div>
      </section>

      <section className="p-sec p-sec--auto f-area" aria-labelledby="sac-h">
        <div className="wrap p-split">
          <div className="p-split__text">
            <h2 id="sac-h" className="p-h2">
              If Windows blocks it completely
            </h2>
          </div>
          <div className="dl-sac">
            <ShieldAlert size={22} aria-hidden />
            <div className="prose">
              <p>
                Some computers have <strong>Smart App Control</strong> turned on. It runs only apps that
                are signed or that Windows already trusts, and it shows no Run anyway button. Until
                myPA&rsquo;s installer is signed, it may refuse to install it, or refuse an update.
              </p>
              <p>
                You can see the setting in Windows Security, under App &amp; browser control. Turning it
                off is a choice for you to make: Windows can&rsquo;t turn it back on without a reset.
                Signed installers are on the way.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="p-sec p-sec--auto f-area dl-last" aria-labelledby="req-h">
        <div className="wrap p-split">
          <div className="p-split__text">
            <h2 id="req-h" className="p-h2">
              What you need
            </h2>
            <p className="p-head__line">
              After it is installed, myPA updates itself. It checks every four hours and installs the
              new version when you restart it.
            </p>
          </div>
          <dl className="rows">
            <div className="rows__row">
              <dt>Windows</dt>
              <dd>Windows 10 or 11, 64-bit.</dd>
            </div>
            <div className="rows__row">
              <dt>Disk space</dt>
              <dd>
                About 1.3 GB for the app. The built-in AI models are optional, from 750 MB to 2.7 GB each.
              </dd>
            </div>
            <div className="rows__row">
              <dt>Internet</dt>
              <dd>Only to download, update, and use the accounts you connect.</dd>
            </div>
            <div className="rows__row">
              <dt>An account</dt>
              <dd>None. myPA works without signing up for anything.</dd>
            </div>
          </dl>
        </div>
      </section>
    </>
  );
}
