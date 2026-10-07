import "server-only";

import {
  REGISTRY_FORMAT,
  type RegistryEntry,
  type RegistryIndex,
  type RegistryPublisher,
  type SignedRegistry,
} from "@repo/widget-sdk";

import { signRegistry } from "./crypto";
import { listListed, siteUrl } from "./data";

/**
 * The hosted catalog in the exact format the desktop app already reads,
 * signed with the marketplace key it trusts. Prices come from the database,
 * never from the uploaded manifest, and point at this site's checkout.
 */
export async function buildRegistry(): Promise<SignedRegistry> {
  const site = siteUrl();
  const widgets = await listListed();
  const publishers: Record<string, RegistryPublisher> = {};
  const entries: RegistryEntry[] = widgets.map((w) => {
    publishers[w.publisher.slug] ??= {
      name: w.publisher.name,
      verified: w.publisher.verified,
      ...(w.publisher.official ? { official: true } : {}),
      url: `${site}/publishers/${w.publisher.slug}`,
      licenseKey: w.publisher.licensePublicKey,
    };
    const { price: _ignored, ...manifest } = w.manifest;
    void _ignored;
    return {
      manifest: {
        ...manifest,
        ...(w.priceAmount
          ? {
              price: {
                amount: w.priceAmount,
                currency: w.priceCurrency,
                checkoutUrl: `${site}/widgets/${encodeURIComponent(w.id)}/buy`,
              },
            }
          : {}),
      },
      bundleUrl: `${site}/api/bundles/${encodeURIComponent(w.id)}/${encodeURIComponent(w.version)}`,
      sha256: w.sha256,
      bytes: w.bytes,
      updatedAt: new Date(w.updatedAt).toISOString(),
      ...(w.featured ? { featured: true } : {}),
    };
  });
  const index: RegistryIndex = {
    format: REGISTRY_FORMAT,
    name: "myPA Marketplace",
    generatedAt: new Date().toISOString(),
    publishers,
    widgets: entries,
  };
  return signRegistry(index);
}
