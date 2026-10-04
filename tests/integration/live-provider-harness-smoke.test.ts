import { describe, expect, it, vi } from "vitest";
import { createLiveProviderFactories, resolveReplayProviderFactories } from "../../workers/data-sync/src/main.js";
import { runSupervisedLiveOwner, startLiveProviderStack, stopLiveProviderStack } from "../e2e/live-provider-stack.js";

describe("live provider harness composition smoke", () => {
  it("uses injected deterministic factories without constructing live credentialed clients", () => {
    const deterministic = { "football-data.org": vi.fn(() => ({ id: "fd" })), "api-football": vi.fn(() => ({ id: "api" })) } as any;
    const resolved = resolveReplayProviderFactories({ footballDataApiToken: "secret-a", apiFootballApiKey: "secret-b", providerFactories: deterministic });
    expect(resolved).toBe(deterministic);
    expect(deterministic["football-data.org"]).not.toHaveBeenCalled(); expect(deterministic["api-football"]).not.toHaveBeenCalled();
  });
  it("keeps live factories lazy and provider-specific", () => { const factories = createLiveProviderFactories({ footballDataApiToken: "a", apiFootballApiKey: "b" }); expect(Object.keys(factories)).toEqual(["football-data.org", "api-football"]); });
});
describe.sequential("owned live provider stack", () => { it("migrates, executes production routing, enrichment and forecasts, and reaches PostgreSQL Redis API web and worker", async () => { const state=await startLiveProviderStack(); try { await runSupervisedLiveOwner(state.supervision, async () => { expect(state.workerReady).toBe(true); expect(state.seeded).toEqual(["PL","39","78","848"]); expect(state.productionCounts).toEqual({ enrichmentDecisions: 1, lineupObservations: 1, sourceObservations: 1, routeReceipts: 3, routeAttempts: 4, forecastSnapshots: 3 }); }); } finally { await stopLiveProviderStack(); } }, 240_000); });
