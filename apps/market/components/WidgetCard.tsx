import Link from "next/link";

import { CATEGORY_LABEL, formatPrice } from "@repo/widget-sdk";

import type { ListedWidget } from "@/lib/data";

import { Seal, Tile } from "./icons";

export function Price({ w }: { w: ListedWidget }) {
  const paid = Boolean(w.priceAmount);
  return (
    <span className={`price${paid ? " price--paid" : ""}`}>
      {paid ? formatPrice({ amount: w.priceAmount!, currency: w.priceCurrency, checkoutUrl: "" }) : "Free"}
    </span>
  );
}

export function WidgetCard({ w, feature = false }: { w: ListedWidget; feature?: boolean }) {
  const m = w.manifest;
  return (
    <Link href={`/widgets/${encodeURIComponent(w.id)}`} className={`card${feature ? " card--feature" : ""}`}>
      <span className="card__top">
        <Tile icon={m.icon} size={feature ? "lg" : "md"} />
        <span>
          <span className="card__name">{m.name}</span>
          <span className="pub">
            {w.publisher.name}
            <Seal trust={w.trust} size={14} />
          </span>
        </span>
      </span>
      <p className="card__summary">{m.summary}</p>
      <span className="card__foot">
        <span>{CATEGORY_LABEL[m.category]}</span>
        <Price w={w} />
      </span>
    </Link>
  );
}
