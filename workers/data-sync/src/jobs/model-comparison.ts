import { createHash } from "node:crypto";

import { compareBacktestPlans, type PrismaClient } from "@bet-stats/database";
import {
  BACKTEST_POLICY_VERSION,
  MODEL_COMPARISON_POLICY,
  forecastConfigHashFor,
  toModelComparisonResult,
  type ForecastModelVersion,
  type ModelComparisonResult,
  type RawModelComparison,
  type RollingOriginWindow,
} from "@bet-stats/domain";

import { BACKTEST_LIMITS, admitBacktestPlan, admitPersistEnqueueBacktest, type BacktestPlanReceipt } from "./backtests.js";

/**
 * Operator entry point for the V1 vs Dixon-Coles comparison (phase 11, UAT item 2).
 *
 * Both plans are built over the SAME windows. The comparison never promotes a model: it only produces the
 * `model-comparison-v2` receipt, whose verdict is INCONCLUSIVE below the policy minimum sample.
 */
export const COMPARISON_MODELS = Object.freeze({ left: "poisson-ensemble-v1", right: "dixon-coles-ensemble-v1" } as const satisfies Record<"left" | "right", ForecastModelVersion>);
export const COMPARISON_MARKETS = ["ONE_X_TWO", "OVER_UNDER_2_5", "BTTS"] as const;
export type ComparisonMarket = (typeof COMPARISON_MARKETS)[number];

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
/** The plan range must stay inside BACKTEST_LIMITS.maxSpanDays; one day of slack covers the cutoff lead. */
export const COMPARISON_MAX_SPAN_DAYS = BACKTEST_LIMITS.maxSpanDays - 1;

export interface ComparisonParams {
  /** Inclusive lower bound of fixture kickoff (UTC). */
  readonly from: string;
  /** Exclusive upper bound of fixture kickoff (UTC). */
  readonly to: string;
  /** Empty or undefined = every league. */
  readonly leagueIds?: readonly string[];
  readonly market?: ComparisonMarket;
  readonly concurrency?: number;
  /** Forecast cutoff = kickoff minus this many hours. */
  readonly cutoffHoursBeforeKickoff?: number;
  /** Training boundary (rho is fitted here) = cutoff minus this many hours. */
  readonly trainingLagHours?: number;
  /** Result knowledge boundary = kickoff plus this many hours. */
  readonly evaluationLagHours?: number;
}

export interface ComparisonFixture {
  readonly id: string;
  readonly kickoffUtc: Date;
  /** Earliest moment a result is known for the fixture; fixtures without a result are not eligible. */
  readonly firstResultEffectiveAt: Date | null;
}

export interface ResolvedComparisonParams {
  readonly from: string;
  readonly to: string;
  readonly leagueIds: readonly string[];
  readonly market: ComparisonMarket;
  readonly concurrency: number;
  readonly cutoffHoursBeforeKickoff: number;
  readonly trainingLagHours: number;
  readonly evaluationLagHours: number;
}

export interface ComparisonPlanPair {
  readonly pairId: string;
  readonly params: ResolvedComparisonParams;
  readonly left: BacktestPlanReceipt;
  readonly right: BacktestPlanReceipt;
  readonly windowCount: number;
}

function coded(code: string): Error & { code: string } { return Object.assign(new Error(code), { code }); }

function instant(value: unknown, code: string): string {
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(parsed)) throw coded(code);
  return new Date(parsed).toISOString();
}

function positiveHours(value: number | undefined, fallback: number, code: string): number {
  const hours = value ?? fallback;
  if (!Number.isFinite(hours) || hours <= 0 || hours > 24 * 60) throw coded(code);
  return hours;
}

export function resolveComparisonParams(params: ComparisonParams): ResolvedComparisonParams {
  const from = instant(params.from, "INVALID_COMPARISON_RANGE");
  const to = instant(params.to, "INVALID_COMPARISON_RANGE");
  const span = Date.parse(to) - Date.parse(from);
  if (span <= 0 || span > COMPARISON_MAX_SPAN_DAYS * DAY_MS) throw coded("INVALID_COMPARISON_RANGE");
  const market = params.market ?? "ONE_X_TWO";
  if (!COMPARISON_MARKETS.includes(market)) throw coded("INVALID_MARKET");
  const concurrency = params.concurrency ?? 1;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > BACKTEST_LIMITS.maxConcurrency) throw coded("BACKTEST_LIMIT_EXCEEDED");
  return Object.freeze({
    from,
    to,
    leagueIds: Object.freeze([...new Set(params.leagueIds ?? [])].sort()),
    market,
    concurrency,
    cutoffHoursBeforeKickoff: positiveHours(params.cutoffHoursBeforeKickoff, 1, "INVALID_CUTOFF_HOURS"),
    trainingLagHours: positiveHours(params.trainingLagHours, 24, "INVALID_TRAINING_LAG_HOURS"),
    evaluationLagHours: positiveHours(params.evaluationLagHours, 48, "INVALID_EVALUATION_LAG_HOURS"),
  });
}

