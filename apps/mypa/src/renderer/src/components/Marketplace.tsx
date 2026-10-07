import { useEffect, useMemo, useState, type ReactNode } from "react";

import {
  ArrowLeft,
  Bell,
  CalendarDays,
  Check,
  Code2,
  Compass,
  Download,
  ExternalLink,
  FileUp,
  FolderOpen,
  Globe,
  KeyRound,
  ListChecks,
  ListPlus,
  Loader2,
  Package,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  ShoppingBag,
  Trash2,
  X,
} from "lucide-react";

import {
  CATEGORY_LABEL,
  WIDGET_CATEGORIES,
  describePermission,
  formatPrice,
  type CatalogWidget,
  type InstalledWidget,
  type Permission,
  type WidgetCategory,
  type WidgetManifest,
} from "../../../shared/widgetPlatform";
import {
  formatBytes,
  setCatalog,
  unwrap,
  updateFor,
  useCatalog,
  widgetIcon,
} from "../lib/market";
import type { MarketTarget } from "../lib/marketBus";
import { useReadyStore } from "../lib/store";
import "../styles/market.css";
import { TrustBadge } from "./TrustBadge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";
import { Switch } from "./ui/switch";

type View = MarketTarget["view"] | "updates";

interface Props {
  open: boolean;
  target: MarketTarget;
  onOpenChange: (open: boolean) => void;
  /** Adds an installed widget to the current page. */
  onAddToPage: (manifest: WidgetManifest) => void;
}

export function Marketplace({ open, target, onOpenChange, onAddToPage }: Props) {
  const { snapshot } = useReadyStore();
  const { catalog, error, loading, refresh } = useCatalog();
  const [view, setView] = useState<View>("discover");
  const [detailId, setDetailId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (target.view === "widget") {
      setDetailId(target.id);
      setView("discover");
    } else {
      setDetailId(null);
      setView(target.view);
    }
  }, [open, target]);

  const installed = snapshot.installedWidgets;
  const updates = useMemo(
    () => installed.map((w) => updateFor(w, catalog)).filter((x): x is CatalogWidget => x !== null),
    [installed, catalog],
  );

  const go = (v: View) => {
    setDetailId(null);
    setView(v);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="market" showCloseButton={false} aria-describedby="market-desc">
        <DialogTitle className="sr-only">Widget marketplace</DialogTitle>
        <DialogDescription id="market-desc" className="sr-only">
          Find, install and manage widgets for your boards.
        </DialogDescription>

        <nav className="market__rail" aria-label="Marketplace">
          <p className="market__brand">
            <Package size={16} aria-hidden />
            Marketplace
          </p>
          <RailItem icon={Compass} active={view === "discover"} onClick={() => go("discover")}>
            Discover
          </RailItem>
          <RailItem
            icon={ListChecks}
            active={view === "installed"}
            count={installed.length}
            onClick={() => go("installed")}
          >
            Installed
          </RailItem>
          <RailItem
            icon={RefreshCw}
            active={view === "updates"}
            count={updates.length}
            highlight={updates.length > 0}
            onClick={() => go("updates")}
          >
            Updates
          </RailItem>
          <div className="market__rail-sep" />
          <RailItem icon={Code2} active={view === "developer"} onClick={() => go("developer")}>
            Developer
          </RailItem>
          <p className="market__rail-note">
            Widgets run in a sandbox and only see what you allow.
          </p>
        </nav>

        <section className="market__main">
          <button
            type="button"
            className="market__close icon-btn"
            aria-label="Close marketplace"
            onClick={() => onOpenChange(false)}
          >
            <X size={16} />
          </button>

          {detailId ? (
            <Detail
              id={detailId}
              catalog={catalog?.widgets ?? []}
              onBack={() => setDetailId(null)}
              onAddToPage={(m) => {
                onAddToPage(m);
                onOpenChange(false);
              }}
            />
          ) : view === "discover" ? (
            <Discover
              items={catalog?.widgets ?? []}
              loading={loading && !catalog}
              error={error}
              onRetry={() => void refresh()}
              onOpen={setDetailId}
            />
          ) : view === "installed" ? (
            <Installed
              items={installed}
              catalog={catalog?.widgets ?? []}
              onOpen={setDetailId}
              onAddToPage={(m) => {
                onAddToPage(m);
                onOpenChange(false);
              }}
            />
          ) : view === "updates" ? (
            <Updates items={updates} onOpen={setDetailId} />
          ) : (
            <Developer />
          )}
        </section>
      </DialogContent>
    </Dialog>
  );
}

