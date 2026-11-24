import { createHash } from "node:crypto";

import { compareBacktestPlans, resolveHistoricalResultGraph, type PrismaClient } from "@bet-stats/database";
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
import { PRE_MATCH_CUTOFF_LEAD_HOURS } from "./forecasts.js";

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
/** The plan range must stay inside BACKTEST_LIMITS.maxSpanDays; one day of slack covers the cutoff lead (production PRE_MATCH lead is 6 h). */
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
  /** Forecast cutoff = kickoff minus this many hours (default: the production PRE_MATCH lead). */
  readonly cutoffHoursBeforeKickoff?: number;
  /** Training boundary (rho is fitted here) = cutoff minus this many hours. */
  readonly trainingLagHours?: number;
  /** Result knowledge boundary = kickoff plus this many hours. */
  readonly evaluationLagHours?: number;
  /** Admit a cohort below the policy minimum (the verdict is then INCONCLUSIVE by construction). Not part of the pair identity. */
  readonly allowSmallCohort?: boolean;
}

/** One stored result version; the cohort replays the exact predicate the backtest executes (`evaluateWindow`). */
export interface ComparisonResultVersion {
  readonly id: string;
  readonly observedAt: Date;
  readonly effectiveAt: Date;
  readonly supersedesResultVersionId: string | null;
  readonly status: string;
  readonly homeGoals: number | null;
  readonly awayGoals: number | null;
}

export interface ComparisonFixture {
  readonly id: string;
  readonly kickoffUtc: Date;
  /** Every stored result version; a fixture is eligible only if the graph resolved at evaluationAsOf yields a FINISHED, scored leaf. */
  readonly resultVersions: readonly ComparisonResultVersion[];
  /**
   * True only when BOTH teams have a PUBLISHED evidence build whose cutoff is exactly kickoff minus the lead.
   * A window without it cannot complete: an earlier build fails `verifyEvidence` with EVIDENCE_CUTOFF_MISMATCH.
   */
  readonly hasEvidenceAtCutoff: boolean;
}

/** Why fixtures of the range did not become windows. Selection never looks at outcomes or metrics. */
export interface ComparisonCohortReport {
  /** Fixtures with `from <= kickoff < to`. Invariant: considered = usable + sum of skipped. */
  readonly considered: number;
  readonly usable: number;
  readonly skipped: {
    readonly noResultByEvaluationAsOf: number;
    readonly noPublishedEvidenceAtCutoff: number;
    readonly sharedCutoffInstant: number;
  };
  readonly leadHours: number;
  readonly minimumRequired: number;
  readonly tieBreak: "smallest-fixture-id";
}

export interface ComparisonCohort {
  readonly eligible: readonly ComparisonFixture[];
  readonly report: ComparisonCohortReport;
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
  readonly allowSmallCohort: boolean;
}

export interface ComparisonPlanPair {
  readonly pairId: string;
  readonly params: ResolvedComparisonParams;
  readonly left: BacktestPlanReceipt;
  readonly right: BacktestPlanReceipt;
  readonly windowCount: number;
  readonly cohort: ComparisonCohortReport;
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
    cutoffHoursBeforeKickoff: positiveHours(params.cutoffHoursBeforeKickoff, PRE_MATCH_CUTOFF_LEAD_HOURS, "INVALID_CUTOFF_HOURS"),
    trainingLagHours: positiveHours(params.trainingLagHours, 24, "INVALID_TRAINING_LAG_HOURS"),
    evaluationLagHours: positiveHours(params.evaluationLagHours, 48, "INVALID_EVALUATION_LAG_HOURS"),
    allowSmallCohort: params.allowSmallCohort === true,
  });
}

/** Code-unit comparison: the cohort and the pair id must not depend on the locale of the machine. */
function compareIds(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }

/**
 * True when the backtest would find a scoreable result for the fixture at `evaluationAsOf`: a version both observed and
 * effective by then (`observedAt <= asOf AND effectiveAt <= asOf`, as in `evaluateWindow`), a valid lineage with one leaf,
 * and a FINISHED leaf with both goals. Anything else makes `evaluateWindow` fail (RESULT_NOT_AVAILABLE,
 * BACKTEST_SCORE_IDS_EMPTY) and would take the whole plan down with it.
 */
