"use client";

import { THEME_BOOTSTRAP_SCRIPT } from "./theme";

/* No-flash theme bootstrap. The server render emits the script into <head>;
   the browser executes it while parsing the HTML, before the first paint.
   The client render emits nothing: hydration then never expects a <script>
   node at this position, so neither a missing script (a browser extension
   stripping inline <head> scripts — named in React's own hydration-mismatch
   message) nor extra nodes in <head> can fail hydration here, and client-side
   re-renders never create a script element (no «Encountered a script tag»
   dev warning when an unrelated error regenerates the tree). The executed
   script's effect persists, and ThemeToggle re-applies data-theme in a
   layout effect, so the theme stays correct either way. */
export function ThemeBootstrapScript() {
  if (typeof window !== "undefined") return null;
  return <script type="text/javascript" dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />;
}
