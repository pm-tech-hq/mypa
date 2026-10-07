import Image from "next/image";
import Link from "next/link";

import { ArrowRight, Lock, ShieldCheck, WifiOff } from "lucide-react";

import { CATEGORY_LABEL, WIDGET_CATEGORIES, type WidgetCategory } from "@repo/widget-sdk";

import { Seal } from "@/components/icons";
import { WidgetCard } from "@/components/WidgetCard";
import { listListed } from "@/lib/data";

import board from "../public/board.png";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: PageProps<"/">) {
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
      <section className="hero">
        <div className="wrap hero__grid">
          <div>
            <h1 className="hero__title">
              Make your board <em>do more.</em>
            </h1>
            <p className="hero__lede">
              Widgets for myPA, built by people who use it. Every one runs in a sandbox, asks
              before it touches your data, and wears a checkmark when we know who made it.
            </p>
            <div className="hero__ctas">
              <Link href="#widgets" className="btn btn--primary btn--lg">
                Browse widgets
              </Link>
              <Link href="/developers" className="btn btn--lg">
                Build one
                <ArrowRight size={16} aria-hidden />
              </Link>
            </div>
            <ul className="hero__proof">
              <li>
                <ShieldCheck size={15} aria-hidden />
                Sandboxed by default
              </li>
              <li>
                <Lock size={15} aria-hidden />
                Signed downloads
              </li>
              <li>
                <WifiOff size={15} aria-hidden />
                Works offline once installed
              </li>
            </ul>
          </div>
          <figure className="shot" aria-label="A myPA board running marketplace widgets">
            <Image
              src={board}
              alt="A myPA board with the Focus timer, Habits, Weather and World clock widgets"
              priority
              sizes="(max-width: 920px) 100vw, 620px"
              placeholder="blur"
            />
          </figure>
        </div>
      </section>

      {featured.length > 0 && !active && (
        <section className="section">
          <div className="wrap">
            <div className="section__head">
              <h2 className="h2">Featured</h2>
            </div>
            <div className="feature-grid">
              {featured.map((w) => (
                <WidgetCard key={w.id} w={w} feature />
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="section" id="widgets">
        <div className="wrap">
          <div className="section__head">
            <div>
              <h2 className="h2">{active ? CATEGORY_LABEL[active] : "Every widget"}</h2>
              <p className="lede">
                Install from the Marketplace inside myPA: Add widget, then Browse the marketplace.
              </p>
            </div>
          </div>
          {categories.length > 1 && (
            <nav className="cats" aria-label="Categories">
              <Link href="/#widgets" className="cat" aria-current={active ? undefined : "page"}>
                All
              </Link>
              {categories.map((c) => (
                <Link
                  key={c}
                  href={`/?category=${c}#widgets`}
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
              <h2>The shelves are being stocked</h2>
              <p>Be the first: build a widget and publish it here.</p>
              <Link href="/developers" className="btn btn--primary">
                Start building
              </Link>
            </div>
          )}
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <div className="section__head">
            <div>
              <h2 className="h2">Know who made it</h2>
              <p className="lede">
                The same marks appear here and inside myPA. They come from our signature on the
                catalog, so they can't be copied onto a widget we haven't checked.
              </p>
            </div>
          </div>
          <div className="trust-row">
            <div>
              <span className="trust-label trust-label--official">
                <Seal trust="official" size={18} />
                Official
              </span>
              <p>Made and maintained by myPA.</p>
            </div>
            <div>
              <span className="trust-label trust-label--verified">
                <Seal trust="verified" size={18} />
                Verified publisher
              </span>
              <p>We confirmed who's behind it. Their updates go live without waiting in review.</p>
            </div>
            <div>
              <span className="trust-label trust-label--community">Community</span>
              <p>Reviewed before listing, identity not yet checked. Still sandboxed like the rest.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="band">
        <div className="wrap band__grid">
          <div>
            <h2 className="h2">Build it once. Put it on every board.</h2>
            <p className="lede">
              A widget is plain HTML, CSS and JavaScript with a small SDK. Publish it free, or set
              a price and get paid through Stripe. We handle checkout and license keys.
            </p>
            <ol className="steps">
              <li>
                <span className="steps__n num">1</span>
                <span>
                  <b>Scaffold</b> from the template and load it in myPA. It reloads as you save.
                </span>
              </li>
              <li>
                <span className="steps__n num">2</span>
                <span>
                  <b>Pack</b> it into one .mypawidget file.
                </span>
              </li>
              <li>
                <span className="steps__n num">3</span>
                <span>
                  <b>Upload</b> it here. Once it's approved it's in every myPA's Marketplace.
                </span>
              </li>
            </ol>
            <Link href="/developers" className="btn btn--primary btn--lg">
              Read the guide
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