function hasScoreableResultAt(fixture: ComparisonFixture, evaluationAsOf: number): boolean {
  try {
    const leaf = resolveHistoricalResultGraph(fixture.resultVersions.map((version) => ({ id: version.id, fixtureId: fixture.id, observedAt: version.observedAt, effectiveAt: version.effectiveAt, supersedesResultVersionId: version.supersedesResultVersionId })), fixture.id, new Date(evaluationAsOf));
    const version = fixture.resultVersions.find((candidate) => candidate.id === leaf.id);
    return version?.status === "FINISHED" && version.homeGoals !== null && version.awayGoals !== null;
  } catch (error) {
    if (typeof (error as { code?: unknown }).code === "string" && (error as { code: string }).code.startsWith("RESULT_")) return false;
    throw error;
  }
}

/**
 * Pure cohort selection. Considers fixtures with `from <= kickoff < to` in (kickoff, id) order and skips, in this order:
 * no scoreable result known by evaluationAsOf (observed AND effective by then, FINISHED leaf); no PUBLISHED evidence of both teams at the exact cutoff; a lost tie-break on a
 * shared cutoff instant (the fixture with the smallest id stays). A fixture that fails an earlier check never occupies
 * a tie-break slot. Selection reads neither outcomes nor metrics, so it cannot bias the comparison.
 */
export function planComparisonCohort(fixtures: readonly ComparisonFixture[], params: ResolvedComparisonParams): ComparisonCohort {
  const from = Date.parse(params.from); const to = Date.parse(params.to);
  const considered = fixtures
    .filter((fixture) => fixture.kickoffUtc.getTime() >= from && fixture.kickoffUtc.getTime() < to)
    .sort((a, b) => a.kickoffUtc.getTime() - b.kickoffUtc.getTime() || compareIds(a.id, b.id));
  const skipped = { noResultByEvaluationAsOf: 0, noPublishedEvidenceAtCutoff: 0, sharedCutoffInstant: 0 };
  const takenCutoffs = new Set<number>();
  const eligible: ComparisonFixture[] = [];
  for (const fixture of considered) {
    const kickoff = fixture.kickoffUtc.getTime();
    if (!hasScoreableResultAt(fixture, kickoff + params.evaluationLagHours * HOUR_MS)) { skipped.noResultByEvaluationAsOf += 1; continue; }
    if (!fixture.hasEvidenceAtCutoff) { skipped.noPublishedEvidenceAtCutoff += 1; continue; }
    const cutoff = kickoff - params.cutoffHoursBeforeKickoff * HOUR_MS;
    if (takenCutoffs.has(cutoff)) { skipped.sharedCutoffInstant += 1; continue; }
    takenCutoffs.add(cutoff);
    eligible.push(fixture);
  }
  return Object.freeze({
    eligible: Object.freeze(eligible),
    report: Object.freeze({ considered: considered.length, usable: eligible.length, skipped: Object.freeze(skipped), leadHours: params.cutoffHoursBeforeKickoff, minimumRequired: MODEL_COMPARISON_POLICY.minimumSampleSize, tieBreak: "smallest-fixture-id" as const }),
  });
}

/**
 * The single runnability predicate shared by the CLI and `buildComparisonPlanPair`: no usable window is never runnable;
 * a cohort below the policy minimum is runnable only with an explicit `allowSmallCohort`.
 */
export function isCohortRunnable(report: ComparisonCohortReport, allowSmallCohort: boolean): boolean {
  return cohortBlockReason(report, allowSmallCohort) === null;
}

export function cohortBlockReason(report: ComparisonCohortReport, allowSmallCohort: boolean): "COMPARISON_NO_ELIGIBLE_FIXTURES" | "COMPARISON_COHORT_BELOW_MINIMUM" | null {
  if (report.usable === 0) return "COMPARISON_NO_ELIGIBLE_FIXTURES";
  if (report.usable < report.minimumRequired && !allowSmallCohort) return "COMPARISON_COHORT_BELOW_MINIMUM";
  return null;
}

