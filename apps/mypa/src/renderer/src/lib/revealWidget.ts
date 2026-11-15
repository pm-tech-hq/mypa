import type { Snapshot, WidgetKind } from "../../../shared/types";

/**
 * Brings a widget of `kind` into view: switches to its page if it's on
 * another one, scrolls to it and flashes its outline. False if there's none.
 */
export async function revealWidget(
  kind: WidgetKind,
  snapshot: Snapshot,
  setCurrentPage: (id: string) => Promise<void>,
): Promise<boolean> {
  const current = snapshot.meta.currentPageId ?? snapshot.pages[0]?.id ?? null;
  const list = snapshot.widgets.filter((w) => w.kind === kind);
  const w = list.find((x) => x.pageId === current) ?? list[0];
  if (!w) return false;
  if (w.pageId !== current) await setCurrentPage(w.pageId);
  window.setTimeout(() => {
    const el = document.querySelector<HTMLElement>(`[data-widget-id="${w.id}"]`);
    if (!el) return;
    el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
    el.classList.remove("widget--flash");
    void el.offsetWidth;
    el.classList.add("widget--flash");
    window.setTimeout(() => el.classList.remove("widget--flash"), 1400);
  }, 120);
  return true;
}
