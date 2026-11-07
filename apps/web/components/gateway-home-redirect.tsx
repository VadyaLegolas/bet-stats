"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

// Returns a browser that reached a public page through the operator gateway
// (:8080) back to the app origin (:3000), so match sync posts directly to the
// app and never trips the gateway's 10s upstream timeout. /internal pages stay
// on the gateway (the operator dashboard keeps working there). Renders null on
// both server and client, so hydration is safe.
export function GatewayHomeRedirect({ homeOrigin }: { homeOrigin?: string | null }) {
  const pathname = usePathname();

  useEffect(() => {
    if (!homeOrigin) return;
    if (homeOrigin === window.location.origin) return;
    if (pathname.startsWith("/internal")) return;
    window.location.replace(`${homeOrigin}${pathname}${window.location.search}${window.location.hash}`);
  }, [homeOrigin, pathname]);

  return null;
}