/**
 * Pure rolling-origin window generator. Windows are ordered by cutoff and strictly increasing (a tie between two
 * simultaneous kickoffs is broken by a one-millisecond shift, which keeps the cutoff before kickoff). Fixtures whose
 * result is not yet known at `evaluationAsOf` are skipped, so every window can actually be scored.
 */
export function buildComparisonWindows(fixtures: readonly ComparisonFixture[], params: ResolvedComparisonParams, idPrefix: string): RollingOriginWindow[] {
  const from = Date.parse(params.from); const to = Date.parse(params.to);
  const eligible = fixtures
    .filter((fixture) => fixture.kickoffUtc.getTime() >= from && fixture.kickoffUtc.getTime() < to)
    .filter((fixture) => fixture.firstResultEffectiveAt !== null && fixture.firstResultEffectiveAt.getTime() <= fixture.kickoffUtc.getTime() + params.evaluationLagHours * HOUR_MS)
    .sort((a, b) => a.kickoffUtc.getTime() - b.kickoffUtc.getTime() || a.id.localeCompare(b.id));
  let previousCutoff = Number.NEGATIVE_INFINITY;
  return eligible.map((fixture) => {
    const kickoff = fixture.kickoffUtc.getTime();
    const cutoff = Math.max(kickoff - params.cutoffHoursBeforeKickoff * HOUR_MS, previousCutoff + 1);
    previousCutoff = cutoff;
    return {
      id: `${idPrefix}:${fixture.id}`,
      fixtureId: fixture.id,
      trainingEndsAt: new Date(cutoff - params.trainingLagHours * HOUR_MS).toISOString(),
      forecastCutoff: new Date(cutoff).toISOString(),
      evaluationAsOf: new Date(kickoff + params.evaluationLagHours * HOUR_MS).toISOString(),
    };
  });
}

/** Deterministic pair identity: same parameters and the same fixture set always give the same plan ids and hashes. */
export function buildComparisonPlanPair(params: ComparisonParams, fixtures: readonly ComparisonFixture[]): ComparisonPlanPair {
  const resolved = resolveComparisonParams(params);
  const windowsForIdentity = buildComparisonWindows(fixtures, resolved, "w");
  if (windowsForIdentity.length === 0) throw coded("COMPARISON_NO_ELIGIBLE_FIXTURES");
  if (windowsForIdentity.length > BACKTEST_LIMITS.maxWindows) throw coded("BACKTEST_LIMIT_EXCEEDED");
  const pairId = createHash("sha256").update(JSON.stringify({ resolved, windows: windowsForIdentity })).digest("hex").slice(0, 12);
  const build = (side: "left" | "right", suffix: string): BacktestPlanReceipt => {
    const modelVersion = COMPARISON_MODELS[side];
    const id = `cmp-${pairId}-${suffix}`;
    const windows = buildComparisonWindows(fixtures, resolved, id);
    return admitBacktestPlan({
      id,
      version: BACKTEST_POLICY_VERSION,
      modelVersion,
      configHash: forecastConfigHashFor(modelVersion),
      rangeFrom: new Date(Math.min(Date.parse(resolved.from), Date.parse(windows[0]!.forecastCutoff))).toISOString(),
      rangeTo: resolved.to,
      concurrency: resolved.concurrency,
      windows,
    });
  };
  return Object.freeze({ pairId, params: resolved, left: build("left", "poisson"), right: build("right", "dixon-coles"), windowCount: windowsForIdentity.length });
}

type FixtureReader = Pick<PrismaClient, "fixture">;

export async function listComparisonFixtures(database: FixtureReader, params: ResolvedComparisonParams): Promise<ComparisonFixture[]> {
  const rows = await database.fixture.findMany({
    where: { status: "FINISHED", kickoffUtc: { gte: new Date(params.from), lt: new Date(params.to) }, ...(params.leagueIds.length > 0 ? { leagueId: { in: [...params.leagueIds] } } : {}) },
    select: { id: true, kickoffUtc: true, resultVersions: { select: { effectiveAt: true }, orderBy: { effectiveAt: "asc" }, take: 1 } },
    orderBy: [{ kickoffUtc: "asc" }, { id: "asc" }],
  });
  return rows.map((row) => ({ id: row.id, kickoffUtc: row.kickoffUtc, firstResultEffectiveAt: row.resultVersions[0]?.effectiveAt ?? null }));
}

type SubmitDeps = Parameters<typeof admitPersistEnqueueBacktest>[1];

