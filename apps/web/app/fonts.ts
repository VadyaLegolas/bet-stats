import localFont from "next/font/local";

// Self-hosted variable fonts (latin subsets), so builds and e2e runs never
// depend on a third-party font CDN.
export const sourceSerif = localFont({
  src: [
    { path: "./fonts/source-serif-4-latin.woff2", style: "normal", weight: "400 700" },
    { path: "./fonts/source-serif-4-latin-italic.woff2", style: "italic", weight: "400 700" },
  ],
  variable: "--font-serif",
  display: "swap",
  fallback: ["Georgia", "Times New Roman", "serif"],
});

export const plexSans = localFont({
  src: [{ path: "./fonts/ibm-plex-sans-latin.woff2", style: "normal", weight: "400 700" }],
  variable: "--font-sans",
  display: "swap",
  fallback: ["-apple-system", "Segoe UI", "Roboto", "Arial", "sans-serif"],
});
