import Link from "next/link";

import { signOut, viewer } from "@/lib/auth";
import { ISSUES_URL, latestRelease, REPO_URL } from "@/lib/release";

import { BrandMark } from "./BrandMark";
import { SiteNav } from "./SiteNav";

export async function SiteHeader() {
  const [me, newest] = await Promise.all([viewer(), latestRelease()]);
  const account = me ? (
    <>
      {me.isAdmin && (
        <Link href="/admin" className="nav__link nav__link--quiet">
          Review
        </Link>
      )}
      <Link href="/dashboard" className="nav__link nav__link--quiet">
        Dashboard
      </Link>
      <form
        action={async () => {
          "use server";
          await signOut({ redirectTo: "/" });
        }}
      >
        <button type="submit" className="user-chip" title="Sign out">
          {me.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={me.image} alt="" className="avatar" width={28} height={28} />
          ) : null}
          <span className="sr-only">Sign out </span>
          {me.login}
        </button>
      </form>
    </>
  ) : undefined;
  return <SiteNav account={account} newest={{ version: newest.version }} />;
}

const COLUMNS: { title: string; links: { href: string; label: string; external?: boolean }[] }[] = [
  {
    title: "Product",
    links: [
      { href: "/features", label: "Features" },
      { href: "/download", label: "Download" },
      { href: "/changelog", label: "Changelog" },
    ],
  },
  {
    title: "Widgets",
    links: [
      { href: "/marketplace", label: "Marketplace" },
      { href: "/developers", label: "Build a widget" },
      { href: "/dashboard", label: "Publisher dashboard" },
    ],
  },
  {
    title: "Help",
    links: [
      { href: "/help", label: "Questions" },
      { href: "/privacy", label: "Privacy" },
      { href: "/terms", label: "Terms" },
    ],
  },
  {
    title: "Project",
    links: [
      { href: REPO_URL, label: "Source on GitHub", external: true },
      { href: ISSUES_URL, label: "Report a problem", external: true },
      { href: "/registry.json", label: "Widget registry" },
    ],
  },
];

export function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="foot">
      <div className="wrap">
        <div className="foot__grid">
          <div className="foot__brand">
            <Link href="/" className="nav__logo" aria-label="myPA home">
              <BrandMark size={26} />
              <span>myPA</span>
            </Link>
            <p className="foot__lede">A personal assistant that runs on your own computer.</p>
          </div>
          {COLUMNS.map((c) => (
            <nav key={c.title} className="foot__col" aria-label={c.title}>
              <p className="foot__title">{c.title}</p>
              <ul>
                {c.links.map((l) => (
                  <li key={l.label}>
                    {l.external ? (
                      <a href={l.href} className="foot__link" rel="noopener">
                        {l.label}
                      </a>
                    ) : (
                      <Link href={l.href} className="foot__link">
                        {l.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <div className="foot__legal">
          <span>© {year} myPA. Free and open source under the AGPL-3.0.</span>
          <span>Product names and logos are trademarks of their owners.</span>
        </div>
      </div>
    </footer>
  );
}
