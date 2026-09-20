import type { Metadata } from "next";
import type { ReactNode } from "react";

import { ReleaseNavigation } from "../components/release-navigation";

import "./globals.css";

export const metadata: Metadata = {
  title: "Bet Stats",
  description: "Transparent football fixture data and analytical information.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main-content">Skip to main content</a>
        <header className="release-header">
          <div className="release-frame release-header-inner">
            <strong className="release-brand">Bet Stats</strong>
            <ReleaseNavigation />
          </div>
        </header>
        <main id="main-content" className="release-frame release-main" tabIndex={-1}>{children}</main>
        <footer className="release-footer">
          <p className="release-frame">
            Football data and analytical information only. Outcomes remain uncertain. If betting is legal where you are, be aware of the risk of financial loss.
          </p>
        </footer>
      </body>
    </html>
  );
}
