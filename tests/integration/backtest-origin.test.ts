import { describe, expect, it } from "vitest";

import {
  ForecastOrchestrator,
  currentForecastConfigHash,
  type EvidenceProjectionDto,
  type ForecastOrchestratorRepository,
} from "@bet-stats/domain";
import {
  BACKTEST_LIMITS,
  admitBacktestPlan,
  createBacktestJob,
  runBacktestPlan,
  runBacktestOrigin,
  type BacktestReceiptRepository,
} from "../../workers/data-sync/src/jobs/backtests.js";

const cutoff = "2026-08-01T12:00:00.000Z";
const source = {
  fixtureId: "history-1",
  effectiveAt: "2026-07-20T12:00:00.000Z",
  observedAt: "2026-07-20T12:05:00.000Z",
  sourceUpdatedAt: null,
  payloadHash: "source-hash",
  payloadBytes: 42,
};

function projection(teamId: string, buildId: string, sourceRef = source): EvidenceProjectionDto {
  const component = (kind: "form5" | "homeStrength" | "awayStrength") => ({
    kind,
    value: 1.5,
    unit: "points-per-match" as const,
    sampleSize: 5,
    limitation: null,
    sourceRefs: [sourceRef],
  });
  return {
    teamId,
    requestedAsOf: cutoff,
    resolvedAsOfUtc: cutoff,
    cutoffBoundary: { observedAt: cutoff },
    state: "COMPLETE",
    freshness: "FRESH",
    buildId,
    publishedAt: cutoff,
    receipt: {
      requestedAsOf: cutoff,
      resolvedAsOf: cutoff,
      configVersion: "evidence-v1",
      sourceWindow: { requestedFrom: null, requestedTo: cutoff, returnedFrom: sourceRef.effectiveAt, returnedTo: sourceRef.effectiveAt },
      inputs: [sourceRef],
    },
    coverage: { requestedFrom: null, requestedTo: cutoff, returnedFrom: sourceRef.effectiveAt, returnedTo: sourceRef.effectiveAt },
    components: {
      goalRates: { kind: "goalRates", value: { for: 1.5, against: 1.1 }, unit: "goals-per-match", sampleSize: 5, limitation: null, sourceRefs: [sourceRef] },
      elo: { kind: "elo", value: 1500, unit: "rating-points", sampleSize: 5, limitation: null, sourceRefs: [sourceRef] },
      form5: component("form5"),
      homeStrength: component("homeStrength"),
      awayStrength: component("awayStrength"),
      restDays: { kind: "restDays", value: 7, unit: "days", sampleSize: 1, limitation: null, sourceRefs: [sourceRef] },
    },
  };
}

function repository(trace: string[], sourceRef = source): ForecastOrchestratorRepository {
  return {
    assertEligible: async () => { trace.push("assertEligible"); },
    findFixture: async () => {
      trace.push("findFixture");
      return { id: "fixture-1", homeTeamId: "home", awayTeamId: "away", kickoffUtc: "2026-08-01T18:00:00.000Z", canonicalIdentityResolved: true };
    },
    findEvidence: async (teamId) => {
      trace.push(`resolveTeamEvidence:${teamId}:${cutoff}`);
      return projection(teamId, `${teamId}-build`, sourceRef);
    },
    findOfficialLineup: async () => { trace.push("findOfficialLineup"); return null; },
    publish: async (draft) => { trace.push(`publish:${draft.id}`); return draft; },
  };
}

