import type { Metadata } from "next";
import Link from "next/link";

import { Markdown } from "@/components/Markdown";
import { allReleases, releaseDate } from "@/lib/release";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Changelog",
  description: "What changed in each version of myPA, newest first.",
};

export default async function Changelog() {
  const releases = await allReleases();
  return (
    <>
      <header className="page-head">
        <div className="wrap">
          <h1 className="p-h1">myPA changelog</h1>
          <p className="page-head__lead">
            What changed in each version, newest first. Installed copies update themselves; new
            installs start from the <Link href="/download" className="link">download page</Link>.
          </p>
        </div>
      </header>
      <section className="p-sec p-sec--auto dl-last" aria-label="Releases">
        <div className="wrap">
          <ol className="log">
            {releases.map((r, i) => (
              <li key={r.version} className="log__item" id={`v${r.version}`}>
                <div className="log__meta">
                  <h2 className="log__v">
                    {r.version}
                    {i === 0 && <span className="log__latest">Latest</span>}
                  </h2>
                  <p className="muted">{releaseDate(r.date)}</p>
                </div>
                <div className="prose log__notes">
                  {r.notes ? (
                    <Markdown source={r.notes} skipFirstHeading />
                  ) : (
                    <p>The first public release of myPA.</p>
                  )}
                  <p className="meta">
                    <a href={r.url} rel="noopener">
                      Release {r.version} on GitHub
                    </a>
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </>
  );
}
