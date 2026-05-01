import type { CSSProperties } from "react";
import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Sigil Protocol",
  description:
    "Identity and provenance infrastructure for autonomous AI agents on 0G.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const fontVars = {
    "--font-display-src": '"Baskerville", "Iowan Old Style", Georgia',
    "--font-body-src": '"Avenir Next", "Segoe UI", Helvetica, Arial',
    "--font-mono-src": '"SFMono-Regular", Menlo, Monaco, Consolas',
  } as CSSProperties;

  return (
    <html lang="en" data-theme="vault" style={fontVars}>
      <body>{children}</body>
    </html>
  );
}
