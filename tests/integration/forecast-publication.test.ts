import { describe, expect, it } from "vitest";

const cutoff = "2026-09-06T12:00:00.000Z";
const source = {
  fixtureId: "history-1",
  effectiveAt: "2026-09-01T12:00:00.000Z",
  observedAt: "2026-09-01T12:05:00.000Z",
  sourceUpdatedAt: null,
  payloadHash: "sha256:source",
  payloadBytes: 10,
};

function projection(teamId: string) {
  const component = (kind: string, value: unknown, sampleSize = 5) => ({ kind, value, unit: "test", sampleSize, limitation: null, sourceRefs: [source] });
  return {
    teamId,
    requestedAsOf: cutoff,
    resolvedAsOfUtc: cutoff,
    cutoffBoundary: { observedAt: cutoff },
    state: "COMPLETE" as const,
    freshness: "FRESH" as const,
    buildId: `${teamId}-build`,
    publishedAt: cutoff,
    receipt: { requestedAsOf: cutoff, resolvedAsOf: cutoff, configVersion: "evidence-v1", sourceWindow: { requestedFrom: null, requestedTo: cutoff, returnedFrom: source.effectiveAt, returnedTo: source.effectiveAt }, inputs: [source] },
    coverage: { eligibleFixtureCount: 5, earliestKickoff: source.effectiveAt, latestKickoff: source.effectiveAt },
    components: {
      goalRates: component("goalRates", { for: 1.6, against: 1.1 }),
      elo: component("elo", 1510),
      form5: component("form5", 1.8),
      homeStrength: component("homeStrength", 1.8),
      awayStrength: component("awayStrength", 1.2),
      restDays: component("restDays", 7, 1),
    },
  };
}

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

  it("binds the exact official lineup observation into immutable forecast identity and receipt", async () => {
    const { generateForecast } = await import("../../apps/api/src/modules/forecasts/forecasts.service.js");
    let observationId = "lineup-observation-1";
    const repository = {
      assertEligible: async () => undefined,
      findFixture: async () => ({ id: "fixture-1", homeTeamId: "home", awayTeamId: "away", kickoffUtc: "2026-09-07T12:00:00.000Z", canonicalIdentityResolved: true }),
      findEvidence: async (teamId: string) => projection(teamId),
      findOfficialLineup: async () => ({ id: observationId }),
      publish: async (draft: any) => draft,
    };
    const request = { fixtureId: "fixture-1", kind: "LINEUP_CONFIRMED", cutoff };

    const first = await generateForecast(request, repository);
    const retry = await generateForecast(request, repository);
    observationId = "lineup-observation-2";
    const corrected = await generateForecast(request, repository);

    expect(retry.id).toBe(first.id);
    expect(retry.inputHash).toBe(first.inputHash);
    expect(corrected.id).not.toBe(first.id);
    expect(corrected.inputHash).not.toBe(first.inputHash);
    expect(first.officialLineupObservationId).toBe("lineup-observation-1");
    expect(first.receipt.officialLineupObservationId).toBe("lineup-observation-1");
    expect(corrected.receipt.officialLineupObservationId).toBe("lineup-observation-2");
  });
});
