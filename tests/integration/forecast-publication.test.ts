import { describe, expect, it } from "vitest";

describe("scheduled forecast publication", () => {
  it("creates deterministic INITIAL and PRE_MATCH jobs from frozen exact cutoffs", async () => {
    const { createForecastPublicationJob, createForecastPublicationJobId } = await import("../../workers/data-sync/src/jobs/forecasts.js");
    const initial = createForecastPublicationJob({ fixtureId: "fixture-1", kind: "INITIAL", cutoff: "2026-09-06T10:00:00.000Z", modelVersion: "poisson-ensemble-v1", configHash: "config-a", evidenceBuildIds: ["home-a", "away-a"] });
    const retry = createForecastPublicationJob({ fixtureId: "fixture-1", kind: "INITIAL", cutoff: "2026-09-06T10:00:00.000Z", modelVersion: "poisson-ensemble-v1", configHash: "config-a", evidenceBuildIds: ["away-a", "home-a"] });
    expect(initial.jobId).toBe(retry.jobId);
    expect(initial.jobId).toBe(createForecastPublicationJobId(initial.data));
    expect(createForecastPublicationJob({ ...initial.data, evidenceBuildIds: ["away-b", "home-a"] }).jobId).not.toBe(initial.jobId);
  });

  it("keeps LINEUP_CONFIRMED dormant without a durable official observation", async () => {
    const { planForecastPublication } = await import("../../workers/data-sync/src/jobs/forecasts.js");
    const base = { fixtureId: "fixture-1", kickoffUtc: "2026-09-07T12:00:00.000Z", initialEligibleCutoff: "2026-09-06T10:00:00.000Z", modelVersion: "poisson-ensemble-v1", configHash: "config-a", evidenceBuildIdsAt: async () => ["home-a", "away-a"] as const };
    const dormant = await planForecastPublication({ ...base, officialLineupAt: async () => null });
    expect(dormant.map((job) => job.data.kind)).toEqual(["INITIAL", "PRE_MATCH"]);
    const confirmed = await planForecastPublication({ ...base, officialLineupAt: async () => ({ id: "lineup-1", confirmedAt: "2026-09-07T11:00:00.000Z" }) });
    expect(confirmed.map((job) => job.data.kind)).toEqual(["INITIAL", "PRE_MATCH", "LINEUP_CONFIRMED"]);
  });

  it("delegates one complete request to the authoritative publisher and never publishes a partial result", async () => {
    const { runForecastPublicationJob } = await import("../../workers/data-sync/src/jobs/forecasts.js");
    const data = { fixtureId: "fixture-1", kind: "PRE_MATCH" as const, cutoff: "2026-09-07T06:00:00.000Z", modelVersion: "poisson-ensemble-v1" as const, configHash: "config-a", evidenceBuildIds: ["away-a", "home-a"] };
    const calls: unknown[] = [];
    await expect(runForecastPublicationJob(data, { publish: async (request) => { calls.push(request); throw new Error("CALCULATION_FAILED"); } })).rejects.toThrow("CALCULATION_FAILED");
    expect(calls).toEqual([{ fixtureId: "fixture-1", kind: "PRE_MATCH", cutoff: data.cutoff }]);
  });
});
