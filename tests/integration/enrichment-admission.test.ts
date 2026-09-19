import { describe, expect, it, vi } from "vitest";

import { parseApiFootballEnrichmentEnvelope } from "@bet-stats/football-data";
import { runEnrichmentJob } from "../../workers/data-sync/src/jobs/enrichment.js";
import { createEnrichmentJobId, createEnrichmentSchedule } from "../../workers/data-sync/src/queues/index.js";

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
      persist: async (_observation, classification) => { order.push("persist"); expect(classification).toEqual({ officialLineup: true }); return { observationId: "lineup-1", receiptHash: "sha256:lineup" }; }, issueLineupForecast: issue,
      now: new Date("2026-09-12T16:00:00.000Z"),
    });
    expect(order).toEqual(["capability", "circuit", "reserve", "factory", "persist"]);
    expect(result).toMatchObject({ status: "completed", observationId: "lineup-1", forecastId: "forecast-lineup-v1" });
    expect(issue).toHaveBeenCalledWith({ fixtureId: "fixture-1", cutoff: "2026-09-12T17:00:00.000Z", officialLineupObservationId: "lineup-1", receiptHash: "sha256:lineup" });
  });

  it("does not classify unofficial or wrong-fixture lineup evidence as official", async () => {
    const classifications: unknown[] = [];
    const issue = vi.fn(async () => "never");
    const base = {
      fixtureId: "fixture-1", endpoint: "LINEUPS" as const, cutoff: "2026-09-12T17:00:00.000Z",
      readCapability: async () => ({ supported: true, expiresAt: null }), readCircuit: async () => "CLOSED" as const,
      reserve: async () => ({ reserved: true }),
      persist: async (_observation: unknown, classification: unknown) => { classifications.push(classification); return { observationId: "lineup-1", receiptHash: "sha256:lineup" }; },
      issueLineupForecast: issue, now: new Date("2026-09-12T16:55:00.000Z"),
    };

    await runEnrichmentJob({ ...base, providerFactory: () => ({ fetch: async () => ({ state: "observed" as const, capturedAt: "2026-09-12T16:50:00.000Z", payload: { fixtureId: "fixture-1", status: "PROVISIONAL", players: ["p1"] } }) }) });
    await runEnrichmentJob({ ...base, providerFactory: () => ({ fetch: async () => ({ state: "observed" as const, capturedAt: "2026-09-12T16:50:00.000Z", payload: { fixtureId: "fixture-2", status: "OFFICIAL_CONFIRMED", players: ["p1"] } }) }) });

    expect(classifications).toEqual([{ officialLineup: false }, { officialLineup: false }]);
    expect(issue).not.toHaveBeenCalled();
  });

  it("denies before provider construction and distinguishes observed empty", async () => {
    const factory = vi.fn(() => ({ fetch: async () => ({}) }));
    expect(await runEnrichmentJob({ fixtureId: "f", endpoint: "LINEUPS", cutoff: "2026-09-12T17:00:00.000Z", readCapability: async () => null, readCircuit: async () => "CLOSED", reserve: async () => ({ reserved: true }), providerFactory: factory, persist: async () => ({ observationId: "x", receiptHash: "x" }), now: new Date("2026-09-12T16:00:00.000Z") })).toEqual({ status: "denied", reason: "UNKNOWN_CAPABILITY" });
    expect(factory).not.toHaveBeenCalled();
    expect(parseApiFootballEnrichmentEnvelope("injuries", { get: "injuries", parameters: { fixture: "1" }, errors: [], results: 0, paging: { current: 1, total: 1 }, response: [] }, { fixture: "1" })).toMatchObject({ state: "observed-empty", payload: null });
  });

  it("schedules bounded deterministic optional jobs without crossing critical headroom", async () => {
    expect(createEnrichmentSchedule({ fixtureId: "fixture-1", kickoffUtc: "2026-09-12T18:00:00.000Z", policyVersion: "enrichment-v1" }).map((job) => job.endpoint)).toEqual(["LINEUPS", "INJURIES", "ODDS", "STATISTICS"]);
    expect(createEnrichmentJobId({ fixtureId: "fixture-1", endpoint: "ODDS", cutoff: "2026-09-12T17:00:00.000Z", policyVersion: "enrichment-v1" })).toBe("enrichment-v1:fixture-1:ODDS:2026-09-12T17:00:00.000Z");
    const factory = vi.fn(() => ({ fetch: async () => ({ state: "observed" as const, capturedAt: "2026-09-12T16:00:00.000Z", payload: { bookmaker: "provider-feed", price: "2.10" } }) }));
    expect(await runEnrichmentJob({ fixtureId: "fixture-1", endpoint: "ODDS", cutoff: "2026-09-12T17:00:00.000Z", readCapability: async () => ({ supported: true, expiresAt: null }), readCircuit: async () => "CLOSED", reserve: async () => ({ reserved: false, reason: "CRITICAL_HEADROOM" }), providerFactory: factory, persist: async () => ({ observationId: "never", receiptHash: "never" }) })).toEqual({ status: "denied", reason: "BUDGET_PROTECTED" });
    expect(factory).not.toHaveBeenCalled();
  });
});