/** Plain-Russian cohort report; every number comes from the report. */
export function describeCohort(report: ComparisonCohortReport): string {
  return [
    `Когорта: рассмотрено матчей ${report.considered}, пригодных окон ${report.usable} (минимум для вывода: ${report.minimumRequired}).`,
    `Пропущено: нет результата к evaluationAsOf — ${report.skipped.noResultByEvaluationAsOf} (учитывается результат, внесённый и вступивший в силу к evaluationAsOf, с итоговым статусом FINISHED); нет опубликованных доказательств обеих команд на отсечку (матч минус ${report.leadHours} ч) — ${report.skipped.noPublishedEvidenceAtCutoff}; общий момент отсечки — ${report.skipped.sharedCutoffInstant} (на один момент оставлен матч с наименьшим id).`,
  ].join("\n");
}

function windowsFor(eligible: readonly ComparisonFixture[], params: ResolvedComparisonParams, idPrefix: string): RollingOriginWindow[] {
  return eligible.map((fixture) => {
    const kickoff = fixture.kickoffUtc.getTime();
    const cutoff = kickoff - params.cutoffHoursBeforeKickoff * HOUR_MS;
    return {
      id: `${idPrefix}:${fixture.id}`,
      fixtureId: fixture.id,
      trainingEndsAt: new Date(cutoff - params.trainingLagHours * HOUR_MS).toISOString(),
      forecastCutoff: new Date(cutoff).toISOString(),
      evaluationAsOf: new Date(kickoff + params.evaluationLagHours * HOUR_MS).toISOString(),
    };
  });
}

/**
 * Pure rolling-origin window generator over the cohort. Cutoffs are `kickoff - lead` exactly (the only instant with an
 * evidence build) and strictly increasing, because simultaneous kickoffs are removed by the cohort tie-break.
 */
export function buildComparisonWindows(fixtures: readonly ComparisonFixture[], params: ResolvedComparisonParams, idPrefix: string): RollingOriginWindow[] {
  return windowsFor(planComparisonCohort(fixtures, params).eligible, params, idPrefix);
}

