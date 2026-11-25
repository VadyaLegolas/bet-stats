import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createPrismaClient, createSettlementPipelineService, type PrismaClient } from "@bet-stats/database";

import { EligibilityGuard } from "../../apps/api/src/modules/eligibility/eligibility.guard.js";
import {
  EvaluationController,
  type EvaluationHttpResponse,
} from "../../apps/api/src/modules/evaluation/evaluation.controller.js";
import {
  EvaluationService,
  createPrismaEvaluationRepository,
  encodeCandidateCursor,
  type EvaluationRepository,
  type ScorecardCohort,
} from "../../apps/api/src/modules/evaluation/evaluation.service.js";
import { buildCoreValueReceipt, buildExtendedValueReceipt, exactScoreSelections, insertValueReceipt, seedExtendedMarketsFixture, seedOddsBook, type ExtendedSeed } from "../helpers/extended-markets-seed.js";
import { migrateDeploy, startPostgres, type TestPostgres } from "../helpers/calibration-db.js";

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
    comparePlans: vi.fn(async () => ({ available: false as const, reason: "PLAN_NOT_COMPLETE" })),
    listValueCandidates: vi.fn(async () => ({ items: [], nextCursor: null, pageTotals: { count: 0, stakeUnits: "0", profitUnits: "0" }, pageTotalsByPolicy: [] })),
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
      { id: "candidate-b", valueReceiptId: "value-b", settlementReceiptId: "settlement-b", resultVersionId: "result-b", market: "ONE_X_TWO", policyVersion: "flat-one-unit-v1", selection: "AWAY", decimalOdds: "3.1", outcome: "LOSS", stakeUnits: "1", profitUnits: "-1", clv: { status: "UNAVAILABLE", reason: "NO_COMPARABLE_CLOSE", value: null, policyVersion: "odds-ratio-clv-v1" }, clvNoVig: { status: "UNAVAILABLE", policyVersion: "no-vig-clv-v1", reason: "CLOSING_SET_MISSING" }, settledAt: "2026-01-10T12:00:00.000Z" },
      { id: "candidate-a", valueReceiptId: "value-a", settlementReceiptId: "settlement-a", resultVersionId: "result-a", market: "ONE_X_TWO", policyVersion: "flat-one-unit-v1", selection: "HOME", decimalOdds: "2.5", outcome: "WIN", stakeUnits: "1", profitUnits: "1.5", clv: { status: "AVAILABLE", reason: null, value: "0.04", policyVersion: "odds-ratio-clv-v1" }, clvNoVig: { status: "UNAVAILABLE", policyVersion: "no-vig-clv-v1", reason: "CLOSING_SET_MISSING" }, settledAt: "2026-01-10T12:00:00.000Z" },
    ] as const;
    const repository: EvaluationRepository = {
      loadCohort: vi.fn(async () => cohort()),
      enumerateAvailableCohorts: vi.fn(async () => [cohort()]),
      listValueCandidates: vi.fn(async (_identity, cursor, limit) => {
        const start = cursor ? rows.findIndex((row) => row.id === cursor.id) + 1 : 0;
        const items = rows.slice(start, start + limit);
        return { items, nextCursor: start + limit < rows.length ? { settledAt: items.at(-1)!.settledAt, id: items.at(-1)!.id } : null, pageTotals: { count: items.length, stakeUnits: String(items.length), profitUnits: String(items.reduce((sum, item) => sum + Number(item.profitUnits), 0)) }, pageTotalsByPolicy: [] };
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

/**
 * Phase 14 (D-16, D-17, Pitfall 6) on real PostgreSQL: settlements of both money policies exist for one fixture, and
 * neither the cohort aggregate nor the candidate page ever adds the policies together.
 */
describe("evaluation aggregates keep settlement policies v1 and v2 apart (real PostgreSQL)", () => {
  const identity = { modelVersion: "poisson-v1", competitionId: "ev-league", market: "all", from: "2026-09-01T00:00:00.000Z", to: "2026-10-01T00:00:00.000Z" } as const;
  let postgres: TestPostgres;
  let prisma: PrismaClient;
  let seed: ExtendedSeed;

  async function addValue(key: string, market: string, selection: string, book: ReadonlyArray<readonly [string, string]>, core = false): Promise<void> {
    const odds = await seedOddsBook(prisma, seed, { market, selections: book, tag: key });
    const row = core ? buildCoreValueReceipt(seed, odds, market, selection, { outcome: "VALUE_CANDIDATE" }) : buildExtendedValueReceipt(seed, odds, market, selection, { outcome: "VALUE_CANDIDATE" });
    await insertValueReceipt(prisma, seed, row);
  }

  beforeAll(async () => {
    postgres = startPostgres(`bet-stats-p14-eval-${process.pid}`);
    migrateDeploy(postgres.url());
    prisma = createPrismaClient(postgres.url());
    seed = await seedExtendedMarketsFixture(prisma, { prefix: "ev", homeGoals: 1, awayGoals: 0, settlementReceipt: false });
    // Final score 1-0: HOME wins (v1), BTTS YES loses (v1), handicap -0.75 half-wins, handicap -1 pushes, exact 2-1 loses (v2).
    await addValue("core-1x2", "ONE_X_TWO", "HOME", [["HOME", "2.4"], ["DRAW", "3.3"], ["AWAY", "3.1"]], true);
    await addValue("core-btts", "BTTS", "YES", [["YES", "1.8"], ["NO", "2.1"]], true);
    await addValue("half-win", "ASIAN_HANDICAP:-0.75", "HOME", [["HOME", "2.2"], ["AWAY", "1.7"]]);
    await addValue("push", "ASIAN_HANDICAP:-1", "HOME", [["HOME", "2.5"], ["AWAY", "1.6"]]);
    await addValue("exact-loss", "EXACT_SCORE", "2-1", exactScoreSelections("14"));
    const result = await createSettlementPipelineService({ database: prisma }).process({ fixtureId: seed.fixtureId, resultVersionId: seed.resultVersionId, forecastSnapshotId: seed.forecastSnapshotId, policyVersion: "settlement-policy-v1", correlationId: "ev-settle" });
    expect(result.valueSettlementIds).toHaveLength(5);
  }, 180_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    postgres?.remove();
  });

  it("1. the cohort aggregate counts only flat-one-unit-v1 rows, for market all and for a core market", async () => {
    const repository = createPrismaEvaluationRepository(prisma);
    const all = await repository.loadCohort(identity);
    expect(all.denominators.valueCount).toBe(2);
    expect(all.financial).toMatchObject({ count: 2, totalStakedUnits: "2", totalProfitUnits: "0.4", policyId: "flat-one-unit-v1" });
    const btts = await repository.loadCohort({ ...identity, market: "BTTS" });
    expect(btts.financial).toMatchObject({ count: 1, totalStakedUnits: "1", totalProfitUnits: "-1", policyId: "flat-one-unit-v1" });
    const oneXTwo = await repository.loadCohort({ ...identity, market: "ONE_X_TWO" });
    expect(oneXTwo.financial).toMatchObject({ count: 1, totalStakedUnits: "1", totalProfitUnits: "1.4" });
  });

  it("2. the candidate page labels every row with its market and policy and totals each policy on its own", async () => {
    const page = await createPrismaEvaluationRepository(prisma).listValueCandidates(identity, null, 25);
    expect(page.items).toHaveLength(5);
    const byMarket = new Map(page.items.map((row) => [`${row.market}:${row.selection}`, row]));
    expect(byMarket.get("ONE_X_TWO:HOME")).toMatchObject({ policyVersion: "flat-one-unit-v1", outcome: "WIN", stakeUnits: "1", profitUnits: "1.4" });
    expect(byMarket.get("BTTS:YES")).toMatchObject({ policyVersion: "flat-one-unit-v1", outcome: "LOSS", profitUnits: "-1" });
    // The legacy field is v1 only; the per-policy list has v1 first and v2 second and no combined entry.
    expect(page.pageTotals).toEqual({ count: 2, stakeUnits: "2", profitUnits: "0.4" });
    expect(page.pageTotalsByPolicy).toEqual([
      { policyVersion: "flat-one-unit-v1", count: 2, stakeUnits: "2", profitUnits: "0.4" },
      { policyVersion: "flat-one-unit-v2", count: 3, stakeUnits: "3", profitUnits: "-0.4" },
    ]);
  });

  it("3. a single policy gives one entry, an empty page gives none", async () => {
    const repository = createPrismaEvaluationRepository(prisma);
    const core = await repository.listValueCandidates({ ...identity, market: "ONE_X_TWO" }, null, 25);
    expect(core.pageTotalsByPolicy).toEqual([{ policyVersion: "flat-one-unit-v1", count: 1, stakeUnits: "1", profitUnits: "1.4" }]);
    expect(core.items.every((row) => row.policyVersion === "flat-one-unit-v1")).toBe(true);
    const empty = await repository.listValueCandidates({ ...identity, competitionId: "no-such-league" }, null, 25);
    expect(empty.items).toEqual([]);
    expect(empty.pageTotalsByPolicy).toEqual([]);
    expect(empty.pageTotals).toEqual({ count: 0, stakeUnits: "0", profitUnits: "0" });
  });

  it("4. v2 outcomes and money pass through unchanged (HALF_WIN, PUSH, LOSS)", async () => {
    const page = await createPrismaEvaluationRepository(prisma).listValueCandidates(identity, null, 25);
    const v2 = page.items.filter((row) => row.policyVersion === "flat-one-unit-v2");
    const byMarket = new Map(v2.map((row) => [row.market, row]));
    expect(byMarket.get("ASIAN_HANDICAP:-0.75")).toMatchObject({ outcome: "HALF_WIN", stakeUnits: "1", profitUnits: "0.6", decimalOdds: "2.2" });
    expect(byMarket.get("ASIAN_HANDICAP:-1")).toMatchObject({ outcome: "PUSH", stakeUnits: "1", profitUnits: "0", decimalOdds: "2.5" });
    expect(byMarket.get("EXACT_SCORE")).toMatchObject({ outcome: "LOSS", stakeUnits: "1", profitUnits: "-1", selection: "2-1" });
  });

  it("5. the service response carries the per-policy totals and a late closing price changes no ordering or total", async () => {
    const service = new EvaluationService(createPrismaEvaluationRepository(prisma));
    const before = await service.valueCandidates(identity);
    expect(before.pageTotalsByPolicy.map((row) => row.policyVersion)).toEqual(["flat-one-unit-v1", "flat-one-unit-v2"]);
    const half = before.items.find((row) => row.market === "ASIAN_HANDICAP:-0.75")!;
    expect(half.clvNoVig).toMatchObject({ status: "UNAVAILABLE", reason: "CLOSING_SET_MISSING" });
    // A complete closing set for the handicap line appears after settlement (raw insert, like the Phase 13 read tests).
    for (const [selection, odds] of [["HOME", "2.0"], ["AWAY", "1.85"]] as const) {
      await prisma.$executeRawUnsafe(`INSERT INTO "ClosingOddsObservation" (id,"fixtureId",market,selection,"decimalOdds","oddsFormat","sourceConvention","observationKind","observedAt") VALUES ($1,$2,'ASIAN_HANDICAP:-0.75',$3,$4,'DECIMAL','BOOKMAKER_BACK','MARKET_CLOSE','2026-09-10T17:30:00Z')`, `ev-late-close-${selection}`, seed.fixtureId, selection, odds);
    }
    const after = await service.valueCandidates(identity);
    expect(after.items.map((row) => row.id)).toEqual(before.items.map((row) => row.id));
    expect(after.pageTotalsByPolicy).toEqual(before.pageTotalsByPolicy);
    expect(after.items.find((row) => row.market === "ASIAN_HANDICAP:-0.75")!.clvNoVig.status).toBe("AVAILABLE");
  });
});
