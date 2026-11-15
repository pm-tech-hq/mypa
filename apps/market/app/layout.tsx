import type { Metadata, Viewport } from "next";

import "@repo/design-system/styles.css";
import "./globals.css";
import "./site.css";

import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { SITE_URL } from "@/lib/seo";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  applicationName: "myPA",
  title: {
    default: "myPA: free planner, to-do list and AI assistant for Windows",
    template: "%s · myPA",
  },
  description:
    "myPA is a free Windows app that puts your to-do list, calendar, email and notes on one board, with an AI assistant that runs on your own PC. No account needed.",
  keywords: [
    "personal assistant app",
    "Windows planner app",
    "to-do list and calendar app",
    "offline AI assistant",
    "desktop dashboard",
    "daily planner",
    "free productivity app",
  ],
  creator: "myPA",
  category: "productivity",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "myPA",
    locale: "en_GB",
    url: "/",
  },
  twitter: { card: "summary_large_image" },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
  },
  formatDetection: { telephone: false, email: false, address: false },
};

export const viewport: Viewport = {
  themeColor: "#f2f2f2",
  colorScheme: "light",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB" data-type="software">
      <head>
        <meta name="page-type" content="software" />
        <meta name="site-kind" content="software" />
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
