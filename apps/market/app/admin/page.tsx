import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { describePermission } from "@repo/widget-sdk";

import { viewer } from "@/lib/auth";
import { allPublishers, allWidgetsForAdmin, pendingVersions } from "@/lib/data";

import { reviewVersion, setPublisherFlags, setWidgetFlags } from "./actions";

export const metadata: Metadata = { title: "Review", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function Admin() {
  const me = await viewer();
  if (!me?.isAdmin) notFound();
  const [pending, publishers, widgets] = await Promise.all([
    pendingVersions(),
    allPublishers(),
    allWidgetsForAdmin(),
  ]);

  return (
    <div className="wrap" style={{ paddingBottom: 80 }}>
      <header className="page-head">
        <h1>Review</h1>
        <p className="lede">
          Approve what&apos;s safe to list, and decide who earns a checkmark. Every change shows up
          in the signed registry within a minute.
        </p>
      </header>

      <section className="panel">
        <div className="panel__head">
          <h2 className="h3">Waiting for review ({pending.length})</h2>
        </div>
        {pending.length === 0 ? (
          <p className="muted">Nothing waiting. Nice.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Widget</th>
                <th>Publisher</th>
                <th>Asks for</th>
                <th>Files</th>
                <th>Decision</th>
              </tr>
            </thead>
            <tbody>
              {pending.map((v) => (
                <tr key={v.id}>
                  <td>
                    <strong>{v.manifest.name}</strong> <span className="num">{v.version}</span>
                    <div className="muted" style={{ fontSize: 13 }}>
                      {v.manifest.summary}
                    </div>
                    <div className="mono muted">{v.widgetId}</div>
                  </td>
                  <td>{v.publisher.name}</td>
                  <td style={{ fontSize: 13 }}>
                    {v.manifest.permissions.length
                      ? v.manifest.permissions.map((p) => <div key={p}>{describePermission(p)}</div>)
                      : <span className="muted">Nothing</span>}
                  </td>
                  <td>
                    <a href={v.bundleUrl} className="pub" download>
                      Download bundle
                    </a>
                  </td>
                  <td>
                    <form action={reviewVersion} className="inline-form" style={{ alignItems: "stretch" }}>
                      <input type="hidden" name="versionId" value={v.id} />
                      <input className="input" name="note" placeholder="Note to publisher (optional)" style={{ height: 32, width: 200 }} />
                      <button name="decision" value="approve" className="btn btn--sm btn--primary">
                        Approve
                      </button>
                      <button name="decision" value="reject" className="btn btn--sm btn--danger">
                        Reject
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="panel">
        <div className="panel__head">
          <h2 className="h3">Publishers</h2>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Publisher</th>
              <th>GitHub</th>
              <th>Widgets</th>
              <th>Payouts</th>
              <th>Checkmarks</th>
            </tr>
          </thead>
          <tbody>
            {publishers.map((p) => (
              <tr key={p.slug}>
                <td>
                  <strong>{p.name}</strong>
                  <div className="mono muted">{p.slug}</div>
                </td>
                <td>@{p.login}</td>
                <td className="num">{p.widgets}</td>
                <td>{p.stripeChargesReady ? "Ready" : p.stripeAccountId ? "In progress" : "Not set up"}</td>
                <td>
                  <form action={setPublisherFlags} className="inline-form">
                    <input type="hidden" name="slug" value={p.slug} />
                    <label className="check">
                      <input type="checkbox" name="verified" defaultChecked={p.verified} />
                      Verified
                    </label>
                    <label className="check">
                      <input type="checkbox" name="official" defaultChecked={p.official} />
                      Official
                    </label>
                    <button className="btn btn--sm">Save</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <div className="panel__head">
          <h2 className="h3">Widgets</h2>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Widget</th>
              <th>Publisher</th>
              <th>Placement</th>
            </tr>
          </thead>
          <tbody>
            {widgets.map((w) => (
              <tr key={w.id}>
                <td className="mono">{w.id}</td>
                <td>{w.publisherSlug}</td>
                <td>
                  <form action={setWidgetFlags} className="inline-form">
                    <input type="hidden" name="widgetId" value={w.id} />
                    <label className="check">
                      <input type="checkbox" name="featured" defaultChecked={w.featured} />
                      Featured
                    </label>
                    <label className="check">
                      <input type="checkbox" name="listed" defaultChecked={w.listed} />
                      Listed
                    </label>
                    <button className="btn btn--sm">Save</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
