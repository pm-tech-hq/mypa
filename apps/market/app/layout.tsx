import type { Metadata } from "next";

import "@repo/design-system/styles.css";
import "./globals.css";

import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { siteUrl } from "@/lib/data";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: {
    default: "myPA Marketplace: widgets for your board",
    template: "%s · myPA Marketplace",
  },
  description:
    "Timers, habits, weather and more for your myPA board. Every widget runs sandboxed, and a checkmark shows who stands behind it.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SiteHeader />
        <main>{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
