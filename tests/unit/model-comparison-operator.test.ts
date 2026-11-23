import { describe, expect, it, vi } from "vitest";

import { MODEL_COMPARISON_POLICY, forecastConfigHashFor, validateRollingOriginWindow } from "@bet-stats/domain";
import { BACKTEST_LIMITS } from "../../workers/data-sync/src/jobs/backtests.js";
import { PRE_MATCH_CUTOFF_LEAD_HOURS, PRE_MATCH_CUTOFF_LEAD_MS } from "../../workers/data-sync/src/jobs/forecasts.js";
import {
  buildComparisonPlanPair,
  buildComparisonWindows,
  describeComparison,
  listComparisonFixtures,
  planComparisonCohort,
  resolveComparisonParams,
  submitComparisonPair,
  waitForPlans,
  type ComparisonFixture,
  type PlanProgress,
} from "../../workers/data-sync/src/jobs/model-comparison.js";
import { runModelComparisonCommand } from "../../workers/data-sync/src/jobs/model-comparison-cli.js";

const range = { from: "2026-08-01T00:00:00.000Z", to: "2026-09-01T00:00:00.000Z" };
function fixture(id: string, kickoff: string, resultAfterHours: number | null = 3, hasEvidenceAtCutoff = true): ComparisonFixture {
  const kickoffUtc = new Date(kickoff);
  return { id, kickoffUtc, firstResultEffectiveAt: resultAfterHours === null ? null : new Date(kickoffUtc.getTime() + resultAfterHours * 3_600_000), hasEvidenceAtCutoff };
}
const fixtures = [fixture("f2", "2026-08-10T18:00:00.000Z"), fixture("f1", "2026-08-09T15:00:00.000Z"), fixture("f3", "2026-08-10T18:00:00.000Z")];

