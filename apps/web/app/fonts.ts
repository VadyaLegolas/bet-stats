import localFont from "next/font/local";

// Self-hosted variable fonts (latin/cyrillic subsets), so builds and e2e runs
// never depend on a third-party font CDN. Space Grotesk has no Cyrillic glyphs,
// so heading stacks fall through to Inter (latin, then cyrillic). next/font
// requires literal option objects, hence the repeated fallback lists.
export const spaceGrotesk = localFont({
  src: [{ path: "./fonts/space-grotesk-latin.woff2", style: "normal", weight: "500 700" }],
  variable: "--font-space-grotesk",
  display: "swap",
  fallback: ["-apple-system", "Segoe UI", "Roboto", "Arial", "sans-serif"],
});

export const inter = localFont({
  src: [{ path: "./fonts/inter-latin.woff2", style: "normal", weight: "400 700" }],
  variable: "--font-inter",
  display: "swap",
  fallback: ["-apple-system", "Segoe UI", "Roboto", "Arial", "sans-serif"],
});

export const interCyrillic = localFont({
  src: [{ path: "./fonts/inter-cyrillic.woff2", style: "normal", weight: "400 700" }],
  variable: "--font-inter-cyrillic",
  display: "swap",
  fallback: ["-apple-system", "Segoe UI", "Roboto", "Arial", "sans-serif"],
});
