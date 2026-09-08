import { describe, expect, it, vi } from "vitest";

import { EligibilityGuard } from "../../apps/api/src/modules/eligibility/eligibility.guard.js";
import {
  EvaluationController,
  type EvaluationHttpResponse,
} from "../../apps/api/src/modules/evaluation/evaluation.controller.js";
import {
  EvaluationService,
  encodeCandidateCursor,
  type EvaluationRepository,
  type ScorecardCohort,
} from "../../apps/api/src/modules/evaluation/evaluation.service.js";

const bounded = {
  modelVersion: "model-v1",
  competitionId: "premier-league",
  market: "ONE_X_TWO",
  from: "2026-01-01T00:00:00.000Z",
  to: "2026-02-01T00:00:00.000Z",
} as const;

function cohort(overrides: Partial<ScorecardCohort> = {}): ScorecardCohort {
  return {
    cohortIdentity: bounded,
    health: { state: "AVAILABLE", reasons: [], performanceClaim: "QUALIFIED_EVIDENCE" },
    denominators: { fixtureCount: 50, forecastCount: 50, eventCount: 150, valueCount: 2 },
    metrics: { meanBrierScore: 0.42, meanLogLoss: 0.64 },
    reliability: { policyId: "sha256:reliability", buckets: [] },
    financial: { count: 2, totalStakedUnits: "2", totalProfitUnits: "0.5", roi: "0.25", yield: "0.25", policyId: "flat-one-unit-v1" },
    clv: { status: "UNAVAILABLE", reason: "NO_COMPARABLE_CLOSE", comparableCount: 0 },
    receipts: { formulaId: "sha256:formula", cohortPolicyId: "sha256:cohort" },
    ...overrides,
  };
}

function setup(rows: ScorecardCohort[] = [cohort()]) {
  const repository: EvaluationRepository = {
    loadCohort: vi.fn(async (identity) => rows.find((row) => JSON.stringify(row.cohortIdentity) === JSON.stringify(identity)) ?? cohort({
      cohortIdentity: identity,
      health: { state: "UNAVAILABLE", reasons: ["NO_SCOREABLE_FIXTURES"], performanceClaim: null },
      denominators: { fixtureCount: 0, forecastCount: 0, eventCount: 0, valueCount: 0 },
      metrics: null,
    })),
    enumerateAvailableCohorts: vi.fn(async () => rows),
    listValueCandidates: vi.fn(async () => ({ items: [], nextCursor: null, pageTotals: { count: 0, stakeUnits: "0", profitUnits: "0" } })),
  };
  const service = new EvaluationService(repository);
  return { repository, service, controller: new EvaluationController(service) };
}

