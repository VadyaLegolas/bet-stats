import { describe, expect, it } from "vitest";

import {
  ForecastOrchestrator,
  currentForecastConfigHash,
  forecastConfigHashFor,
  type DixonColesProvenance,
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
const evaluationAsOf = "2026-08-03T12:00:00.000Z";
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
      window: { id: "window-1", trainingEndsAt: "2026-07-31T23:59:59.999Z", forecastCutoff: cutoff, evaluationAsOf, fixtureId: "fixture-1" },
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
      window: { id: "window-poison", trainingEndsAt: "2026-07-31T23:59:59.999Z", forecastCutoff: cutoff, evaluationAsOf, fixtureId: "fixture-1" },
      modelVersion: "poisson-ensemble-v1",
      configHash: currentForecastConfigHash(),
      correlationId: "backtest-poison",
    })).rejects.toMatchObject({ code: "LEAKAGE_DETECTED" });
    expect(trace.some((entry) => entry.startsWith("publish:"))).toBe(false);
  });

  it("admits only bounded chronological plans and rejects random split vocabulary", () => {
    const windows = [
      { id: "w-1", fixtureId: "fixture-1", trainingEndsAt: "2026-07-01T00:00:00.000Z", forecastCutoff: "2026-07-02T00:00:00.000Z", evaluationAsOf: "2026-07-04T00:00:00.000Z" },
      { id: "w-2", fixtureId: "fixture-2", trainingEndsAt: "2026-07-02T00:00:00.000Z", forecastCutoff: "2026-07-03T00:00:00.000Z", evaluationAsOf: "2026-07-05T00:00:00.000Z" },
    ];
    const admitted = admitBacktestPlan({ id: "plan-1", version: "rolling-origin-v1", modelVersion: "poisson-ensemble-v1", configHash: currentForecastConfigHash(), rangeFrom: "2026-07-01T00:00:00.000Z", rangeTo: "2026-07-03T00:00:00.000Z", concurrency: 2, windows });
    expect(admitted.windows.map((window) => window.id)).toEqual(["w-1", "w-2"]);
    expect(createBacktestJob(admitted)).toMatchObject({ name: "rolling-origin", jobId: expect.stringMatching(/^backtest:/), attempts: 3 });
    expect(() => admitBacktestPlan({ ...admitted, split: "random" } as never)).toThrowError(expect.objectContaining({ code: "RANDOM_SPLIT_REJECTED" }));
    expect(() => admitBacktestPlan({ ...admitted, windows: [...windows].reverse() })).toThrowError(expect.objectContaining({ code: "LEAKAGE_DETECTED" }));
    expect(() => admitBacktestPlan({ ...admitted, concurrency: BACKTEST_LIMITS.maxConcurrency + 1 })).toThrowError(expect.objectContaining({ code: "BACKTEST_LIMIT_EXCEEDED" }));
    // IN-02: a config hash that does not belong to the plan's model version is rejected before persist/enqueue.
    expect(() => admitBacktestPlan({ ...admitted, planHash: undefined, configHash: "sha256:not-this-model" })).toThrowError(expect.objectContaining({ code: "BACKTEST_CONFIG_HASH_MISMATCH" }));
    expect(() => admitBacktestPlan({ ...admitted, planHash: undefined, modelVersion: "dixon-coles-ensemble-v1" })).toThrowError(expect.objectContaining({ code: "BACKTEST_CONFIG_HASH_MISMATCH" }));
  });

  it("converges duplicate delivery by deterministic plan and window identities", async () => {
    const plan = admitBacktestPlan({ id: "plan-repeat", version: "rolling-origin-v1", modelVersion: "poisson-ensemble-v1", configHash: currentForecastConfigHash(), rangeFrom: "2026-07-01T00:00:00.000Z", rangeTo: cutoff, concurrency: 1, windows: [{ id: "w-repeat", fixtureId: "fixture-1", trainingEndsAt: "2026-07-31T00:00:00.000Z", forecastCutoff: cutoff, evaluationAsOf }] });
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
      evaluateWindow: async () => ({ resultVersionId: "result-1", settlementReceiptId: "settlement-1", scoreIds: ["score-1"] }),
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

const dcWindow = { id: "w-dc", fixtureId: "fixture-1", trainingEndsAt: "2026-07-31T23:59:59.999Z", forecastCutoff: cutoff, evaluationAsOf };

function dcPlan(id = "plan-dc") {
  return admitBacktestPlan({
    id,
    version: "rolling-origin-v1",
    modelVersion: "dixon-coles-ensemble-v1",
    configHash: forecastConfigHashFor("dixon-coles-ensemble-v1"),
    rangeFrom: "2026-07-01T00:00:00.000Z",
    rangeTo: cutoff,
    concurrency: 1,
    windows: [dcWindow],
  });
}

function zeroRho(windowFrom: string, windowTo: string): Readonly<{ rho: number; provenance: DixonColesProvenance }> {
  return { rho: 0, provenance: { rho: 0, convention: "tau-1x2-v1", method: "insufficient-sample-zero", windowFrom, windowTo, sampleSize: 0, tauMin: 1 } };
}

/** In-memory receipt store that records window outcomes so failures are observable. */
function memoryReceipts() {
  const plans = new Map<string, unknown>();
  const windows = new Map<string, { state: string; code?: string }>();
  const receipts: BacktestReceiptRepository = {
    createPlan: async (receipt) => { plans.set(receipt.id, receipt); },
    findPlan: async (id) => (plans.get(id) ?? null) as never,
    claimWindow: async (receipt) => {
      const existing = windows.get(receipt.id);
      if (existing?.state === "SUCCEEDED") return { claimed: false, receipt: existing as never };
      windows.set(receipt.id, { state: "RUNNING" });
      return { claimed: true, receipt: { ...receipt, state: "RUNNING" } };
    },
    completeWindow: async (id) => { windows.set(id, { state: "SUCCEEDED" }); },
    evaluateWindow: async () => ({ resultVersionId: "result-1", settlementReceiptId: "settlement-1", scoreIds: ["score-1"] }),
    failWindow: async (id, code) => { windows.set(id, { state: "FAILED", code }); },
    completePlan: async () => undefined,
  };
  return { receipts, windows };
}

describe("dixon-coles backtest versioning", () => {
  it("accepts both known versions and rejects unknown ones", () => {
    expect(dcPlan().modelVersion).toBe("dixon-coles-ensemble-v1");
    expect(() => admitBacktestPlan({
      id: "plan-bad",
      version: "rolling-origin-v1",
      modelVersion: "poisson-ensemble-v2",
      configHash: currentForecastConfigHash(),
      rangeFrom: "2026-07-01T00:00:00.000Z",
      rangeTo: cutoff,
      concurrency: 1,
      windows: [dcWindow],
    })).toThrowError(expect.objectContaining({ code: "INVALID_BACKTEST_PLAN" }));
  });

  it("gives V1 and dixon-coles different plan hashes over the same windows", () => {
    const v1 = admitBacktestPlan({ id: "plan-same", version: "rolling-origin-v1", modelVersion: "poisson-ensemble-v1", configHash: currentForecastConfigHash(), rangeFrom: "2026-07-01T00:00:00.000Z", rangeTo: cutoff, concurrency: 1, windows: [dcWindow] });
    expect(v1.planHash).not.toBe(dcPlan("plan-same").planHash);
  });

  it("fits rho at the training boundary, not at the forecast cutoff", async () => {
    const seen: string[] = [];
    const { receipts } = memoryReceipts();
    const plan = dcPlan();
    await runBacktestPlan({
      plan,
      receipts,
      orchestrator: new ForecastOrchestrator(),
      repository: repository([]),
      correlationId: "dc-fit",
      resolveDixonColes: async (window) => {
        seen.push(window.trainingEndsAt);
        return zeroRho(window.trainingEndsAt, window.trainingEndsAt);
      },
    });
    expect(seen).toEqual([dcWindow.trainingEndsAt]);
    expect(Date.parse(seen[0]!)).toBeLessThan(Date.parse(cutoff));
    expect(seen[0]).not.toBe(dcWindow.forecastCutoff);
  });

  it("marks the window FAILED when rho cannot be fitted", async () => {
    const { receipts, windows } = memoryReceipts();
    await expect(runBacktestPlan({
      plan: dcPlan(),
      receipts,
      orchestrator: new ForecastOrchestrator(),
      repository: repository([]),
      correlationId: "dc-null",
      resolveDixonColes: async () => null,
    })).rejects.toMatchObject({ code: "DIXON_COLES_RHO_UNAVAILABLE" });
    expect(windows.get(dcWindow.id)).toEqual({ state: "FAILED", code: "DIXON_COLES_RHO_UNAVAILABLE" });
  });

  it("never resolves dixon-coles for a V1 plan", async () => {
    let calls = 0;
    const { receipts } = memoryReceipts();
    const plan = admitBacktestPlan({ id: "plan-v1-only", version: "rolling-origin-v1", modelVersion: "poisson-ensemble-v1", configHash: currentForecastConfigHash(), rangeFrom: "2026-07-01T00:00:00.000Z", rangeTo: cutoff, concurrency: 1, windows: [dcWindow] });
    await runBacktestPlan({
      plan,
      receipts,
      orchestrator: new ForecastOrchestrator(),
      repository: repository([]),
      correlationId: "v1-only",
      resolveDixonColes: async (window) => { calls += 1; return zeroRho(window.trainingEndsAt, window.trainingEndsAt); },
    });
    expect(calls).toBe(0);
  });
});
