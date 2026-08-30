import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Bet Stats",
  description: "Transparent football fixture data and analytical information.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#F8FAFC", color: "#0F172A", fontFamily: "system-ui, sans-serif" }}>
        <header style={{ borderBottom: "1px solid #CBD5E1", background: "#FFFFFF" }}>
          <div style={{ maxWidth: 1200, margin: "0 auto", padding: "16px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <strong>Bet Stats</strong>
            <nav aria-label="Primary navigation">
              <Link href="/fixtures" style={{ color: "#1D4ED8", minHeight: 48, display: "inline-flex", alignItems: "center" }}>Fixtures</Link>
            </nav>
          </div>
        </header>
        <main style={{ maxWidth: 1200, margin: "0 auto", minHeight: "70vh", padding: "48px 24px" }}>{children}</main>
        <footer style={{ borderTop: "1px solid #CBD5E1", background: "#FFFFFF" }}>
          <p style={{ maxWidth: 1200, margin: "0 auto", padding: "24px", fontSize: 14, lineHeight: 1.4 }}>
            Football data and analytical information only. Outcomes remain uncertain. If betting is legal where you are, be aware of the risk of financial loss.
          </p>
        </footer>
      </body>
    </html>
  );
}