/** Idempotent: the same pair resubmitted re-uses the persisted plans and the deterministic queue job ids. */
export async function submitComparisonPair(pair: ComparisonPlanPair, input: Omit<SubmitDeps, "correlationId">): Promise<{ leftPlanId: string; rightPlanId: string }> {
  const correlationId = `model-comparison:${pair.pairId}`;
  await admitPersistEnqueueBacktest(pair.left, { ...input, correlationId });
  await admitPersistEnqueueBacktest(pair.right, { ...input, correlationId });
  return { leftPlanId: pair.left.id, rightPlanId: pair.right.id };
}

export interface PlanProgress {
  readonly planId: string;
  readonly found: boolean;
  readonly modelVersion?: string;
  readonly state?: string;
  readonly deliveryState?: string;
  readonly windows: Readonly<Record<string, number>>;
}

export async function readPlanProgress(database: Pick<PrismaClient, "backtestPlan">, planId: string): Promise<PlanProgress> {
  const plan = await database.backtestPlan.findUnique({ where: { id: planId }, select: { id: true, modelVersion: true, state: true, deliveryState: true, windows: { select: { state: true } } } });
  if (!plan) return { planId, found: false, windows: {} };
  const windows: Record<string, number> = {};
  for (const window of plan.windows) windows[window.state] = (windows[window.state] ?? 0) + 1;
  return { planId, found: true, modelVersion: plan.modelVersion, state: plan.state, deliveryState: plan.deliveryState, windows };
}

export type WaitOutcome = "SUCCEEDED" | "FAILED" | "TIMEOUT";

export async function waitForPlans(input: {
  planIds: readonly string[];
  read: (planId: string) => Promise<PlanProgress>;
  timeoutMs: number;
  pollMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  onProgress?: (progress: readonly PlanProgress[]) => void;
}): Promise<{ outcome: WaitOutcome; progress: readonly PlanProgress[] }> {
  const sleep = input.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = input.now ?? Date.now;
  const deadline = now() + input.timeoutMs;
  for (;;) {
    const progress = await Promise.all(input.planIds.map((id) => input.read(id)));
    input.onProgress?.(progress);
    if (progress.some((item) => !item.found || (item.windows.FAILED ?? 0) > 0 || item.state === "FAILED")) return { outcome: "FAILED", progress };
    if (progress.every((item) => item.state === "SUCCEEDED")) return { outcome: "SUCCEEDED", progress };
    if (now() >= deadline) return { outcome: "TIMEOUT", progress };
    await sleep(input.pollMs ?? 5_000);
  }
}

/**
 * Same assembly as `GET /evaluation/model-comparison` (repository comparison + model-comparison-v2 receipt),
 * run in-process so the operator needs neither HTTP nor eligibility headers.
 */
export async function computeModelComparison(database: PrismaClient, input: { leftPlanId: string; rightPlanId: string; market: ComparisonMarket; from: string; to: string }, now: () => Date = () => new Date()): Promise<ModelComparisonResult> {
  const raw = await compareBacktestPlans(database, input) as RawModelComparison;
  return toModelComparisonResult(raw, { from: input.from, to: input.to, computedAt: now().toISOString(), windows: raw.windows ?? [] });
}

/** Plain-Russian summary for the operator; the JSON receipt stays the source of truth. */
export function describeComparison(result: ModelComparisonResult): string {
  if (!result.available) return `Сравнение недоступно: ${result.reason}.`;
  const { receipt } = result;
  const verdict = { BETTER: "DC лучше (дельта Brier не меньше порога)", WORSE: "DC хуже (дельта Brier не меньше порога)", INCONCLUSIVE: "ВЫВОД НЕ СДЕЛАН (INCONCLUSIVE): нет доказательства ни в пользу, ни против" }[receipt.verdict];
  const lines = [
    `Рынок ${receipt.market}, выборка ${receipt.left.sampleSize} исходов (минимум для вывода: ${MODEL_COMPARISON_POLICY.minimumSampleSize}).`,
    `Brier: V1 ${receipt.left.brierScore.toFixed(4)}, DC ${receipt.right.brierScore.toFixed(4)}, дельта ${receipt.deltas.brierScore.toFixed(4)} (порог ${MODEL_COMPARISON_POLICY.deltaMateriality}).`,
    `LogLoss: V1 ${receipt.left.logLoss.toFixed(4)}, DC ${receipt.right.logLoss.toFixed(4)}, дельта ${receipt.deltas.logLoss.toFixed(4)}.`,
    `Вердикт: ${verdict}.`,
  ];
  if (receipt.verdict === "INCONCLUSIVE" && receipt.left.sampleSize < MODEL_COMPARISON_POLICY.minimumSampleSize) lines.push("Выборка меньше минимума: дельта не интерпретируется. Это не доказывает, что DC не хуже V1.");
  lines.push("Отчёт информационный: модель не переключается автоматически, а прошлые результаты не гарантируют будущих.");
  return lines.join("\n");
}