function RailItem({
  icon: Icon,
  active,
  count,
  highlight,
  onClick,
  children,
}: {
  icon: typeof Compass;
  active: boolean;
  count?: number;
  highlight?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`market__rail-item${active ? " is-active" : ""}`}
      aria-current={active ? "page" : undefined}
      onClick={onClick}
    >
      <Icon size={15} aria-hidden />
      <span>{children}</span>
      {count ? (
        <span className={`market__count num${highlight ? " is-hot" : ""}`}>{count}</span>
      ) : null}
    </button>
  );
}

/* ================================================================= discover */

function Discover({
  items,
  loading,
  error,
  onRetry,
  onOpen,
}: {
  items: CatalogWidget[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onOpen: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<WidgetCategory | "all">("all");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((w) => {
      const m = w.entry.manifest;
      if (category !== "all" && m.category !== category) return false;
      if (!q) return true;
      return [m.name, m.summary, m.publisher.name, w.publisher.name].some((s) =>
        s.toLowerCase().includes(q),
      );
    });
  }, [items, query, category]);

  const featured = items.filter((w) => w.entry.featured);
  const browsing = !query && category === "all";
  const categories = WIDGET_CATEGORIES.filter((c) => items.some((w) => w.entry.manifest.category === c));

  return (
    <div className="market__scroll">
      <header className="market__head">
        <h1 className="market__title">Discover widgets</h1>
        <p className="market__lede">
          Add more to your boards. Everything here installs in a click and works offline unless it
          says otherwise.
        </p>
        <label className="market__search">
          <Search size={15} aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search widgets and publishers"
            aria-label="Search widgets"
          />
        </label>
        <div className="market__cats" role="tablist" aria-label="Category">
          <CatChip active={category === "all"} onClick={() => setCategory("all")}>
            All
          </CatChip>
          {categories.map((c) => (
            <CatChip key={c} active={category === c} onClick={() => setCategory(c)}>
              {CATEGORY_LABEL[c]}
            </CatChip>
          ))}
        </div>
      </header>

      {loading && (
        <div className="market__grid" aria-busy>
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="mcard mcard--skeleton" />
          ))}
        </div>
      )}

      {error && !items.length && (
        <div className="blankstate">
          <p className="blankstate__title">Couldn't load the catalog</p>
          <p className="blankstate__text">{error}</p>
          <Button size="sm" variant="outline" className="mt-3" onClick={onRetry}>
            Try again
          </Button>
        </div>
      )}

      {browsing && featured.length > 0 && (
        <section className="market__section">
          <h2 className="market__h2">Featured</h2>
          <div className="market__featured">
            {featured.slice(0, 3).map((w) => (
              <FeaturedCard key={w.entry.manifest.id} item={w} onOpen={onOpen} />
            ))}
          </div>
        </section>
      )}

      {!loading && (
        <section className="market__section">
          <h2 className="market__h2">
            {browsing ? "All widgets" : `${filtered.length} result${filtered.length === 1 ? "" : "s"}`}
          </h2>
          {filtered.length ? (
            <div className="market__grid">
              {filtered.map((w) => (
                <WidgetCard key={w.entry.manifest.id} item={w} onOpen={onOpen} />
              ))}
            </div>
          ) : (
            <p className="market__none">Nothing matches that. Try another word or category.</p>
          )}
        </section>
      )}
    </div>
  );
}

function CatChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={`chip${active ? " chip--on" : ""}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function useInstalledState(id: string) {
  const { snapshot } = useReadyStore();
  return snapshot.installedWidgets.find((w) => w.manifest.id === id) ?? null;
}

function PriceTag({ item }: { item: CatalogWidget }) {
  const installed = useInstalledState(item.entry.manifest.id);
  if (installed && item.entry.manifest.price && !installed.licensee)
    return (
      <span className="mtag mtag--paid">
        <KeyRound size={12} aria-hidden />
        Needs license
      </span>
    );
  if (installed)
    return (
      <span className="mtag mtag--installed">
        <Check size={12} aria-hidden />
        Installed
      </span>
    );
  return (
    <span className={`mtag${item.entry.manifest.price ? " mtag--paid" : ""}`}>
      {formatPrice(item.entry.manifest.price)}
    </span>
  );
}

function IconTile({ icon, size = "md" }: { icon: string; size?: "md" | "lg" | "xl" }) {
  const Icon = widgetIcon(icon);
  return (
    <span className={`mtile mtile--${size}`} aria-hidden>
      <Icon />
    </span>
  );
}

function FeaturedCard({ item, onOpen }: { item: CatalogWidget; onOpen: (id: string) => void }) {
  const m = item.entry.manifest;
  return (
    <button type="button" className="mfeat" onClick={() => onOpen(m.id)}>
      <IconTile icon={m.icon} size="lg" />
      <span className="mfeat__body">
        <span className="mfeat__name">{m.name}</span>
        <span className="mfeat__summary">{m.summary}</span>
      </span>
      <span className="mfeat__foot">
        <span className="mpub">
          {item.publisher.name}
          <TrustBadge trust={item.trust} size={13} />
        </span>
        <PriceTag item={item} />
      </span>
    </button>
  );
}

function WidgetCard({ item, onOpen }: { item: CatalogWidget; onOpen: (id: string) => void }) {
  const m = item.entry.manifest;
  return (
    <button type="button" className="mcard" onClick={() => onOpen(m.id)}>
      <span className="mcard__top">
        <IconTile icon={m.icon} />
        <span className="mcard__id">
          <span className="mcard__name">{m.name}</span>
          <span className="mpub">
            {item.publisher.name}
            <TrustBadge trust={item.trust} size={13} />
          </span>
        </span>
      </span>
      <span className="mcard__summary">{m.summary}</span>
      <span className="mcard__foot">
        <span className="mcard__cat">{CATEGORY_LABEL[m.category]}</span>
        <PriceTag item={item} />
      </span>
    </button>
  );
}

/* =================================================================== detail */

const PERMISSION_ICON: Record<string, typeof Globe> = {
  "tasks:read": ListChecks,
  "tasks:write": ListPlus,
  "calendar:read": CalendarDays,
  notify: Bell,
};

function PermissionList({ permissions }: { permissions: Permission[] }) {
  if (!permissions.length)
    return (
      <p className="mperm__none">
        <ShieldCheck size={15} aria-hidden />
        Needs no access to your data or the internet.
      </p>
    );
  return (
    <ul className="mperm">
      {permissions.map((p) => {
        const Icon = PERMISSION_ICON[p] ?? Globe;
        return (
          <li key={p}>
            <Icon size={15} aria-hidden />
            {describePermission(p)}
          </li>
        );
      })}
    </ul>
  );
}

function Detail({
  id,
  catalog,
  onBack,
  onAddToPage,
}: {
  id: string;
  catalog: CatalogWidget[];
  onBack: () => void;
  onAddToPage: (m: WidgetManifest) => void;
}) {
  const { actions } = useReadyStore();
  const installed = useInstalledState(id);
  const item = catalog.find((w) => w.entry.manifest.id === id) ?? null;
  const manifest = item?.entry.manifest ?? installed?.manifest ?? null;
  const trust = item?.trust ?? installed?.trust ?? "unverified";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [license, setLicense] = useState("");
  const [licenseError, setLicenseError] = useState<string | null>(null);

  if (!manifest) {
    return (
      <div className="market__scroll">
        <BackLink onBack={onBack} />
        <div className="blankstate">
          <p className="blankstate__title">This widget isn't in any of your registries</p>
          <p className="blankstate__text">
            It may have been installed from a file on another computer. Ask its maker for the
            .mypawidget file, or add their registry under Developer.
          </p>
        </div>
      </div>
    );
  }

  const paid = Boolean(manifest.price);
  const update = installed && item && item.entry.manifest.version !== installed.manifest.version;
  const needsConsent = manifest.permissions.length > 0 || trust === "community";

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const install = () =>
    run(async () => {
      if (!item) throw new Error("This widget isn't available from a registry.");
      actions.applySnapshot(await unwrap(window.mypa.market.install(id, item.registryUrl)));
    });

  const activate = async () => {
    setLicenseError(null);
    try {
      actions.applySnapshot(await unwrap(window.mypa.market.activateLicense(id, license)));
      setLicense("");
    } catch (e) {
      setLicenseError((e as Error).message);
    }
  };

  const paragraphs = (manifest.description ?? manifest.summary).split(/\n\s*\n/);

  return (
    <div className="market__scroll">
      <BackLink onBack={onBack} />
      <header className="mdetail__head">
        <IconTile icon={manifest.icon} size="xl" />
        <div className="mdetail__id">
          <h1 className="market__title">{manifest.name}</h1>
          <p className="mdetail__pub">
            {item?.publisher.name ?? manifest.publisher.name}
            <TrustBadge trust={trust} size={15} withLabel />
          </p>
          <p className="mdetail__meta">
            {CATEGORY_LABEL[manifest.category]}
            <span aria-hidden> · </span>
            Version {manifest.version}
          </p>
        </div>
        <div className="mdetail__cta">
          {!installed ? (
            paid ? (
              <>
                <Button
                  onClick={() => void window.mypa.market.openExternal(manifest.price!.checkoutUrl)}
                >
                  <ShoppingBag />
                  Buy {formatPrice(manifest.price)}
                </Button>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => (needsConsent ? setConsent(true) : void install())}
                >
                  {busy ? <Loader2 className="spin" /> : <Download />}
                  Install
                </Button>
              </>
            ) : (
              <Button
                disabled={busy || !item}
                onClick={() => (needsConsent ? setConsent(true) : void install())}
              >
                {busy ? <Loader2 className="spin" /> : <Download />}
                {busy ? "Installing" : "Get"}
              </Button>
            )
          ) : (
            <>
              {update && (
                <Button variant="outline" disabled={busy} onClick={() => void install()}>
                  {busy ? <Loader2 className="spin" /> : <RefreshCw />}
                  Update to {item!.entry.manifest.version}
                </Button>
              )}
              <Button
                disabled={!installed.enabled || (paid && !installed.licensee && installed.source === "registry")}
                onClick={() => onAddToPage(installed.manifest)}
              >
                <Plus />
                Add to this page
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Uninstall ${manifest.name}`}
                title="Uninstall"
                className="mdetail__remove"
                onClick={() => setConfirmRemove(true)}
              >
                <Trash2 />
              </Button>
            </>
          )}
        </div>
      </header>

      {error && (
        <p className="market__error" role="alert">
          {error}
        </p>
      )}

      {trust === "unverified" && (
        <p className="market__warn">
          myPA can't tell who made this widget. It still runs in the sandbox with only the
          permissions below, but only use it if you trust where it came from.
        </p>
      )}

      <div className="mdetail__cols">
        <div className="mdetail__about">
          {paragraphs.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
          {manifest.changelog && (
            <>
              <h2 className="market__h2">What's new</h2>
              <p>{manifest.changelog}</p>
            </>
          )}
        </div>

        <aside className="mdetail__side">
          <section className="mbox">
            <h2 className="mbox__title">This widget can</h2>
            <PermissionList permissions={manifest.permissions} />
          </section>

          {paid && installed && installed.source === "registry" && (
            <section className="mbox">
              <h2 className="mbox__title">License</h2>
              {installed.licensee ? (
                <p className="mlicense__ok">
                  <Check size={15} aria-hidden />
                  Licensed to {installed.licensee}
                </p>
              ) : (
                <>
                  <p className="mbox__text">
                    Paste the key you received after buying. It's checked on this computer.
                  </p>
                  <div className="mlicense">
                    <Input
                      value={license}
                      onChange={(e) => setLicense(e.target.value)}
                      placeholder="License key"
                      aria-label="License key"
                      aria-invalid={Boolean(licenseError)}
                    />
                    <Button variant="outline" disabled={!license.trim()} onClick={() => void activate()}>
                      <KeyRound />
                      Activate
                    </Button>
                  </div>
                  {licenseError && <p className="market__error">{licenseError}</p>}
                </>
              )}
            </section>
          )}

          <section className="mbox">
            <h2 className="mbox__title">Details</h2>
            <dl className="mfacts">
              <dt>Price</dt>
              <dd>{formatPrice(manifest.price)}</dd>
              {item && (
                <>
                  <dt>Size</dt>
                  <dd className="num">{formatBytes(item.entry.bytes)}</dd>
                  <dt>From</dt>
                  <dd>{item.registryName}</dd>
                </>
              )}
              {installed && (
                <>
                  <dt>Installed</dt>
                  <dd>
                    {installed.source === "dev"
                      ? "Developer folder"
                      : installed.source === "file"
                        ? "From a file"
                        : `Version ${installed.manifest.version}`}
                  </dd>
                </>
              )}
              <dt>Widget ID</dt>
              <dd className="mfacts__mono">{manifest.id}</dd>
            </dl>
            {manifest.homepage && (
              <button
                type="button"
                className="mlink"
                onClick={() => void window.mypa.market.openExternal(manifest.homepage!)}
              >
                Website
                <ExternalLink size={12} aria-hidden />
              </button>
            )}
          </section>
        </aside>
      </div>

      <AlertDialog open={consent} onOpenChange={setConsent}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Install {manifest.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {trust === "community"
                ? `${manifest.publisher.name} hasn't been verified. The widget runs in a sandbox and can only:`
                : "It runs in a sandbox and can only:"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <PermissionList permissions={manifest.permissions} />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void install()}>Install</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Uninstall {manifest.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              It's removed from every page, along with anything it saved. You can install it
              again later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() =>
                void run(async () => {
                  actions.applySnapshot(await unwrap(window.mypa.market.uninstall(id)));
                })
              }
            >
              Uninstall
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function BackLink({ onBack }: { onBack: () => void }) {
  return (
    <button type="button" className="market__back" onClick={onBack}>
      <ArrowLeft size={15} aria-hidden />
      Back
    </button>
  );
}

/* ================================================================ installed */

function Installed({
  items,
  catalog,
  onOpen,
  onAddToPage,
}: {
  items: InstalledWidget[];
  catalog: CatalogWidget[];
  onOpen: (id: string) => void;
  onAddToPage: (m: WidgetManifest) => void;
}) {
  const { actions } = useReadyStore();
  return (
    <div className="market__scroll">
      <header className="market__head">
        <h1 className="market__title">Installed</h1>
        <p className="market__lede">
          Turn a widget off to pause it everywhere without losing its data.
        </p>
      </header>
      {items.length === 0 ? (
        <div className="blankstate">
          <span className="blankstate__icon">
            <Package size={16} />
          </span>
          <p className="blankstate__title">Nothing installed yet</p>
          <p className="blankstate__text">Widgets you get from Discover show up here.</p>
        </div>
      ) : (
        <ul className="mlist">
          {items.map((w) => {
            const m = w.manifest;
            const hasUpdate = updateFor(w, { widgets: catalog, registries: [] });
            return (
              <li key={m.id} className={`mrow${w.enabled ? "" : " is-off"}`}>
                <button type="button" className="mrow__main" onClick={() => onOpen(m.id)}>
                  <IconTile icon={m.icon} />
                  <span className="mrow__id">
                    <span className="mrow__name">
                      {m.name}
                      <TrustBadge trust={w.trust} size={13} />
                      {hasUpdate && <span className="mtag mtag--update">Update</span>}
                    </span>
                    <span className="mrow__meta">
                      {m.publisher.name}
                      <span aria-hidden> · </span>
                      {w.source === "dev" ? "Developer folder" : `Version ${m.version}`}
                    </span>
                  </span>
                </button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!w.enabled}
                  onClick={() => onAddToPage(m)}
                >
                  <Plus />
                  Add
                </Button>
                <Switch
                  checked={w.enabled}
                  aria-label={`${w.enabled ? "Turn off" : "Turn on"} ${m.name}`}
                  onCheckedChange={(on) =>
                    void unwrap(window.mypa.market.setEnabled(m.id, on)).then(actions.applySnapshot)
                  }
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Updates({ items, onOpen }: { items: CatalogWidget[]; onOpen: (id: string) => void }) {
  const { actions } = useReadyStore();
  const [busy, setBusy] = useState(false);
  const updateAll = async () => {
    setBusy(true);
    for (const w of items) {
      const r = await window.mypa.market.install(w.entry.manifest.id, w.registryUrl);
      if (r.ok) actions.applySnapshot(r.value);
    }
    setBusy(false);
  };
  return (
    <div className="market__scroll">
      <header className="market__head market__head--row">
        <div>
          <h1 className="market__title">Updates</h1>
          <p className="market__lede">Updates keep each widget's saved data.</p>
        </div>
        {items.length > 1 && (
          <Button disabled={busy} onClick={() => void updateAll()}>
            {busy ? <Loader2 className="spin" /> : <RefreshCw />}
            Update all
          </Button>
        )}
      </header>
      {items.length === 0 ? (
        <div className="blankstate">
          <span className="blankstate__icon">
            <Check size={16} />
          </span>
          <p className="blankstate__title">Everything is up to date</p>
        </div>
      ) : (
        <ul className="mlist">
          {items.map((w) => (
            <li key={w.entry.manifest.id} className="mrow">
              <button type="button" className="mrow__main" onClick={() => onOpen(w.entry.manifest.id)}>
                <IconTile icon={w.entry.manifest.icon} />
                <span className="mrow__id">
                  <span className="mrow__name">{w.entry.manifest.name}</span>
                  <span className="mrow__meta">Version {w.entry.manifest.version} is available</span>
                </span>
              </button>
              <Button size="sm" onClick={() => onOpen(w.entry.manifest.id)}>
                Review
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ================================================================ developer */

function Developer() {
  const { actions } = useReadyStore();
  const { catalog } = useCatalog();
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const act = async (fn: () => Promise<void>) => {
    setError(null);
    setNotice(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="market__scroll">
      <header className="market__head">
        <h1 className="market__title">Build and share widgets</h1>
        <p className="market__lede">
          A widget is a folder with a manifest and plain HTML, CSS and JavaScript. It runs in a
          sandbox and talks to myPA through a small SDK.
        </p>
      </header>

      <section className="market__section">
        <h2 className="market__h2">Start in three steps</h2>
        <ol className="msteps">
          <li>
            <span className="msteps__n num">1</span>
            <div>
              <b>Create a widget from the template</b>
              <code className="mcode">node packages/widget-sdk/bin/mypa-widget.ts init my-widget --id you.my-widget</code>
            </div>
          </li>
          <li>
            <span className="msteps__n num">2</span>
            <div>
              <b>Load it here while you work</b>
              <p>It reloads on every save.</p>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  void act(async () => {
                    const s = await unwrap(window.mypa.market.linkDev());
                    if (s) {
                      actions.applySnapshot(s);
                      setNotice("Linked. Add it from the Add widget menu.");
                    }
                  })
                }
              >
                <FolderOpen />
                Load unpacked folder
              </Button>
            </div>
          </li>
          <li>
            <span className="msteps__n num">3</span>
            <div>
              <b>Pack it to share, or publish it to a registry</b>
              <code className="mcode">mypa-widget pack my-widget</code>
              <p>
                Send the .mypawidget file to anyone, or sign it into a registry with
                <code className="mcode mcode--inline">mypa-widget registry</code>. Paid widgets link
                to your own checkout and issue keys with
                <code className="mcode mcode--inline">mypa-widget license</code>.
              </p>
            </div>
          </li>
        </ol>
      </section>

      <section className="market__section">
        <h2 className="market__h2">Install from a file</h2>
        <p className="market__p">
          Someone sent you a .mypawidget file? Install it here. It's marked Unverified because
          myPA can't check who made it.
        </p>
        <Button
          variant="outline"
          onClick={() =>
            void act(async () => {
              const s = await unwrap(window.mypa.market.installFile());
              if (s) {
                actions.applySnapshot(s);
                setNotice("Installed. Add it from the Add widget menu.");
              }
            })
          }
        >
          <FileUp />
          Choose a file
        </Button>
      </section>

      <section className="market__section">
        <h2 className="market__h2">Registries</h2>
        <p className="market__p">
          A registry is a signed catalog hosted anywhere on the web. Widgets from registries
          myPA doesn't recognise are listed as Community.
        </p>
        <ul className="mlist">
          {catalog?.registries.map((r) => (
            <li key={r.url} className="mrow">
              <span className="mrow__main mrow__main--static">
                <span className={`mreg__dot${r.ok ? "" : " is-bad"}`} aria-hidden />
                <span className="mrow__id">
                  <span className="mrow__name">
                    {r.name}
                    {r.trusted && <TrustBadge trust="official" size={13} />}
                  </span>
                  <span className="mrow__meta">
                    {r.ok
                      ? `${r.widgetCount} widget${r.widgetCount === 1 ? "" : "s"}${r.builtIn ? ", built in" : ""}`
                      : r.error}
                  </span>
                </span>
              </span>
              {!r.builtIn && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    void act(async () => setCatalog(await unwrap(window.mypa.market.removeRegistry(r.url))))
                  }
                >
                  Remove
                </Button>
              )}
            </li>
          ))}
        </ul>
        <form
          className="mreg__add"
          onSubmit={(e) => {
            e.preventDefault();
            void act(async () => {
              setCatalog(await unwrap(window.mypa.market.addRegistry(url)));
              setUrl("");
            });
          }}
        >
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/registry.json"
            aria-label="Registry URL"
          />
          <Button type="submit" variant="outline" disabled={!url.trim()}>
            Add registry
          </Button>
        </form>
      </section>

      {(error || notice) && (
        <p className={error ? "market__error" : "market__notice"} role={error ? "alert" : "status"}>
          {error ?? notice}
        </p>
      )}
    </div>
  );
}
