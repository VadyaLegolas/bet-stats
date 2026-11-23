import { describe, expect, it, vi } from "vitest";

import { MODEL_COMPARISON_POLICY, forecastConfigHashFor, validateRollingOriginWindow } from "@bet-stats/domain";
import { BACKTEST_LIMITS } from "../../workers/data-sync/src/jobs/backtests.js";
import {
  buildComparisonPlanPair,
  buildComparisonWindows,
  describeComparison,
  resolveComparisonParams,
  submitComparisonPair,
  waitForPlans,
  type ComparisonFixture,
  type PlanProgress,
} from "../../workers/data-sync/src/jobs/model-comparison.js";
import { runModelComparisonCommand } from "../../workers/data-sync/src/jobs/model-comparison-cli.js";

const range = { from: "2026-08-01T00:00:00.000Z", to: "2026-09-01T00:00:00.000Z" };
function fixture(id: string, kickoff: string, resultAfterHours: number | null = 3): ComparisonFixture {
  const kickoffUtc = new Date(kickoff);
  return { id, kickoffUtc, firstResultEffectiveAt: resultAfterHours === null ? null : new Date(kickoffUtc.getTime() + resultAfterHours * 3_600_000) };
}
const fixtures = [fixture("f2", "2026-08-10T18:00:00.000Z"), fixture("f1", "2026-08-09T15:00:00.000Z"), fixture("f3", "2026-08-10T18:00:00.000Z")];

describe("operator model comparison: windows and plans", () => {
  it("builds strictly increasing, leakage-safe windows and breaks kickoff ties deterministically", () => {
    const windows = buildComparisonWindows(fixtures, resolveComparisonParams(range), "p");
    expect(windows.map((w) => w.fixtureId)).toEqual(["f1", "f2", "f3"]);
    let previous: string | undefined;
    for (const window of windows) { validateRollingOriginWindow(window, previous); previous = window.forecastCutoff; }
    expect(Date.parse(windows[2]!.forecastCutoff) - Date.parse(windows[1]!.forecastCutoff)).toBe(1);
    expect(windows[0]).toMatchObject({ trainingEndsAt: "2026-08-08T14:00:00.000Z", forecastCutoff: "2026-08-09T14:00:00.000Z", evaluationAsOf: "2026-08-11T15:00:00.000Z" });
  });

  it("skips fixtures without a result known by evaluationAsOf and outside the kickoff range", () => {
    const windows = buildComparisonWindows([fixture("none", "2026-08-05T12:00:00.000Z", null), fixture("late", "2026-08-05T12:00:00.000Z", 100), fixture("out", "2026-09-05T12:00:00.000Z"), fixture("ok", "2026-08-05T12:00:00.000Z")], resolveComparisonParams(range), "p");
    expect(windows.map((w) => w.fixtureId)).toEqual(["ok"]);
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
    const database = { fixture: { findMany: async () => fixtures.map((f) => ({ id: f.id, kickoffUtc: f.kickoffUtc, resultVersions: [{ effectiveAt: f.firstResultEffectiveAt }] })) } };
    const deps = { database: database as never, receipts: stores.receipts as never, queue: stores.queue, out: (line: string) => lines.push(line) };
    expect(await runModelComparisonCommand(["submit", "--from", range.from, "--to", range.to, "--dry-run", "--json"], deps)).toBe(0);
    expect(JSON.parse(lines.join("\n"))).toMatchObject({ dryRun: true, windows: 3 });
    expect(stores.plans.size).toBe(0);
    await expect(runModelComparisonCommand(["submit", "--from", range.from], deps)).rejects.toThrow("COMPARISON_RANGE_REQUIRED");
    expect(await runModelComparisonCommand(["submit", "--from", range.from, "--to", range.to], deps)).toBe(0);
    expect(stores.plans.size).toBe(2);
  });
});
