import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

import { ChevronDown, LayoutGrid, Package, Plus, Settings, Sparkles, Undo2 } from "lucide-react";

import { AppSettings, useSystemState } from "./components/AppSettings";
import { AssistantPanel } from "./components/AssistantPanel";
import { BrandMark } from "./components/BrandMark";
import { Marketplace } from "./components/Marketplace";
import { PageSidebar } from "./components/PageSidebar";
import { TrustBadge } from "./components/TrustBadge";
import { Widget } from "./components/Widget";
import { WindowControls } from "./components/WindowControls";
import { Button } from "./components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "./components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./components/ui/dialog";
import { DEFAULT_PAGE_ICON, pageIcon } from "./lib/pageIcons";
import { useStore } from "./lib/store";
import {
  findFreeSpot,
  scaleRect,
  tileLayout,
  unscaleRect,
  type Rect,
  type Size,
} from "./lib/widgets";
import { WIDGET_KINDS } from "./lib/widgetKinds";
import { updateFor, useCatalog, widgetIcon } from "./lib/market";
import { onOpenMarket, openMarket, type MarketTarget } from "./lib/marketBus";
import { pageColorHex } from "../../shared/pageColors";
import type { InstalledWidget, WidgetManifest } from "../../shared/widgetPlatform";
import type { WidgetKind } from "../../shared/types";
import "./styles/pages.css";

/** What the add menu hands back: a built-in kind, or an installed widget. */
interface WidgetChoice {
  kind: WidgetKind;
  plugin?: WidgetManifest;
}

