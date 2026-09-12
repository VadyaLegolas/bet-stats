import { describe, expect, it, vi } from "vitest";

import { parseApiFootballEnrichmentEnvelope } from "@bet-stats/football-data";
import { runEnrichmentJob } from "../../workers/data-sync/src/jobs/enrichment.js";

describe("optional enrichment admission", () => {
  it("admits exact official lineup only after capability, circuit and optional reservation", async () => {
    const order: string[] = [];
    const issue = vi.fn(async () => "forecast-lineup-v1");
    const result = await runEnrichmentJob({
      fixtureId: "fixture-1", endpoint: "LINEUPS", cutoff: "2026-09-12T17:00:00.000Z",
      readCapability: async () => { order.push("capability"); return { supported: true, expiresAt: "2026-09-13T00:00:00.000Z" }; },
      readCircuit: async () => { order.push("circuit"); return "CLOSED"; },
      reserve: async () => { order.push("reserve"); return { reserved: true, reused: false }; },
      providerFactory: () => { order.push("factory"); return { fetch: async () => ({ state: "observed", capturedAt: "2026-09-12T16:50:00.000Z", payload: { fixtureId: "fixture-1", status: "OFFICIAL_CONFIRMED", players: ["p1"] } }) }; },
      persist: async () => { order.push("persist"); return { observationId: "lineup-1", receiptHash: "sha256:lineup" }; }, issueLineupForecast: issue,
      now: new Date("2026-09-12T16:00:00.000Z"),
    });
    expect(order).toEqual(["capability", "circuit", "reserve", "factory", "persist"]);
    expect(result).toMatchObject({ status: "completed", observationId: "lineup-1", forecastId: "forecast-lineup-v1" });
    expect(issue).toHaveBeenCalledWith({ fixtureId: "fixture-1", cutoff: "2026-09-12T17:00:00.000Z", officialLineupObservationId: "lineup-1", receiptHash: "sha256:lineup" });
  });

  it("denies before provider construction and distinguishes observed empty", async () => {
    const factory = vi.fn(() => ({ fetch: async () => ({}) }));
    expect(await runEnrichmentJob({ fixtureId: "f", endpoint: "LINEUPS", cutoff: "2026-09-12T17:00:00.000Z", readCapability: async () => null, readCircuit: async () => "CLOSED", reserve: async () => ({ reserved: true }), providerFactory: factory, persist: async () => ({ observationId: "x", receiptHash: "x" }), now: new Date("2026-09-12T16:00:00.000Z") })).toEqual({ status: "denied", reason: "UNKNOWN_CAPABILITY" });
    expect(factory).not.toHaveBeenCalled();
    expect(parseApiFootballEnrichmentEnvelope("injuries", { get: "injuries", parameters: { fixture: "1" }, errors: [], results: 0, paging: { current: 1, total: 1 }, response: [] }, { fixture: "1" })).toMatchObject({ state: "observed-empty", payload: null });
  });
});
