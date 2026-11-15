import type { Metadata } from "next";
import Link from "next/link";

import { CATEGORY_LABEL, WIDGET_CATEGORIES, type WidgetCategory } from "@repo/widget-sdk";

import { Seal } from "@/components/icons";
import { WidgetCard } from "@/components/WidgetCard";
import { listListed } from "@/lib/data";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Marketplace: widgets for your board",
  description:
    "Timers, habits, weather and more for your myPA board. Every widget runs in a sandbox, and a checkmark shows who stands behind it.",
};

export default async function Marketplace({ searchParams }: PageProps<"/marketplace">) {
  const { category } = await searchParams;
  const active = WIDGET_CATEGORIES.includes(category as WidgetCategory)
    ? (category as WidgetCategory)
    : null;
  const widgets = await listListed().catch(() => []);
  const byPopularity = [...widgets].sort((a, b) => b.downloads - a.downloads);
  const featured = byPopularity.filter((w) => w.featured).slice(0, 3);
  const shown = active ? byPopularity.filter((w) => w.manifest.category === active) : byPopularity;
  const categories = WIDGET_CATEGORIES.filter((c) => widgets.some((w) => w.manifest.category === c));

  return (
    <>
      <header className="page-head">
        <div className="wrap">
          <h1 className="p-h1">Widgets for your myPA board</h1>
          <p className="page-head__lead">
            Built by myPA and by people who use it. Every widget runs in a sandbox and asks before it
            touches your data. Install them inside myPA: Add widget, then Browse the marketplace.
          </p>
        </div>
      </header>

      {featured.length > 0 && !active && (
        <section className="p-sec p-sec--auto mk-sec">
          <div className="wrap">
            <h2 className="p-h2 mk-h2">Featured</h2>
            <div className="feature-grid">
              {featured.map((w) => (
                <WidgetCard key={w.id} w={w} feature />
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="p-sec p-sec--auto mk-sec" id="widgets">
        <div className="wrap">
          <h2 className="p-h2 mk-h2">{active ? CATEGORY_LABEL[active] : "Every widget"}</h2>
          {categories.length > 1 && (
            <nav className="cats" aria-label="Categories">
              <Link href="/marketplace#widgets" className="cat" aria-current={active ? undefined : "page"}>
                All
              </Link>
              {categories.map((c) => (
                <Link
                  key={c}
                  href={`/marketplace?category=${c}#widgets`}
                  className="cat"
                  aria-current={active === c ? "page" : undefined}
                >
                  {CATEGORY_LABEL[c]}
                </Link>
              ))}
            </nav>
          )}
          {shown.length ? (
            <div className="grid">
              {shown.map((w) => (
                <WidgetCard key={w.id} w={w} />
              ))}
            </div>
          ) : (
            <div className="empty">
              <h2>No widgets here yet</h2>
              <p>Be the first: build a widget and publish it here.</p>
              <Link href="/developers" className="btn btn--primary">
                Start building
              </Link>
            </div>
          )}
        </div>
      </section>

      <section className="p-sec p-sec--auto mk-sec">
        <div className="wrap p-split">
          <div className="p-split__text">
            <h2 className="p-h2">Three marks that show who made it</h2>
            <p className="p-head__line">
              The same marks appear here and inside myPA. They come from our signature on the catalog,
              so nobody can copy them onto a widget we haven&rsquo;t checked.
            </p>
          </div>
          <dl className="rows">
            <div className="rows__row">
              <dt>
                <span className="trust-label trust-label--official">
                  <Seal trust="official" size={18} />
                  Official
                </span>
              </dt>
              <dd>Made and maintained by myPA.</dd>
            </div>
            <div className="rows__row">
              <dt>
                <span className="trust-label trust-label--verified">
                  <Seal trust="verified" size={18} />
                  Verified publisher
                </span>
              </dt>
              <dd>We confirmed who is behind it. Their updates go live without waiting in review.</dd>
            </div>
            <div className="rows__row">
              <dt>
                <span className="trust-label trust-label--community">Community</span>
              </dt>
              <dd>Reviewed before listing, identity not yet checked. Sandboxed like the rest.</dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="p-sec p-sec--auto mk-sec mk-build">
        <div className="wrap p-split">
          <div className="p-split__text">
            <h2 className="p-h2">Build a widget once, put it on every board</h2>
            <p className="p-head__line">
              A widget is plain HTML, CSS and JavaScript with a small SDK. Publish it free, or set a
              price and get paid through Stripe. We handle checkout and licence keys.
            </p>
            <Link href="/developers" className="btn btn--primary btn--lg">
              Read the developer guide
            </Link>
          </div>
          <div className="terminal" aria-label="Example terminal session">
            <div className="terminal__bar" aria-hidden>
              <i />
              <i />
              <i />
            </div>
            <pre>
              <span className="c"># start from the template</span>
              {"\n"}mypa-widget init focus-sounds --id you.focus-sounds
              {"\n"}
              <span className="ok">{"✔"} Created focus-sounds</span>
              {"\n\n"}
              <span className="c"># bundle it for the marketplace</span>
              {"\n"}mypa-widget pack focus-sounds
              {"\n"}
              <span className="ok">{"✔"} Packed you.focus-sounds-1.0.0.mypawidget</span>
            </pre>
          </div>
        </div>
      </section>
    </>
  );
}