describe("rolling-origin backtest", () => {
  it("uses the production-equivalent origin with identical call trace and receipt identity", async () => {
    const liveTrace: string[] = [];
    const backtestTrace: string[] = [];
    const orchestrator = new ForecastOrchestrator();
    const input = { fixtureId: "fixture-1", asOf: cutoff, kind: "PRE_MATCH" as const, modelVersion: "poisson-ensemble-v1" as const, configHash: currentForecastConfigHash(), initiator: { type: "production" as const, correlationId: "live-1" } };

    const live = await orchestrator.run(input, repository(liveTrace));
    const replay = await runBacktestOrigin({
      orchestrator,
      repository: repository(backtestTrace),
      window: { id: "window-1", trainingEndsAt: "2026-07-31T23:59:59.999Z", forecastCutoff: cutoff, fixtureId: "fixture-1" },
      modelVersion: input.modelVersion,
      configHash: input.configHash,
      correlationId: "backtest-1",
    });

    expect(backtestTrace).toEqual(liveTrace);
    expect(replay.forecast).toMatchObject({
      id: live.id,
      inputHash: live.inputHash,
      evidenceFingerprint: live.evidenceFingerprint,
      modelHash: live.modelHash,
      configHash: live.configHash,
      receipt: { forecastSnapshotId: live.receipt.forecastSnapshotId, evidenceBuildIds: live.receipt.evidenceBuildIds },
    });
  });

  it("rejects future evidence with LEAKAGE_DETECTED before publication or score", async () => {
    const future = { ...source, observedAt: "2026-08-01T12:00:00.001Z" };
    const trace: string[] = [];
    await expect(runBacktestOrigin({
      orchestrator: new ForecastOrchestrator(),
      repository: repository(trace, future),
      window: { id: "window-poison", trainingEndsAt: "2026-07-31T23:59:59.999Z", forecastCutoff: cutoff, fixtureId: "fixture-1" },
      modelVersion: "poisson-ensemble-v1",
      configHash: currentForecastConfigHash(),
      correlationId: "backtest-poison",
    })).rejects.toMatchObject({ code: "LEAKAGE_DETECTED" });
    expect(trace.some((entry) => entry.startsWith("publish:"))).toBe(false);
  });

  it("admits only bounded chronological plans and rejects random split vocabulary", () => {
    const windows = [
      { id: "w-1", fixtureId: "fixture-1", trainingEndsAt: "2026-07-01T00:00:00.000Z", forecastCutoff: "2026-07-02T00:00:00.000Z" },
      { id: "w-2", fixtureId: "fixture-2", trainingEndsAt: "2026-07-02T00:00:00.000Z", forecastCutoff: "2026-07-03T00:00:00.000Z" },
    ];
    const admitted = admitBacktestPlan({ id: "plan-1", version: "rolling-origin-v1", modelVersion: "poisson-ensemble-v1", configHash: currentForecastConfigHash(), rangeFrom: "2026-07-01T00:00:00.000Z", rangeTo: "2026-07-03T00:00:00.000Z", concurrency: 2, windows });
    expect(admitted.windows.map((window) => window.id)).toEqual(["w-1", "w-2"]);
    expect(createBacktestJob(admitted)).toMatchObject({ name: "rolling-origin", jobId: expect.stringMatching(/^backtest:/), attempts: 3 });
    expect(() => admitBacktestPlan({ ...admitted, split: "random" } as never)).toThrowError(expect.objectContaining({ code: "RANDOM_SPLIT_REJECTED" }));
    expect(() => admitBacktestPlan({ ...admitted, windows: [...windows].reverse() })).toThrowError(expect.objectContaining({ code: "LEAKAGE_DETECTED" }));
    expect(() => admitBacktestPlan({ ...admitted, concurrency: BACKTEST_LIMITS.maxConcurrency + 1 })).toThrowError(expect.objectContaining({ code: "BACKTEST_LIMIT_EXCEEDED" }));
  });

  it("converges duplicate delivery by deterministic plan and window identities", async () => {
    const plan = admitBacktestPlan({ id: "plan-repeat", version: "rolling-origin-v1", modelVersion: "poisson-ensemble-v1", configHash: currentForecastConfigHash(), rangeFrom: "2026-07-01T00:00:00.000Z", rangeTo: cutoff, concurrency: 1, windows: [{ id: "w-repeat", fixtureId: "fixture-1", trainingEndsAt: "2026-07-31T00:00:00.000Z", forecastCutoff: cutoff }] });
    const plans = new Map<string, unknown>();
    const windows = new Map<string, { state: string; forecastSnapshotId?: string }>();
    const receipts: BacktestReceiptRepository = {
      createPlan: async (receipt) => { plans.set(receipt.id, receipt); },
      findPlan: async (id) => plans.get(id) as never,
      claimWindow: async (receipt) => {
        const existing = windows.get(receipt.id);
        if (existing?.state === "SUCCEEDED") return { claimed: false, receipt: existing as never };
        windows.set(receipt.id, { state: "RUNNING" });
        return { claimed: true, receipt: { ...receipt, state: "RUNNING" } };
      },
      completeWindow: async (id, output) => { windows.set(id, { state: "SUCCEEDED", forecastSnapshotId: output.forecastSnapshotId }); },
      failWindow: async (id) => { windows.set(id, { state: "FAILED" }); },
      completePlan: async () => undefined,
    };
    const execute = () => runBacktestPlan({ plan, receipts, orchestrator: new ForecastOrchestrator(), repository: repository([]), correlationId: "repeat" });
    const first = await execute();
    const retry = await execute();
    expect(first).toMatchObject({ state: "SUCCEEDED", completedWindowIds: ["w-repeat"] });
    expect(retry).toMatchObject({ state: "SUCCEEDED", completedWindowIds: ["w-repeat"], duplicateWindowIds: ["w-repeat"] });
    expect(windows.size).toBe(1);
  });
});
