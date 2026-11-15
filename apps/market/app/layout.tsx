import type { Metadata } from "next";

import "@repo/design-system/styles.css";
import "./globals.css";
import "./site.css";

import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { siteUrl } from "@/lib/data";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: {
    default: "myPA: a free personal assistant app for Windows",
    template: "%s · myPA",
  },
  description:
    "myPA puts your to-do list, calendar, email and notes on one board, with an AI Assistant that runs on your own computer. Free and open source for Windows 10 and 11.",
  openGraph: {
    siteName: "myPA",
    type: "website",
  },
  icons: { icon: "/icon.svg" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-type="software">
      <head>
        <meta name="page-type" content="software" />
        <meta name="site-kind" content="software" />
        <meta name="theme-color" content="#f2f2f2" />
      </head>
      <body>
        <a href="#main" className="skip">
          Skip to content
        </a>
        <SiteHeader />
        <main id="main">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
