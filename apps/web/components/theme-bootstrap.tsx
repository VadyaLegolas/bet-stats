"use client";

/* No-flash theme bootstrap, rendered as a Client Component on purpose.

   React warns in development whenever a client render produces a <script>
   tag, and a recoverable hydration error regenerates the tree on the client —
   which re-renders this element. The Next 16 «Preventing Flash» guide's
   remedy: a type branch. During SSR `typeof window` is undefined, so the
   server emits type="text/javascript" and the browser executes it while the
   HTML parses — before the first paint. On the client the same branch picks
   type="text/plain", so a later React render neither executes the script nor
   triggers the warning; suppressHydrationWarning lets hydration keep the
   server's type (the attribute would otherwise mismatch).

   The script body lives in theme.ts — one source of truth shared with the
   header switch. */

import { THEME_BOOTSTRAP_SCRIPT } from "./theme";

export function ThemeBootstrapScript() {
  return (
    <script
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }}
    />
  );
}
