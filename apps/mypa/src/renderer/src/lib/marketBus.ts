/** Opens the marketplace from anywhere (add menu, empty board, a widget
 *  that isn't installed) without threading callbacks through the tree. */
export type MarketTarget =
  | { view: "discover" }
  | { view: "installed" }
  | { view: "developer" }
  | { view: "widget"; id: string };

const EVENT = "mypa:open-market";

export function openMarket(target: MarketTarget = { view: "discover" }): void {
  window.dispatchEvent(new CustomEvent<MarketTarget>(EVENT, { detail: target }));
}

export function onOpenMarket(cb: (target: MarketTarget) => void): () => void {
  const handler = (e: Event) => cb((e as CustomEvent<MarketTarget>).detail);
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
