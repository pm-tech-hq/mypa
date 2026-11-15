/**
 * Search and sharing: one place for the canonical address, page metadata and
 * the structured data (schema.org JSON-LD) that search engines read.
 */
import type { Metadata } from "next";

import type { Release } from "./release";
import { REPO_URL } from "./release";

/** The canonical address. Production is my-pa.xyz; a preview can override it. */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://my-pa.xyz").replace(/\/$/, "");
export const SITE_NAME = "myPA";

/** Title, description, canonical URL and the matching Open Graph and X card for one page. */
export function pageMeta({
  title,
  description,
  path,
  absoluteTitle = false,
}: {
  title: string;
  description: string;
  path: string;
  absoluteTitle?: boolean;
}): Metadata {
  const shareTitle = absoluteTitle ? title : `${title} · ${SITE_NAME}`;
  return {
    title: absoluteTitle ? { absolute: title } : title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      locale: "en_GB",
      url: path,
      title: shareTitle,
      description,
    },
    twitter: { card: "summary_large_image", title: shareTitle, description },
  };
}

/** A <script type="application/ld+json"> payload; "<" is escaped so text can't close the tag. */
export function jsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

export function softwareLd(rel: Release) {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "myPA",
    description:
      "A personal assistant that runs on your own computer: your to-do list, calendar, email and notes on one board, with an AI that works offline. Free for Windows.",
    url: SITE_URL,
    applicationCategory: "ProductivityApplication",
    operatingSystem: "Windows 10, Windows 11",
    softwareVersion: rel.version,
    datePublished: rel.date,
    downloadUrl: rel.installer,
    fileSize: rel.size ? `${Math.round(rel.size / 1048576)} MB` : undefined,
    license: "https://www.gnu.org/licenses/agpl-3.0.html",
    isAccessibleForFree: true,
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    screenshot: `${SITE_URL}/opengraph-image`,
    sameAs: [REPO_URL],
  };
}

export function siteLd() {
  return [
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: SITE_NAME,
      url: SITE_URL,
    },
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      name: SITE_NAME,
      url: SITE_URL,
      logo: `${SITE_URL}/icon.svg`,
      sameAs: [REPO_URL],
    },
  ];
}

export function faqLd(items: { q: string; a: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((it) => ({
      "@type": "Question",
      name: it.q,
      acceptedAnswer: { "@type": "Answer", text: it.a },
    })),
  };
}

export function JsonLd({ data }: { data: unknown }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(data) }} />;
}