describe("operator model comparison: windows and plans", () => {
  it("builds strictly increasing, leakage-safe windows at the production lead and keeps the smallest id on a shared kickoff", () => {
    const resolved = resolveComparisonParams(range);
    const windows = buildComparisonWindows(fixtures, resolved, "p");
    expect(windows.map((w) => w.fixtureId)).toEqual(["f1", "f2"]);
    let previous: string | undefined;
    for (const window of windows) { validateRollingOriginWindow(window, previous); previous = window.forecastCutoff; }
    expect(windows[1]!.forecastCutoff).toBe("2026-08-10T12:00:00.000Z");
    expect(windows[0]).toMatchObject({ trainingEndsAt: "2026-08-08T09:00:00.000Z", forecastCutoff: "2026-08-09T09:00:00.000Z", evaluationAsOf: "2026-08-11T15:00:00.000Z" });
    const { report } = planComparisonCohort(fixtures, resolved);
    expect(report).toMatchObject({ considered: 3, usable: 2, skipped: { noResultByEvaluationAsOf: 0, noPublishedEvidenceAtCutoff: 0, sharedCutoffInstant: 1 }, tieBreak: "smallest-fixture-id", minimumRequired: MODEL_COMPARISON_POLICY.minimumSampleSize });
  });

  it("defaults the cutoff lead to the single production PRE_MATCH constant (6 hours)", () => {
    expect(PRE_MATCH_CUTOFF_LEAD_HOURS).toBe(6);
    expect(PRE_MATCH_CUTOFF_LEAD_MS).toBe(21_600_000);
    expect(resolveComparisonParams(range).cutoffHoursBeforeKickoff).toBe(PRE_MATCH_CUTOFF_LEAD_HOURS);
    expect(planComparisonCohort(fixtures, resolveComparisonParams(range)).report.leadHours).toBe(6);
    expect(resolveComparisonParams({ ...range, cutoffHoursBeforeKickoff: 2 }).cutoffHoursBeforeKickoff).toBe(2);
  });

  it("does not let a fixture without evidence occupy the tie-break slot, even with the smaller id", () => {
    const tied = [fixture("a", "2026-08-10T18:00:00.000Z", 3, false), fixture("b", "2026-08-10T18:00:00.000Z"), fixture("c", "2026-08-10T18:00:00.000Z")];
    const { eligible, report } = planComparisonCohort(tied, resolveComparisonParams(range));
    expect(eligible.map((item) => item.id)).toEqual(["b"]);
    expect(report.skipped).toEqual({ noResultByEvaluationAsOf: 0, noPublishedEvidenceAtCutoff: 1, sharedCutoffInstant: 1 });
  });

  it("keeps considered = usable + skipped and is independent of the input order", () => {
    const mixed = [
      fixture("a", "2026-08-05T12:00:00.000Z", null),
      fixture("b", "2026-08-06T12:00:00.000Z", 100),
      fixture("c", "2026-08-07T12:00:00.000Z", 3, false),
      fixture("d", "2026-08-08T12:00:00.000Z"),
      fixture("e", "2026-08-08T12:00:00.000Z"),
      fixture("f", "2026-08-09T12:00:00.000Z"),
      fixture("out", "2026-09-05T12:00:00.000Z"),
    ];
    const resolved = resolveComparisonParams(range);
    const { eligible, report } = planComparisonCohort(mixed, resolved);
    expect(report.considered).toBe(6);
    expect(report.considered).toBe(report.usable + report.skipped.noResultByEvaluationAsOf + report.skipped.noPublishedEvidenceAtCutoff + report.skipped.sharedCutoffInstant);
    expect(report).toMatchObject({ usable: 2, skipped: { noResultByEvaluationAsOf: 2, noPublishedEvidenceAtCutoff: 1, sharedCutoffInstant: 1 } });
    expect(eligible.map((item) => item.id)).toEqual(["d", "f"]);
    const reversed = planComparisonCohort([...mixed].reverse(), resolved);
    expect(reversed.eligible.map((item) => item.id)).toEqual(["d", "f"]);
    expect(reversed.report).toEqual(report);
    expect(buildComparisonPlanPair(range, [...mixed].reverse()).pairId).toBe(buildComparisonPlanPair(range, mixed).pairId);
  });

  it("compares ids by code units, not by locale", () => {
    const tied = [fixture("a", "2026-08-10T18:00:00.000Z"), fixture("B", "2026-08-10T18:00:00.000Z")];
    expect(planComparisonCohort(tied, resolveComparisonParams(range)).eligible.map((item) => item.id)).toEqual(["B"]);
  });

  it("skips fixtures without a result known by evaluationAsOf and outside the kickoff range", () => {
    const windows = buildComparisonWindows([fixture("none", "2026-08-05T12:00:00.000Z", null), fixture("late", "2026-08-05T12:00:00.000Z", 100), fixture("out", "2026-09-05T12:00:00.000Z"), fixture("ok", "2026-08-05T12:00:00.000Z")], resolveComparisonParams(range), "p");
    expect(windows.map((w) => w.fixtureId)).toEqual(["ok"]);
  });

  it("marks a fixture as evidence-backed only when BOTH teams have a PUBLISHED build at the exact cutoff", async () => {
    const kickoff = (id: string, day: number, home: string, away: string) => ({ id, kickoffUtc: new Date(Date.UTC(2026, 7, day, 18)), homeTeamId: home, awayTeamId: away, resultVersions: [{ effectiveAt: new Date(Date.UTC(2026, 7, day, 20)) }] });
    const cutoffMs = (day: number, offsetMs = 0) => Date.UTC(2026, 7, day, 18) - PRE_MATCH_CUTOFF_LEAD_MS + offsetMs;
    const rows = [kickoff("both", 10, "h1", "a1"), kickoff("one", 11, "h2", "a2"), kickoff("early", 12, "h3", "a3"), kickoff("none", 13, "h4", "a4")];
    const findBuilds = vi.fn(async () => [
      { teamId: "h1", cutoff: new Date(cutoffMs(10)) }, { teamId: "a1", cutoff: new Date(cutoffMs(10)) },
      { teamId: "h2", cutoff: new Date(cutoffMs(11)) },
      { teamId: "h3", cutoff: new Date(cutoffMs(12, -1)) }, { teamId: "a3", cutoff: new Date(cutoffMs(12)) },
    ]);
    const database = { fixture: { findMany: async () => rows }, evidenceBuild: { findMany: findBuilds } };
    const listed = await listComparisonFixtures(database as never, resolveComparisonParams(range));
    expect(Object.fromEntries(listed.map((item) => [item.id, item.hasEvidenceAtCutoff]))).toEqual({ both: true, one: false, early: false, none: false });
    expect(findBuilds).toHaveBeenCalledTimes(1);
    const query = (findBuilds.mock.calls[0] as unknown as [{ where: { state: string; teamId: { in: string[] }; cutoff: { in: Date[] } } }])[0].where;
    expect(query.state).toBe("PUBLISHED");
    expect([...query.teamId.in].sort()).toEqual(["a1", "a2", "a3", "a4", "h1", "h2", "h3", "h4"]);
    expect(query.cutoff.in.map((date) => date.getTime()).sort()).toEqual([10, 11, 12, 13].map((day) => cutoffMs(day)));
  });

  it("does not query evidence builds when there are no fixtures", async () => {
    const findBuilds = vi.fn(async () => []);
    const listed = await listComparisonFixtures({ fixture: { findMany: async () => [] }, evidenceBuild: { findMany: findBuilds } } as never, resolveComparisonParams(range));
    expect(listed).toEqual([]);
    expect(findBuilds).not.toHaveBeenCalled();
  });

  it("builds an admitted pair: one window set, version-specific config hashes, deterministic ids", () => {
    const pair = buildComparisonPlanPair(range, fixtures);
    expect(pair.left.modelVersion).toBe("poisson-ensemble-v1");
    expect(pair.right.modelVersion).toBe("dixon-coles-ensemble-v1");
    expect(pair.left.configHash).toBe(forecastConfigHashFor("poisson-ensemble-v1"));
    expect(pair.right.configHash).toBe(forecastConfigHashFor("dixon-coles-ensemble-v1"));
    expect(pair.left.windows.map(({ id: _id, ...rest }) => rest)).toEqual(pair.right.windows.map(({ id: _id, ...rest }) => rest));
    expect(new Set([...pair.left.windows, ...pair.right.windows].map((w) => w.id)).size).toBe(pair.windowCount * 2);
    const again = buildComparisonPlanPair(range, [...fixtures].reverse());
    expect([again.left.id, again.left.planHash, again.right.planHash]).toEqual([pair.left.id, pair.left.planHash, pair.right.planHash]);
    expect(buildComparisonPlanPair({ ...range, cutoffHoursBeforeKickoff: 2 }, fixtures).left.id).not.toBe(pair.left.id);
    expect(pair.windowCount).toBe(2);
    expect(pair.cohort).toMatchObject({ considered: 3, usable: 2 });
  });

  it.each([
    [{ from: "bad", to: range.to }, "INVALID_COMPARISON_RANGE"],
    [{ from: range.to, to: range.from }, "INVALID_COMPARISON_RANGE"],
    [{ from: "2025-01-01T00:00:00.000Z", to: "2026-08-01T00:00:00.000Z" }, "INVALID_COMPARISON_RANGE"],
    [{ ...range, concurrency: BACKTEST_LIMITS.maxConcurrency + 1 }, "BACKTEST_LIMIT_EXCEEDED"],
    [{ ...range, market: "ALL" as never }, "INVALID_MARKET"],
  ])("rejects unsafe parameters before touching storage (%#)", (params, code) => {
    expect(() => resolveComparisonParams(params)).toThrow(code);
  });

  it("refuses an empty cohort and more windows than the backtest limit", () => {
    expect(() => buildComparisonPlanPair(range, [])).toThrow("COMPARISON_NO_ELIGIBLE_FIXTURES");
    const many = Array.from({ length: BACKTEST_LIMITS.maxWindows + 1 }, (_, i) => fixture(`m${i}`, new Date(Date.parse("2026-08-02T00:00:00.000Z") + i * 3_600_000).toISOString()));
    expect(() => buildComparisonPlanPair({ ...range, evaluationLagHours: 48 }, many)).toThrow("BACKTEST_LIMIT_EXCEEDED");
  });
});

