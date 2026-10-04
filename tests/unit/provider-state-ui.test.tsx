import { createElement } from "../../apps/web/node_modules/react/index.js";
import { renderToStaticMarkup } from "../../apps/web/node_modules/react-dom/server.js";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { ProviderStateNotice } from "../../apps/web/components/provider-state-notice.js";

describe("provider state notice", () => {
  it("renders exact fallback and no-fallback copy with inert receipt metadata", () => {
    const fallback = renderToStaticMarkup(createElement(ProviderStateNotice, { state: { state: "FALLBACK", provider: "api-football", reason: "UPSTREAM_UNAVAILABLE", capturedAt: "2026-09-12T12:00:02.000Z", lastValidAt: null, retryAllowed: false, receipt: { id: "route-1", policyVersion: "v1", outcome: "SUCCEEDED", trigger: "UPSTREAM_UNAVAILABLE" } } }));
    expect(fallback).toContain("Fallback source used"); expect(fallback).toContain("api-football"); expect(fallback).toContain("<time"); expect(fallback).toContain("route-1");
    const limited = renderToStaticMarkup(createElement(ProviderStateNotice, { state: { state: "LIMITED", provider: "api-football", reason: "NO_PRODUCTION_FALLBACK", capturedAt: null, lastValidAt: "2026-09-12T10:00:00.000Z", retryAllowed: true, receipt: { id: "route-2", policyVersion: "v1", outcome: "NO_FALLBACK", trigger: "PROVIDER_UNAVAILABLE" } } }));
    expect(limited).toContain("Limited data — no production fallback"); expect(limited).toContain("API-Football is the sole configured source"); expect(limited).toContain("Last valid capture — not current"); expect(limited).not.toContain(">0<");
  });

  it("covers every written state and keeps exact collection recovery copy", () => {
    const states = ["PRIMARY", "FALLBACK", "PENDING", "UNAVAILABLE", "LIMITED", "UNSUPPORTED", "STALE_CAPABILITY", "BUDGET_PROTECTED", "CIRCUIT_DENIED"] as const;
    for (const state of states) {
      const markup = renderToStaticMarkup(createElement(ProviderStateNotice, { state: { state, provider: "provider-safe", reason: `${state}_REASON`, capturedAt: "2026-09-12T12:00:00.000Z", lastValidAt: null, retryAllowed: state !== "PRIMARY", receipt: null } }));
      expect(markup).toContain("provider-safe"); expect(markup).toContain("<time"); expect(markup).not.toContain("tabindex=\"1\"");
    }
    const source = readFileSync(resolve(import.meta.dirname, "../../apps/web/app/fixtures/page.tsx"), "utf8");
    expect(source).toContain("Fixtures could not be loaded. Your filters were kept. Select Try loading fixtures again.");
    expect(source).toContain("No fixtures match these filters. Change the competition or date range, then apply filters again.");
  });
});