export function App() {
  const { snapshot, actions } = useStore();

  const [activeId, setActiveId] = useState<string | null>(null);
  const [dragRects, setDragRects] = useState<Record<string, Rect>>({});
  /** Kind waiting on the "page is full" prompt. */
  const [pendingKind, setPendingKind] = useState<WidgetChoice | null>(null);
  const [marketOpen, setMarketOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const system = useSystemState();
  const updateReady = system?.update.state === "ready";

  // Ctrl+K (⌘K) opens and closes the assistant from anywhere; Esc closes it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setAssistantOpen((v) => !v);
      } else if (e.key === "Escape" && !e.defaultPrevented) {
        const inPanel = (document.activeElement as HTMLElement | null)?.closest(".asst");
        if (inPanel) setAssistantOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const [marketTarget, setMarketTarget] = useState<MarketTarget>({ view: "discover" });

  const { catalog } = useCatalog();
  const updateCount = useMemo(
    () => (snapshot?.installedWidgets ?? []).filter((w) => updateFor(w, catalog)).length,
    [snapshot, catalog],
  );

  // mypa://widget/<id> links from the marketplace website.
  useEffect(
    () => window.mypa.market.onOpenWidget((id) => openMarket({ view: "widget", id })),
    [],
  );

  useEffect(
    () =>
      onOpenMarket((target) => {
        setMarketTarget(target);
        setMarketOpen(true);
      }),
    [],
  );
  /** Layout before the last "Fit all", so it can be undone. */
  const [undo, setUndo] = useState<{ pageId: string; rects: Record<string, Rect> } | null>(null);

  const canvasRef = useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = useState<Size>({ w: 1200, h: 720 });
  /** Board size that stored widget pixels are relative to (see `scaleRect`). */
  const refBounds = useRef<Size | null>(null);
  const ready = snapshot !== null;

  useLayoutEffect(() => {
    const el = canvasRef.current;
    if (!el || !ready) return;
    const measure = () => {
      const size = { w: el.clientWidth, h: el.clientHeight };
      if (size.w === 0 || size.h === 0) return;
      refBounds.current ??= size;
      setBounds(size);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ready]);

  const currentPageId = snapshot?.meta.currentPageId ?? snapshot?.pages[0]?.id ?? null;
  const currentPage = snapshot?.pages.find((p) => p.id === currentPageId) ?? null;
  const ref = refBounds.current ?? bounds;

  const widgets = useMemo(
    () => (snapshot?.widgets ?? []).filter((w) => w.pageId === currentPageId),
    [snapshot, currentPageId],
  );

  const laidOut = useMemo(
    () =>
      widgets.map((w) => ({
        widget: w,
        rect: dragRects[w.id] ?? scaleRect({ x: w.x, y: w.y, w: w.w, h: w.h }, ref, bounds),
      })),
    [widgets, dragRects, bounds, ref],
  );

  const place = useCallback(
    (choice: WidgetChoice, pageId: string, live?: Rect) =>
      actions.createWidget(
        choice.kind,
        pageId,
        live ? unscaleRect(live, ref, bounds) : undefined,
        choice.plugin?.id,
      ),
    [actions, ref, bounds],
  );

  const spotFor = useCallback(
    (choice: WidgetChoice, taken: Rect[]) =>
      findFreeSpot(choice.kind, taken, bounds, choice.plugin?.size),
    [bounds],
  );

  const addWidget = useCallback(
    (choice: WidgetChoice) => {
      if (!currentPageId) return;
      setUndo(null);
      const spot = spotFor(
        choice,
        laidOut.map((l) => l.rect),
      );
      if (spot) void place(choice, currentPageId, spot);
      else setPendingKind(choice);
    },
    [currentPageId, laidOut, spotFor, place],
  );

  /** "Page is full" → drop it on top of the current page, the classic way. */
  const addToCurrent = useCallback(() => {
    if (pendingKind && currentPageId)
      void actions.createWidget(pendingKind.kind, currentPageId, undefined, pendingKind.plugin?.id);
    setPendingKind(null);
  }, [actions, pendingKind, currentPageId]);

  const addToNewPage = useCallback(async () => {
    const choice = pendingKind;
    setPendingKind(null);
    if (!choice || !snapshot) return;
    await actions.createPage({
      title: `Page ${snapshot.pages.length + 1}`,
      icon: DEFAULT_PAGE_ICON,
    });
    const fresh = await window.mypa.db.snapshot();
    const created = fresh.pages.reduce((a, b) => (b.createdAt >= a.createdAt ? b : a));
    await actions.setCurrentPage(created.id);
    await place(choice, created.id, spotFor(choice, []) ?? undefined);
  }, [actions, pendingKind, snapshot, spotFor, place]);

  const arrange = useCallback(async () => {
    if (!currentPageId || widgets.length === 0) return;
    const ordered = [...widgets].sort((a, b) => a.y - b.y || a.x - b.x);
    const tiles = tileLayout(ordered.length, bounds);
    setUndo({
      pageId: currentPageId,
      rects: Object.fromEntries(ordered.map((w) => [w.id, { x: w.x, y: w.y, w: w.w, h: w.h }])),
    });
    for (const [i, w] of ordered.entries()) {
      await actions.updateWidget(w.id, unscaleRect(tiles[i]!, ref, bounds));
    }
  }, [actions, currentPageId, widgets, bounds, ref]);

  const undoArrange = useCallback(async () => {
    if (!undo) return;
    setUndo(null);
    for (const [id, rect] of Object.entries(undo.rects)) {
      if (snapshot?.widgets.some((w) => w.id === id)) await actions.updateWidget(id, rect);
    }
  }, [actions, undo, snapshot]);

  const onDrag = useCallback((id: string, rect: Rect) => {
    setDragRects((prev) => ({ ...prev, [id]: rect }));
  }, []);

  const onCommit = useCallback(
    (id: string, rect: Rect) => {
      setDragRects((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setUndo(null);
      void actions.updateWidget(id, unscaleRect(rect, ref, bounds));
    },
    [actions, ref, bounds],
  );

  const PageIcon = currentPage ? pageIcon(currentPage.icon) : null;
  /** The current page's colour, inherited by the title-bar icon and board grid. */
  const pageStyle = { "--page": pageColorHex(currentPage?.color) } as CSSProperties;

  return (
    <>
      <header className="appbar" style={pageStyle}>
        <div className="appbar__brand">
          <BrandMark />
          <span className="appbar__name">myPA</span>
          {currentPage && PageIcon && (
            <>
              <span className="appbar__sep" aria-hidden>
                /
              </span>
              <span className="appbar__page">
                <PageIcon size={14} aria-hidden />
                <span>{currentPage.title}</span>
              </span>
            </>
          )}
        </div>
        <div className="appbar__actions">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={assistantOpen ? "secondary" : "ghost"}
                size="sm"
                className="appbar__assistant"
                aria-pressed={assistantOpen}
                onClick={() => setAssistantOpen((v) => !v)}
              >
                <Sparkles />
                Assistant
              </Button>
            </TooltipTrigger>
            <TooltipContent>Ask or tell the assistant (Ctrl+K)</TooltipContent>
          </Tooltip>
          {undo && undo.pageId === currentPageId && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Undo fit"
                  onClick={() => void undoArrange()}
                >
                  <Undo2 />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Undo fit</TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Fit all widgets to the page"
                disabled={widgets.length === 0}
                onClick={() => void arrange()}
              >
                <LayoutGrid />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Fit all widgets to the page</TooltipContent>
          </Tooltip>
          <AddWidgetMenu
            onPick={addWidget}
            installed={snapshot?.installedWidgets ?? []}
            updates={updateCount}
          >
            <Button size="sm" className="appbar__add">
              <Plus />
              Add widget
              <ChevronDown className="appbar__add-caret" />
            </Button>
          </AddWidgetMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className="appbar__settings"
                aria-label={updateReady ? "Settings, update ready" : "Settings"}
                onClick={() => setSettingsOpen(true)}
              >
                <Settings />
                {updateReady && <span className="appbar__settings-dot" aria-hidden />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{updateReady ? "Update ready to install" : "Settings"}</TooltipContent>
          </Tooltip>
        </div>
        <WindowControls />
      </header>

      <AssistantPanel
        open={assistantOpen}
        onClose={() => setAssistantOpen(false)}
        pageId={currentPageId}
      />

      <div className="pg-body">
        {snapshot && currentPageId && <PageSidebar currentPageId={currentPageId} />}

        <main
          className="canvas"
          ref={canvasRef}
          style={pageStyle}
          aria-label={currentPage?.title ?? "Board"}
        >
          {!snapshot && (
            <div className="canvas__skeleton" aria-label="Loading" aria-busy>
              <span />
              <span />
              <span />
            </div>
          )}
          {snapshot && widgets.length === 0 && (
            <div className="canvas__empty">
              <h1 className="canvas__empty-title">This page is empty</h1>
              <p className="canvas__empty-text">
                Add a widget to start filling it. Drag a header to move it, pull an edge to resize.
              </p>
              <div className="canvas__empty-kinds">
                {WIDGET_KINDS.map(({ kind, label, description, icon: Icon }) => (
                  <button
                    key={kind}
                    type="button"
                    className="kind-tile"
                    onClick={() => addWidget({ kind })}
                  >
                    <Icon size={16} aria-hidden />
                    <span className="kind-tile__label">{label}</span>
                    <span className="kind-tile__desc">{description}</span>
                  </button>
                ))}
                <button
                  type="button"
                  className="kind-tile kind-tile--market"
                  onClick={() => openMarket()}
                >
                  <Package size={16} aria-hidden />
                  <span className="kind-tile__label">More widgets</span>
                  <span className="kind-tile__desc">Browse the marketplace</span>
                </button>
              </div>
            </div>
          )}
          {laidOut.map(({ widget, rect }) => (
            <Widget
              key={widget.id}
              widget={widget}
              rect={rect}
              bounds={bounds}
              active={widget.id === activeId}
              dragging={widget.id in dragRects}
              onFocus={() => setActiveId(widget.id)}
              onDrag={(r) => onDrag(widget.id, r)}
              onCommit={(r) => onCommit(widget.id, r)}
              onClose={() => {
                setActiveId((cur) => (cur === widget.id ? null : cur));
                setUndo(null);
                void actions.deleteWidget(widget.id);
              }}
            />
          ))}
        </main>
      </div>

      <Dialog open={pendingKind !== null} onOpenChange={(o) => !o && setPendingKind(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>This page is full</DialogTitle>
            <DialogDescription>
              There's no free space left for another widget. Put it on a new page, or stack it
              on top of this one?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={addToCurrent}>
              Stack on this page
            </Button>
            <Button onClick={() => void addToNewPage()}>Add to a new page</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AppSettings open={settingsOpen} onOpenChange={setSettingsOpen} state={system} />

      {snapshot && (
        <Marketplace
          open={marketOpen}
          target={marketTarget}
          onOpenChange={setMarketOpen}
          onAddToPage={(manifest) => addWidget({ kind: "custom", plugin: manifest })}
        />
      )}
    </>
  );
}

/** Paid widgets from a registry can't be placed until they're licensed. */
function usable(w: InstalledWidget): boolean {
  return w.enabled && !(w.manifest.price && !w.licensee && w.source === "registry");
}

function AddWidgetMenu({
  children,
  installed,
  updates,
  onPick,
}: {
  children: ReactNode;
  installed: InstalledWidget[];
  updates: number;
  onPick: (choice: WidgetChoice) => void;
}) {
  const custom = installed.filter(usable);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} className="add-menu">
        <DropdownMenuLabel className="add-menu__section">
          Built in
          <TrustBadge trust="official" size={13} />
        </DropdownMenuLabel>
        {WIDGET_KINDS.map(({ kind, label, description, icon: Icon }) => (
          <DropdownMenuItem key={kind} className="add-menu__item" onSelect={() => onPick({ kind })}>
            <span className="add-menu__icon">
              <Icon />
            </span>
            <span className="add-menu__text">
              <span className="add-menu__label">{label}</span>
              <span className="add-menu__desc">{description}</span>
            </span>
          </DropdownMenuItem>
        ))}
        {custom.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="add-menu__section">Installed</DropdownMenuLabel>
            {custom.map((w) => {
              const Icon = widgetIcon(w.manifest.icon);
              return (
                <DropdownMenuItem
                  key={w.manifest.id}
                  className="add-menu__item"
                  onSelect={() => onPick({ kind: "custom", plugin: w.manifest })}
                >
                  <span className="add-menu__icon">
                    <Icon />
                  </span>
                  <span className="add-menu__text">
                    <span className="add-menu__label">
                      {w.manifest.name}
                      <TrustBadge trust={w.trust} size={12} />
                    </span>
                    <span className="add-menu__desc">{w.manifest.summary}</span>
                  </span>
                </DropdownMenuItem>
              );
            })}
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="add-menu__item add-menu__market"
          onSelect={() => openMarket(updates ? { view: "installed" } : { view: "discover" })}
        >
          <span className="add-menu__icon">
            <Package />
          </span>
          <span className="add-menu__text">
            <span className="add-menu__label">Browse the marketplace</span>
            <span className="add-menu__desc">
              {updates
                ? `${updates} update${updates === 1 ? "" : "s"} waiting`
                : "Timers, habits, weather and more"}
            </span>
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