/** Deterministic pair identity: same parameters and the same fixture set always give the same plan ids and hashes. */
export function buildComparisonPlanPair(params: ComparisonParams, fixtures: readonly ComparisonFixture[]): ComparisonPlanPair {
  const resolved = resolveComparisonParams(params);
  const { eligible, report } = planComparisonCohort(fixtures, resolved);
  const blocked = cohortBlockReason(report, resolved.allowSmallCohort);
  if (blocked) throw coded(blocked);
  const windowsForIdentity = windowsFor(eligible, resolved, "w");
  if (windowsForIdentity.length > BACKTEST_LIMITS.maxWindows) throw coded("BACKTEST_LIMIT_EXCEEDED");
  // The admission flag decides whether to submit, not what the plans contain, so it stays out of the identity.
  const identity = { ...resolved, allowSmallCohort: undefined }; // JSON.stringify drops undefined: the hash ignores the flag
  const pairId = createHash("sha256").update(JSON.stringify({ resolved: identity, windows: windowsForIdentity })).digest("hex").slice(0, 12);
  const build = (side: "left" | "right", suffix: string): BacktestPlanReceipt => {
    const modelVersion = COMPARISON_MODELS[side];
    const id = `cmp-${pairId}-${suffix}`;
    const windows = windowsFor(eligible, resolved, id);
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
  return Object.freeze({ pairId, params: resolved, left: build("left", "poisson"), right: build("right", "dixon-coles"), windowCount: windowsForIdentity.length, cohort: report });
}

type FixtureReader = Pick<PrismaClient, "fixture" | "evidenceBuild">;

export async function listComparisonFixtures(database: FixtureReader, params: ResolvedComparisonParams): Promise<ComparisonFixture[]> {
  const rows = await database.fixture.findMany({
    where: { status: "FINISHED", kickoffUtc: { gte: new Date(params.from), lt: new Date(params.to) }, ...(params.leagueIds.length > 0 ? { leagueId: { in: [...params.leagueIds] } } : {}) },
    select: { id: true, kickoffUtc: true, homeTeamId: true, awayTeamId: true, resultVersions: { select: { id: true, observedAt: true, effectiveAt: true, supersedesResultVersionId: true, status: true, homeGoals: true, awayGoals: true }, orderBy: { revision: "asc" } } },
    orderBy: [{ kickoffUtc: "asc" }, { id: "asc" }],
  });
  if (rows.length === 0) return [];
  const cutoffOf = (kickoff: Date) => kickoff.getTime() - params.cutoffHoursBeforeKickoff * HOUR_MS;
  const teamIds = [...new Set(rows.flatMap((row) => [row.homeTeamId, row.awayTeamId]))];
  const cutoffs = [...new Set(rows.map((row) => cutoffOf(row.kickoffUtc)))].map((ms) => new Date(ms));
  // Exact equality of the cutoff: an earlier build is what makes verifyEvidence fail with EVIDENCE_CUTOFF_MISMATCH.
  const builds = await database.evidenceBuild.findMany({ where: { state: "PUBLISHED", teamId: { in: teamIds }, cutoff: { in: cutoffs } }, select: { teamId: true, cutoff: true } });
  const published = new Set(builds.map((build) => `${build.teamId}|${build.cutoff.getTime()}`));
  return rows.map((row) => {
    const cutoff = cutoffOf(row.kickoffUtc);
    return {
      id: row.id,
      kickoffUtc: row.kickoffUtc,
      resultVersions: row.resultVersions,
      hasEvidenceAtCutoff: published.has(`${row.homeTeamId}|${cutoff}`) && published.has(`${row.awayTeamId}|${cutoff}`),
    };
  });
}

type SubmitDeps = Parameters<typeof admitPersistEnqueueBacktest>[1];

/** State of a plan's queue job, as `createBacktestQueue().inspect` reports it. */
export interface BacktestJobStatus { readonly state: string; readonly attemptsMade: number; readonly attempts: number }
export interface BacktestJobRef { readonly planId: string; readonly planHash: string }

/** The backtest queue as the operator entry point uses it; `inspect` is optional so a plain `{ enqueue }` still works. */
export type ComparisonQueue = SubmitDeps["queue"] & { inspect?: (ref: BacktestJobRef) => Promise<BacktestJobStatus | null> };

/** BullMQ states in which the job still has a run (or a retry) ahead of it; `failed` means the attempts are used up. */
const LIVE_JOB_STATES: ReadonlySet<string> = new Set(["active", "delayed", "prioritized", "waiting", "waiting-children"]);
export function jobCanStillRun(status: BacktestJobStatus | null): boolean { return status !== null && LIVE_JOB_STATES.has(status.state); }

/** Idempotent: the same pair resubmitted re-uses the persisted plans and the deterministic queue job ids. */
export async function submitComparisonPair(pair: ComparisonPlanPair, input: Omit<SubmitDeps, "correlationId" | "queue"> & { queue: ComparisonQueue }): Promise<{ leftPlanId: string; rightPlanId: string }> {
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
  /**
   * A FAILED window is one failed ATTEMPT: BullMQ retries the job with backoff and the window then goes FAILED -> RUNNING again.
   * When given, a failed window only ends the wait once the plan's job cannot run any more. Without it the first failure is final.
   */
  canStillRun?: (planId: string) => Promise<boolean>;
}): Promise<{ outcome: WaitOutcome; progress: readonly PlanProgress[] }> {
  const sleep = input.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = input.now ?? Date.now;
  const deadline = now() + input.timeoutMs;
  for (;;) {
    const progress = await Promise.all(input.planIds.map((id) => input.read(id)));
    input.onProgress?.(progress);
    const failing = progress.filter((item) => !item.found || (item.windows.FAILED ?? 0) > 0 || item.state === "FAILED");
    if (failing.length > 0) {
      const final = await Promise.all(failing.map(async (item) => !item.found || item.state === "FAILED" || !(await input.canStillRun?.(item.planId) ?? false)));
      if (final.some(Boolean)) return { outcome: "FAILED", progress };
    }
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
