import { describe, expect, it, vi } from "vitest";

import { EligibilityGuard } from "../../apps/api/src/modules/eligibility/eligibility.guard.js";
import { EvaluationController } from "../../apps/api/src/modules/evaluation/evaluation.controller.js";
import { EvaluationService, type EvaluationRepository } from "../../apps/api/src/modules/evaluation/evaluation.service.js";
import type { RawModelComparison } from "@bet-stats/domain";

const from = "2026-07-01T00:00:00.000Z";
const to = "2026-07-06T00:00:00.000Z";

const windows = [
  { fixtureId: "fixture-1", forecastCutoff: "2026-07-02T00:00:00.000Z", evaluationAsOf: "2026-07-04T00:00:00.000Z" },
  { fixtureId: "fixture-2", forecastCutoff: "2026-07-03T00:00:00.000Z", evaluationAsOf: "2026-07-05T00:00:00.000Z" },
];

const compared: RawModelComparison = {
  available: true,
  market: "ONE_X_TWO",
  sampleSize: 2,
  windows,
  left: { planId: "plan-v1", planHash: "hash-v1", modelVersion: "poisson-ensemble-v1", configHash: "sha256:config-v1", sampleSize: 2, brierScore: 0.6, logLoss: 0.9 },
  right: { planId: "plan-dc", planHash: "hash-dc", modelVersion: "dixon-coles-ensemble-v1", configHash: "sha256:config-v2", sampleSize: 2, brierScore: 0.55, logLoss: 0.85 },
  deltas: { brierScore: -0.05, logLoss: -0.05 },
};

function setup(raw: RawModelComparison | (() => Promise<RawModelComparison>) = compared) {
  const repository: EvaluationRepository = {
    loadCohort: vi.fn(async () => { throw new Error("not used"); }),
    enumerateAvailableCohorts: vi.fn(async () => []),
    comparePlans: vi.fn(typeof raw === "function" ? raw : async () => raw),
    listValueCandidates: vi.fn(async () => ({ items: [], nextCursor: null, pageTotals: { count: 0, stakeUnits: "0", profitUnits: "0" } })),
  };
  const service = new EvaluationService(repository);
  return { repository, controller: new EvaluationController(service), service };
}

const validQuery = { leftPlanId: "plan-v1", rightPlanId: "plan-dc", market: "ONE_X_TWO", from, to };

type Body = { available: boolean; reason?: string; receipt?: Record<string, unknown> };

async function call(controller: EvaluationController, query: Record<string, unknown>): Promise<{ status: number; headers: Record<string, string>; body: Body }> {
  const headers: Record<string, string> = {};
  let status = 0;
  let body: unknown;
  const response = {
    status(code: number) { status = code; return this; },
    setHeader(name: string, value: string) { headers[name] = value; },
    json(value: unknown) { body = value; return value; },
    end() { return undefined; },
  };
  await controller.modelComparison(query, response as never);
  return { status, headers, body: body as Body };
}

describe("model comparison API boundary", () => {
  it("is guarded and returns a reproducible receipt for two completed plans", async () => {
    expect(Reflect.getMetadata("__guards__", EvaluationController)).toContain(EligibilityGuard);
    const { controller, repository } = setup();
    const first = await call(controller, validQuery);
    expect(first.status).toBe(200);
    expect(first.headers["Cache-Control"]).toBe("private, no-store, max-age=0");
    expect(first.body.available).toBe(true);
    const receipt = first.body.receipt!;
    expect(receipt).toMatchObject({ version: "model-comparison-v1", market: "ONE_X_TWO", from, to, verdict: "BETTER" });
    expect((receipt.left as { modelVersion: string }).modelVersion).toBe("poisson-ensemble-v1");
    expect((receipt.right as { modelVersion: string }).modelVersion).toBe("dixon-coles-ensemble-v1");
    expect(receipt.windowsDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(repository.comparePlans).toHaveBeenCalledWith({ leftPlanId: "plan-v1", rightPlanId: "plan-dc", market: "ONE_X_TWO", from, to });

    const second = await call(controller, validQuery);
    expect(second.body.receipt!.windowsDigest).toBe(receipt.windowsDigest);
  });

  it("answers an unfinished plan with available:false at HTTP 200 instead of an error", async () => {
    const { controller } = setup({ available: false, reason: "PLAN_NOT_COMPLETE" });
    const response = await call(controller, validQuery);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ available: false, reason: "PLAN_NOT_COMPLETE" });
  });

  it("refuses mismatched cohorts and identical plans without inventing a winner", async () => {
    const { controller } = setup({ available: false, reason: "COHORT_MISMATCH" });
    expect((await call(controller, validQuery)).body).toEqual({ available: false, reason: "COHORT_MISMATCH" });
    await expect(call(controller, { ...validQuery, rightPlanId: "plan-v1" })).rejects.toThrow("IDENTICAL_PLANS");
  });

  it("rejects unknown query keys, the 'all' market, bad periods and array parameters", async () => {
    const { controller } = setup();
    await expect(call(controller, { ...validQuery, verbose: "1" })).rejects.toThrow("INVALID_COMPARISON_QUERY");
    await expect(call(controller, { ...validQuery, market: "all" })).rejects.toThrow("INVALID_MARKET");
    await expect(call(controller, { ...validQuery, market: "asian-handicap" })).rejects.toThrow("INVALID_MARKET");
    await expect(call(controller, { ...validQuery, to: from })).rejects.toThrow("INVALID_COMPARISON_PERIOD");
    await expect(call(controller, { ...validQuery, to: "2027-09-01T00:00:00.000Z" })).rejects.toThrow("INVALID_COMPARISON_PERIOD");
    await expect(call(controller, { ...validQuery, market: ["ONE_X_TWO", "BTTS"] })).rejects.toThrow("INVALID_COMPARISON_QUERY");
    await expect(call(controller, { ...validQuery, from: "2026-07-01" })).rejects.toThrow("INVALID_FROM");
    await expect(call(controller, { ...validQuery, leftPlanId: "" })).rejects.toThrow("INVALID_LEFTPLANID");
  });

  it("never trusts a receipt the repository could not ground in its windows", async () => {
    const { controller } = setup({ ...compared, windows: [] });
    const response = await call(controller, validQuery);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ available: false, reason: "EMPTY_COHORT" });
  });
});
