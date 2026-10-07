import type { Metadata } from "next";
import "@repo/design-system/styles.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "myPA — web",
  description: "Part of the myPA monorepo",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
