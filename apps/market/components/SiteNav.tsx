"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { BrandMark } from "./BrandMark";

interface MenuLink {
  href: string;
  name: string;
  line: string;
}
interface MenuColumn {
  title: string;
  links: MenuLink[];
}
interface Item {
  label: string;
  href: string;
  columns?: MenuColumn[];
}

const ITEMS: Item[] = [
  {
    label: "Product",
    href: "/features",
    columns: [
      {
        title: "Plan your day",
        links: [
          { href: "/features#work", name: "Daily Planner", line: "Time blocks around meetings" },
          { href: "/features#work", name: "To-do and projects", line: "Today, backlog and goals" },
          { href: "/features#work", name: "Calendar and email", line: "Every account in one place" },
        ],
      },
      {
        title: "Learn and keep",
        links: [
          { href: "/features#study", name: "Transcribe and Tutor", line: "Lessons from your own notes" },
          { href: "/features#study", name: "Flashcards", line: "Spaced repetition, built in" },
          { href: "/features#home", name: "Journal and money", line: "Private pages, monthly budgets" },
        ],
      },
      {
        title: "The Assistant",
        links: [
          { href: "/features#assistant", name: "Assistant", line: "Works across every widget" },
          { href: "/features#assistant", name: "Built-in AI", line: "Runs on your own computer" },
          { href: "/features#assistant", name: "Quick Capture", line: "Ctrl+Shift+Space, from any app" },
        ],
      },
    ],
  },
  { label: "Widgets", href: "/marketplace" },
  { label: "Developers", href: "/developers" },
  {
    label: "Help",
    href: "/help",
    columns: [
      {
        title: "Using myPA",
        links: [
          { href: "/help", name: "Questions", line: "Install, updates, your data" },
          { href: "/changelog", name: "Changelog", line: "What changed in each version" },
        ],
      },
      {
        title: "Policies",
        links: [
          { href: "/privacy", name: "Privacy", line: "What leaves your computer" },
          { href: "/terms", name: "Terms", line: "Licences and the Marketplace" },
        ],
      },
    ],
  },
];

export function SiteNav({ account, newest }: { account?: ReactNode; newest: { version: string } }) {
  const path = usePathname();
  const [open, setOpen] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  // a new page closes every menu
  useEffect(() => {
    setOpen(null);
    setSheet(false);
  }, [path]);

  useEffect(() => {
    if (!open && !sheet) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(null);
        setSheet(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, sheet]);

  useEffect(() => {
    document.documentElement.classList.toggle("has-sheet", sheet);
  }, [sheet]);

  const intend = (label: string | null) => {
    window.clearTimeout(timer.current);
    // a menu opens after a short intent; with one open the next swaps at once
    timer.current = window.setTimeout(() => setOpen(label), open && label ? 0 : label ? 150 : 120);
  };

  const current = (href: string) =>
    href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`);

  const card = {
    href: "/download",
    title: "Download myPA",
    line: "Free for Windows 10 and 11",
  };

  return (
    <header className="nav" onPointerLeave={() => intend(null)}>
      <div className="wrap nav__bar">
        <Link href="/" className="nav__logo" aria-label="myPA home">
          <BrandMark size={26} />
          <span>myPA</span>
        </Link>
        <nav className="nav__links" aria-label="Main">
          {ITEMS.map((it) =>
            it.columns ? (
              <div key={it.label} className="nav__item" onPointerEnter={() => intend(it.label)}>
                <button
                  type="button"
                  className="nav__link"
                  aria-expanded={open === it.label}
                  aria-controls={`menu-${it.label}`}
                  aria-current={current(it.href) ? "page" : undefined}
                  onClick={() => setOpen(open === it.label ? null : it.label)}
                >
                  {it.label}
                  <svg className="nav__chev" width="10" height="10" viewBox="0 0 10 10" aria-hidden>
                    <path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
                  </svg>
                </button>
                <div
                  id={`menu-${it.label}`}
                  className="nav__menu"
                  data-open={open === it.label || undefined}
                  hidden={open !== it.label}
                >
                  <div className="wrap nav__menu-grid">
                    {it.columns.map((col) => (
                      <div key={col.title} className="nav__col">
                        <p className="nav__col-title">{col.title}</p>
                        <ul>
                          {col.links.map((l) => (
                            <li key={l.name}>
                              <Link href={l.href} className="nav__menu-link">
                                <span>{l.name}</span>
                                <span className="muted">{l.line}</span>
                              </Link>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                    {it.label === "Product" && (
                      <Link href={card.href} className="nav__card">
                        <span className="nav__card-art" aria-hidden>
                          <span className="nav__card-toast">
                            <i />
                            Stand-up starts in 5 minutes
                          </span>
                        </span>
                        <span className="nav__card-title">{card.title}</span>
                        <span className="muted">{card.line}</span>
                      </Link>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <Link
                key={it.label}
                href={it.href}
                className="nav__link"
                aria-current={current(it.href) ? "page" : undefined}
                onPointerEnter={() => intend(null)}
              >
                {it.label}
              </Link>
            ),
          )}
        </nav>
        <div className="nav__actions">
          {account}
          <Link href="/download" className="btn btn--primary nav__cta">
            Download for Windows
          </Link>
          <button
            type="button"
            className="btn nav__toggle"
            aria-expanded={sheet}
            aria-controls="nav-sheet"
            aria-label={sheet ? "Close the menu" : "Open the menu"}
            onClick={() => setSheet((s) => !s)}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
              {sheet ? (
                <path d="M4 4l10 10M14 4 4 14" stroke="currentColor" strokeWidth="1.6" />
              ) : (
                <path d="M3 6h12M3 12h12" stroke="currentColor" strokeWidth="1.6" />
              )}
            </svg>
          </button>
        </div>
      </div>

      <div id="nav-sheet" className="nav__sheet" hidden={!sheet}>
        <div className="wrap">
          <ul className="nav__sheet-list">
            <li>
              <Link href="/features">Features</Link>
            </li>
            <li>
              <Link href="/marketplace">Widgets</Link>
            </li>
            <li>
              <Link href="/developers">Developers</Link>
            </li>
            <li>
              <Link href="/help">Help</Link>
            </li>
            <li>
              <Link href="/changelog">Changelog</Link>
            </li>
          </ul>
          <Link href="/download" className="btn btn--primary btn--lg nav__sheet-cta">
            Download for Windows
          </Link>
        </div>
      </div>
    </header>
  );
}
