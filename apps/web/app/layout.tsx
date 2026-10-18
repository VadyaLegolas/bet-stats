import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";

import { QuotaCounter } from "../components/quota-counter";
import { BrandIcon } from "../components/brand-icon";
import { ReleaseNavigation } from "../components/release-navigation";
import { ThemeToggle } from "../components/theme-toggle";
import { ThemeBootstrapScript } from "../components/theme-bootstrap";

import { plexSans, sourceSerif } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "Матчдей — достоверные футбольные прогнозы",
  description: "Прозрачные данные о футбольных матчах и аналитическая информация.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    /* data-theme="light" is the server default; ThemeBootstrapScript restamps
       it from localStorage/system preference while the HTML parses (before the
       first paint), and suppressHydrationWarning tells React to accept that
       stamped value. The script itself lives in components/theme-bootstrap —
       a Client Component so React never re-executes it during client renders. */
    <html lang="ru" data-theme="light" suppressHydrationWarning className={`${sourceSerif.variable} ${plexSans.variable}`}>
      <head>
        <ThemeBootstrapScript />
      </head>
      <body>
        <a className="skip-link" href="#main-content">Перейти к основному содержимому</a>
        <header className="release-header">
          <div className="release-frame release-header-inner">
            <Link href="/" className="release-brand"><BrandIcon />Матчдей</Link>
            <div className="release-header-tools">
              <QuotaCounter />
              <ReleaseNavigation />
              <ThemeToggle />
            </div>
          </div>
        </header>
        <main id="main-content" className="release-frame release-main" tabIndex={-1}>{children}</main>
        <footer className="release-footer">
          <p className="release-frame">
            Только футбольные данные и аналитическая информация. Исходы остаются неопределёнными. Если ставки законны там, где вы находитесь, помните о риске финансовых потерь.
          </p>
        </footer>
      </body>
    </html>
  );
}
