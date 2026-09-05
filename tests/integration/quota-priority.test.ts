import { describe, expect, it } from "vitest";

async function priorityBudget(): Promise<Record<string, unknown>> {
  try {
    return await import(/* @vite-ignore */ new URL("../../packages/domain/src/request-budget.js", import.meta.url).href);
  } catch (error) {
    throw new Error("Missing Phase 2 production symbol: reservePriorityRequest in packages/domain/src/priority-budget.ts", { cause: error });
  }
}

async function standingsJob(): Promise<Record<string, unknown>> {
  try {
    return await import(/* @vite-ignore */ new URL("../../workers/data-sync/src/jobs/standings.js", import.meta.url).href);
  } catch (error) {
    throw new Error("Missing Phase 2 production symbol: runStandingsSync in workers/data-sync/src/jobs/standings.ts", { cause: error });
  }
}

describe("priority request budget", () => {
  it("D-07/D-09 preserves critical headroom while rejecting standard and optional lanes", async () => {
    const { reservePriorityRequest } = await priorityBudget() as { reservePriorityRequest: (input: Record<string, unknown>) => Promise<Record<string, unknown>> };
    const base = { provider: "football-data.org", resetDate: "2026-08-29", configuredAllowance: 10, criticalHeadroom: 3 };
    expect(await reservePriorityRequest({ ...base, lane: "optional", reserved: 7, jobKey: "optional-1" })).toMatchObject({ reserved: false, reason: "CRITICAL_HEADROOM" });
    expect(await reservePriorityRequest({ ...base, lane: "critical", reserved: 7, jobKey: "critical-1" })).toMatchObject({ reserved: true });
  });

  it("PIPE-03 converges atomically under concurrency with stable job identity and zero allowance", async () => {
    const { reservePriorityRequest } = await priorityBudget() as { reservePriorityRequest: (input: Record<string, unknown>) => Promise<Record<string, unknown>> };
    const input = { provider: "football-data.org", resetDate: "2026-08-29", endpointFamily: "RESULTS", lane: "critical", configuredAllowance: 1, jobKey: "results-pl-2026-08-29" };
    const results = await Promise.all(Array.from({ length: 20 }, () => reservePriorityRequest(input)));
    expect(results.filter((result) => result.reserved && !result.reused)).toHaveLength(1);
    expect(await reservePriorityRequest({ ...input, configuredAllowance: 0, jobKey: "zero" })).toMatchObject({ reserved: false, reason: "ALLOWANCE_EXHAUSTED" });
  });

  it("rejects unknown reset semantics and never widens configured allowance from runtime headers", async () => {
    const { reservePriorityRequest } = await priorityBudget() as { reservePriorityRequest: (input: Record<string, unknown>) => Promise<Record<string, unknown>> };
    const unknownReset = await reservePriorityRequest({ provider: "football-data.org", endpointFamily: "STANDINGS", lane: "standard", configuredAllowance: 10, resetTimezone: null, runtimeAllowance: 100, jobKey: "standings-unknown-reset" });
    expect(unknownReset).toMatchObject({ reserved: false, reason: "UNKNOWN_RESET_SEMANTICS" });
    const capped = await reservePriorityRequest({ provider: "football-data.org", resetDate: "2026-08-29", endpointFamily: "RESULTS", lane: "critical", configuredAllowance: 10, runtimeAllowance: 100, reserved: 9, jobKey: "results-capped" });
    expect(capped).toMatchObject({ effectiveAllowance: 10 });
  });

  it("runs standings through reservation before provider construction and persists one complete capture", async () => {
    const { runStandingsSync } = await standingsJob() as { runStandingsSync: (input: Record<string, unknown>) => Promise<Record<string, unknown>> };
    const events: string[] = [];
    const snapshot = { rows: [{ teamExternalId: "team-1" }, { teamExternalId: "team-2" }] };
    const reserve = async () => { events.push("reserved"); return { reserved: true, reused: false }; };
    const providerFactory = () => {
      events.push("constructed");
      return { fetchCompetitionStandings: async () => { events.push("called"); return snapshot; } };
    };
    const persist = async (value: unknown) => { events.push("persisted"); expect(value).toBe(snapshot); };

    const result = await runStandingsSync({
      provider: "football-data.org",
      endpoint: "STANDINGS",
      capability: "SUPPORTED",
      circuit: "CLOSED",
      lane: "standard",
      allowance: 10,
      criticalHeadroom: 3,
      resetTimezone: "UTC",
      jobKey: "standings-pl-2026",
      coverage: { competitionCode: "PL" },
      reserve,
      providerFactory,
      persist,
    });

    expect(result).toMatchObject({ status: "completed" });
    expect(events).toEqual(["reserved", "constructed", "called", "persisted"]);
  });
});
