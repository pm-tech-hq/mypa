import type { Metadata } from "next";
import Link from "next/link";

import { PERMISSIONS, WIDGET_CATEGORIES, WIDGET_ICON_KEYS, describePermission } from "@repo/widget-sdk";

import { Seal } from "@/components/icons";
import { platformFeePercent } from "@/lib/stripe";

export const metadata: Metadata = {
  title: "Build a widget",
  description: "Build widgets for myPA with plain HTML, CSS and JavaScript, then publish or sell them here.",
};

function Code({ children }: { children: string }) {
  return (
    <div className="terminal" style={{ margin: "14px 0 22px" }}>
      <pre>{children}</pre>
    </div>
  );
}

const MANIFEST = `{
  "schema": 1,
  "id": "you.focus-sounds",
  "name": "Focus sounds",
  "version": "1.0.0",
  "summary": "Rain, cafe and brown noise to work to.",
  "publisher": { "id": "you", "name": "Your name" },
  "icon": "music",
  "category": "focus",
  "entry": "index.html",
  "size": { "w": 320, "h": 240 },
  "permissions": [],
  "settings": [
    { "key": "volume", "label": "Volume", "type": "number", "default": 60, "min": 0, "max": 100 }
  ]
}`;

const SDK = `<link rel="stylesheet" href="/__mypa/theme.css" />
<script src="/__mypa/sdk.js"></script>
<script>
  mypa.ready.then(async ({ settings }) => {
    const plays = (await mypa.storage.get("plays")) ?? 0;
    await mypa.storage.set("plays", plays + 1);
  });
  mypa.onSettings((s) => setVolume(s.volume));
</script>`;

export default function Developers() {
  const fee = platformFeePercent();
  return (
    <div className="wrap" style={{ maxWidth: 860, paddingBottom: 96 }}>
      <header className="page-head">
        <h1>Build a widget</h1>
        <p className="lede">
          A widget is a folder of plain web files with a manifest. myPA runs it in a sandbox and
          hands it a small API. Any framework works, as long as it builds to static files.
        </p>
      </header>

      <div className="prose">
        <h2 className="h3" style={{ margin: "12px 0 8px" }}>
          1. Start from the template
        </h2>
        <p>
          The <code>mypa-widget</code> tool lives in the myPA repo at{" "}
          <code>packages/widget-sdk</code> and runs on Node 24 with no install step.
        </p>
        <Code>{`node packages/widget-sdk/bin/mypa-widget.ts init focus-sounds --id you.focus-sounds`}</Code>
        <p>
          In myPA, open Add widget, Browse the marketplace, Developer, then Load unpacked folder.
          Your widget reloads every time you save.
        </p>

        <h2 className="h3" style={{ margin: "28px 0 8px" }}>
          2. Describe it in manifest.json
        </h2>
        <Code>{MANIFEST}</Code>
        <p>
          The <code>id</code> must start with your publisher ID. <code>icon</code> is one of{" "}
          {WIDGET_ICON_KEYS.join(", ")}. <code>category</code> is one of{" "}
          {WIDGET_CATEGORIES.join(", ")}. Settings become a form in the widget&apos;s gear panel.
        </p>

        <h2 className="h3" style={{ margin: "28px 0 8px" }}>
          3. Talk to myPA through the SDK
        </h2>
        <Code>{SDK}</Code>
        <p>
          <code>theme.css</code> gives you myPA&apos;s colours, Poppins and ready-made{" "}
          <code>.btn</code> and <code>.field</code> styles, so your widget looks at home. Storage is
          private to each copy of your widget on a board.
        </p>

        <h2 className="h3" style={{ margin: "28px 0 8px" }}>
          4. Ask only for what you need
        </h2>
        <p>Widgets can&apos;t reach the network or your data directly. Declare what you need:</p>
        <ul className="perms" style={{ margin: "10px 0 22px" }}>
          {Object.keys(PERMISSIONS).map((p) => (
            <li key={p}>
              <code style={{ minWidth: 120 }}>{p}</code>
              {describePermission(p as keyof typeof PERMISSIONS)}
            </li>
          ))}
          <li>
            <code style={{ minWidth: 120 }}>net:api.example.com</code>
            Call that host over https with <code>mypa.fetch</code>
          </li>
        </ul>

        <h2 className="h3" style={{ margin: "28px 0 8px" }}>
          5. Pack, upload, get paid
        </h2>
        <Code>{`mypa-widget pack focus-sounds
✔ Packed you.focus-sounds-1.0.0.mypawidget`}</Code>
        <p>
          Sign in, create your publisher profile and drop the file on your dashboard. We review
          new publishers&apos; widgets before they&apos;re listed; verified publishers go live
          immediately. To sell, set a price and connect Stripe. Buyers get a license key the
          moment they pay, and you keep {100 - fee}% of every sale.
        </p>

        <h2 className="h3" style={{ margin: "28px 0 8px" }}>
          Getting the checkmark
        </h2>
        <p>
          <Seal trust="verified" size={16} /> Verified publishers have their identity confirmed by
          us. The myPA team grants it after reviewing a publisher with a track record.{" "}
          <Seal trust="official" size={16} /> Official is reserved for widgets made by myPA.
        </p>
      </div>

      <Link href="/signin" className="btn btn--primary btn--lg" style={{ marginTop: 20 }}>
        Start publishing
      </Link>
    </div>
  );
}