describe("evaluation scorecard API boundary", () => {
  it("guards the controller and returns one exact canonical cohort with server receipts", async () => {
    expect(Reflect.getMetadata("__guards__", EvaluationController)).toContain(EligibilityGuard);
    const { controller, repository } = setup();
    const response = await controller.scorecard(bounded) as EvaluationHttpResponse<ScorecardCohort>;
    expect(response.statusCode).toBe(200);
    expect(response.headers["Cache-Control"]).toBe("private, no-store, max-age=0");
    expect(response.body).toMatchObject({ cohortIdentity: bounded, health: { state: "AVAILABLE" }, receipts: { formulaId: "sha256:formula" } });
    expect(repository.loadCohort).toHaveBeenCalledWith(bounded);
  });

  it("rejects duplicate, unknown, malformed UTC and unbounded filters before repository work", async () => {
    const { controller, repository } = setup();
    for (const query of [
      { ...bounded, market: ["ONE_X_TWO", "BTTS"] },
      { ...bounded, unknown: "x" },
      { ...bounded, from: "2026-01-01" },
      { ...bounded, to: "2028-01-01T00:00:00.000Z" },
    ]) await expect(controller.scorecard(query)).rejects.toThrow();
    expect(repository.loadCohort).not.toHaveBeenCalled();
  });

  it("redirects omitted filters to the largest AVAILABLE cohort with canonical tuple tie-break", async () => {
    const smaller = cohort({ cohortIdentity: { ...bounded, modelVersion: "z-model" }, denominators: { fixtureCount: 60, forecastCount: 60, eventCount: 180, valueCount: 0 } });
    const first = cohort({ cohortIdentity: { ...bounded, modelVersion: "a-model" }, denominators: { fixtureCount: 70, forecastCount: 70, eventCount: 210, valueCount: 0 } });
    const tied = cohort({ cohortIdentity: { ...bounded, modelVersion: "b-model" }, denominators: { fixtureCount: 70, forecastCount: 70, eventCount: 210, valueCount: 0 } });
    const { controller } = setup([smaller, tied, first]);
    const response = await controller.scorecard({ from: bounded.from, to: bounded.to }) as EvaluationHttpResponse<null>;
    expect(response.statusCode).toBe(308);
    expect(response.headers.Location).toContain("modelVersion=a-model");
    expect(response.headers.Location).toContain("competitionId=premier-league");
  });

  it("keeps the bounded all-dimensions cohort LIMITED when no candidate qualifies", async () => {
    const limited = cohort({
      cohortIdentity: { ...bounded, modelVersion: "all", competitionId: "all", market: "all" },
      health: { state: "LIMITED", reasons: ["COHORT_BELOW_MINIMUM"], performanceClaim: null },
      denominators: { fixtureCount: 3, forecastCount: 3, eventCount: 9, valueCount: 0 },
    });
    const { controller } = setup([limited]);
    const response = await controller.scorecard({ from: bounded.from, to: bounded.to }) as EvaluationHttpResponse<null>;
    expect(response.statusCode).toBe(308);
    expect(response.headers.Location).toContain("modelVersion=all");
    expect(response.headers.Location).toContain("competitionId=all");
    expect(response.headers.Location).toContain("market=all");
  });

  it("uses an opaque cohort-bound cursor and reconciles stable candidate pages", async () => {
    const rows = [
      { id: "candidate-b", valueReceiptId: "value-b", settlementReceiptId: "settlement-b", resultVersionId: "result-b", selection: "AWAY", decimalOdds: "3.1", outcome: "LOSS", stakeUnits: "1", profitUnits: "-1", clv: { status: "UNAVAILABLE", reason: "NO_COMPARABLE_CLOSE", value: null }, settledAt: "2026-01-10T12:00:00.000Z" },
      { id: "candidate-a", valueReceiptId: "value-a", settlementReceiptId: "settlement-a", resultVersionId: "result-a", selection: "HOME", decimalOdds: "2.5", outcome: "WIN", stakeUnits: "1", profitUnits: "1.5", clv: { status: "AVAILABLE", reason: null, value: "0.04" }, settledAt: "2026-01-10T12:00:00.000Z" },
    ] as const;
    const repository: EvaluationRepository = {
      loadCohort: vi.fn(async () => cohort()),
      enumerateAvailableCohorts: vi.fn(async () => [cohort()]),
      listValueCandidates: vi.fn(async (_identity, cursor, limit) => {
        const start = cursor ? rows.findIndex((row) => row.id === cursor.id) + 1 : 0;
        const items = rows.slice(start, start + limit);
        return { items, nextCursor: start + limit < rows.length ? { settledAt: items.at(-1)!.settledAt, id: items.at(-1)!.id } : null, pageTotals: { count: items.length, stakeUnits: String(items.length), profitUnits: String(items.reduce((sum, item) => sum + Number(item.profitUnits), 0)) } };
      }),
    };
    const service = new EvaluationService(repository);
    const first = await service.valueCandidates({ ...bounded, limit: "1" });
    expect(first.items.map((row) => row.id)).toEqual(["candidate-b"]);
    expect(first.nextCursor).not.toContain("candidate-b");
    const second = await service.valueCandidates({ ...bounded, limit: "1", cursor: first.nextCursor! });
    expect(second.items.map((row) => row.id)).toEqual(["candidate-a"]);
    expect([first, second].reduce((sum, page) => sum + page.pageTotals.count, 0)).toBe(2);
    await expect(service.valueCandidates({ ...bounded, modelVersion: "other", cursor: first.nextCursor! })).rejects.toThrow("CURSOR_COHORT_MISMATCH");
    await expect(service.valueCandidates({ ...bounded, cursor: "not-a-cursor" })).rejects.toThrow("INVALID_CURSOR");
    expect(encodeCandidateCursor(bounded, { settledAt: rows[0].settledAt, id: rows[0].id })).not.toContain(rows[0].id);
  });
});
