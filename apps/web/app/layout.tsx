import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";

import { QuotaCounter } from "../components/quota-counter";
import { ReleaseNavigation } from "../components/release-navigation";

import { plexSans, sourceSerif } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "Bet Stats — достоверные футбольные прогнозы",
  description: "Прозрачные данные о футбольных матчах и аналитическая информация.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ru" className={`${sourceSerif.variable} ${plexSans.variable}`}>
      <body>
        <a className="skip-link" href="#main-content">Перейти к основному содержимому</a>
        <header className="release-header">
          <div className="release-frame release-header-inner">
            <Link href="/" className="release-brand">Bet Stats</Link>
            <div className="release-header-tools">
              <QuotaCounter />
              <ReleaseNavigation />
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