function fakeStores() {
  const plans = new Map<string, { planHash: string; delivery: string }>();
  const receipts = {
    createPlan: vi.fn(async (plan: { id: string; planHash: string }) => {
      const existing = plans.get(plan.id);
      if (existing && existing.planHash !== plan.planHash) throw new Error("BACKTEST_PLAN_ID_CONFLICT");
      if (!existing) plans.set(plan.id, { planHash: plan.planHash, delivery: "PENDING" });
    }),
    markDelivery: vi.fn(async (id: string, state: string) => { plans.get(id)!.delivery = state; }),
  };
  const jobs = new Set<string>();
  const queue = { enqueue: vi.fn(async (data: { planId: string; planHash: string }) => { jobs.add(`${data.planId}:${data.planHash}`); }) };
  return { plans, receipts, queue, jobs };
}

describe("operator model comparison: submit, wait, receipt", () => {
  it("submits the pair idempotently: a repeat creates no new plans or queue jobs", async () => {
    const pair = buildComparisonPlanPair(range, fixtures);
    const stores = fakeStores();
    await submitComparisonPair(pair, { receipts: stores.receipts as never, queue: stores.queue });
    await submitComparisonPair(pair, { receipts: stores.receipts as never, queue: stores.queue });
    expect(stores.plans.size).toBe(2);
    expect(stores.jobs.size).toBe(2);
    expect([...stores.plans.values()].every((plan) => plan.delivery === "DELIVERED")).toBe(true);
  });

  it("waits until both plans succeed, fails on a failed window, and times out honestly", async () => {
    const make = (state: string, windows: Record<string, number> = {}): PlanProgress => ({ planId: "p", found: true, state, windows });
    let step = 0; let clock = 0;
    const done = await waitForPlans({ planIds: ["a", "b"], read: async () => make(step++ < 2 ? "PENDING" : "SUCCEEDED"), timeoutMs: 1_000, sleep: async () => { clock += 10; }, now: () => clock });
    expect(done.outcome).toBe("SUCCEEDED");
    expect((await waitForPlans({ planIds: ["a"], read: async () => make("PENDING", { FAILED: 1 }), timeoutMs: 1_000, sleep: async () => undefined })).outcome).toBe("FAILED");
    clock = 0;
    expect((await waitForPlans({ planIds: ["a"], read: async () => make("PENDING"), timeoutMs: 50, sleep: async () => { clock += 100; }, now: () => clock })).outcome).toBe("TIMEOUT");
  });

  it("describes an INCONCLUSIVE small-sample receipt without claiming DC is not worse", () => {
    const side = (planId: string, modelVersion: string, brierScore: number) => ({ planId, planHash: "h", modelVersion, configHash: "c", sampleSize: 5, brierScore, logLoss: 0.9 });
    const text = describeComparison({ available: true, receipt: { version: MODEL_COMPARISON_POLICY.version, market: "ONE_X_TWO", from: range.from, to: range.to, windowsDigest: "sha256:x", left: side("l", "poisson-ensemble-v1", 0.6), right: side("r", "dixon-coles-ensemble-v1", 0.5), deltas: { brierScore: -0.1, logLoss: 0 }, verdict: "INCONCLUSIVE", computedAt: range.from } } as never);
    expect(text).toContain("INCONCLUSIVE");
    expect(text).toContain("не доказывает");
    expect(describeComparison({ available: false, reason: "PLAN_NOT_COMPLETE" })).toContain("PLAN_NOT_COMPLETE");
  });

  it("dry-run prints the pair and writes nothing; submit validates input", async () => {
    const stores = fakeStores();
    const lines: string[] = [];
    const database = {
      fixture: { findMany: async () => fixtures.map((f) => ({ id: f.id, kickoffUtc: f.kickoffUtc, homeTeamId: `h-${f.id}`, awayTeamId: `a-${f.id}`, resultVersions: [{ effectiveAt: f.firstResultEffectiveAt }] })) },
      evidenceBuild: { findMany: async () => fixtures.flatMap((f) => [`h-${f.id}`, `a-${f.id}`].map((teamId) => ({ teamId, cutoff: new Date(f.kickoffUtc.getTime() - PRE_MATCH_CUTOFF_LEAD_MS) }))) },
    };
    const deps = { database: database as never, receipts: stores.receipts as never, queue: stores.queue, out: (line: string) => lines.push(line) };
    expect(await runModelComparisonCommand(["submit", "--from", range.from, "--to", range.to, "--dry-run", "--json"], deps)).toBe(0);
    expect(JSON.parse(lines.join("\n"))).toMatchObject({ dryRun: true, windows: 2, cohort: { considered: 3, usable: 2, skipped: { sharedCutoffInstant: 1 } } });
    expect(stores.plans.size).toBe(0);
    await expect(runModelComparisonCommand(["submit", "--from", range.from], deps)).rejects.toThrow("COMPARISON_RANGE_REQUIRED");
    expect(await runModelComparisonCommand(["submit", "--from", range.from, "--to", range.to], deps)).toBe(0);
    expect(stores.plans.size).toBe(2);
  });
});
