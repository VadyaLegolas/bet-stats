import {
  BACKTEST_POLICY_VERSION,
  validateRollingOriginWindow,
  type BacktestOriginResult,
  type ForecastOrchestrator,
  type ForecastOrchestratorRepository,
  type RollingOriginWindow,
} from "@bet-stats/domain";
import { createHash } from "node:crypto";

export const BACKTEST_LIMITS = Object.freeze({ maxSpanDays: 366, maxWindows: 500, maxConcurrency: 4 });

export interface BacktestPlanReceipt {
  readonly id: string;
  readonly version: typeof BACKTEST_POLICY_VERSION;
  readonly modelVersion: "poisson-ensemble-v1";
  readonly configHash: string;
  readonly rangeFrom: string;
  readonly rangeTo: string;
  readonly concurrency: number;
  readonly windows: readonly RollingOriginWindow[];
  readonly planHash: string;
}

function error(code: string): Error & { code: string } { return Object.assign(new Error(code), { code }); }
function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }

export function admitBacktestPlan(raw: unknown): BacktestPlanReceipt {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw error("INVALID_BACKTEST_PLAN");
  const value = raw as Record<string, unknown>;
  if ("split" in value || "shuffle" in value || "random" in value) throw error("RANDOM_SPLIT_REJECTED");
  const allowed = new Set(["id", "version", "modelVersion", "configHash", "rangeFrom", "rangeTo", "concurrency", "windows", "planHash"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) throw error("INVALID_BACKTEST_PLAN");
  if (typeof value.id !== "string" || value.version !== BACKTEST_POLICY_VERSION || value.modelVersion !== "poisson-ensemble-v1" || typeof value.configHash !== "string" || !Array.isArray(value.windows)) throw error("INVALID_BACKTEST_PLAN");
  const from = Date.parse(String(value.rangeFrom)); const to = Date.parse(String(value.rangeTo)); const concurrency = Number(value.concurrency);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to || to - from > BACKTEST_LIMITS.maxSpanDays * 86_400_000 || value.windows.length < 1 || value.windows.length > BACKTEST_LIMITS.maxWindows || !Number.isInteger(concurrency) || concurrency < 1 || concurrency > BACKTEST_LIMITS.maxConcurrency) throw error("BACKTEST_LIMIT_EXCEEDED");
  let previous: string | undefined;
  const windows = value.windows.map((candidate) => {
    const window = validateRollingOriginWindow(candidate as RollingOriginWindow, previous);
    if (Date.parse(window.forecastCutoff) < from || Date.parse(window.forecastCutoff) > to) throw error("BACKTEST_WINDOW_OUT_OF_RANGE");
    previous = window.forecastCutoff;
    return Object.freeze({ ...window });
  });
  const canonical = { id: value.id, version: BACKTEST_POLICY_VERSION, modelVersion: "poisson-ensemble-v1" as const, configHash: value.configHash, rangeFrom: new Date(from).toISOString(), rangeTo: new Date(to).toISOString(), concurrency, windows };
  const planHash = digest(canonical);
  if (typeof value.planHash === "string" && value.planHash !== planHash) throw error("BACKTEST_PLAN_HASH_MISMATCH");
  return Object.freeze({ ...canonical, planHash });
}

export function createBacktestJob(plan: BacktestPlanReceipt) {
  return { name: "rolling-origin" as const, jobId: `backtest:${plan.id}:${plan.planHash}`, attempts: 3, backoff: { type: "exponential" as const, delay: 1_000 }, removeOnFail: false, data: { planId: plan.id, planHash: plan.planHash } };
}

export interface BacktestWindowReceipt extends RollingOriginWindow { readonly planId: string; readonly state: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED"; readonly evidenceBuildIds?: readonly string[]; readonly forecastSnapshotId?: string; readonly scoreIds?: readonly string[]; readonly correlationId: string }
export interface BacktestReceiptRepository {
  createPlan(plan: BacktestPlanReceipt): Promise<void>;
  findPlan(id: string): Promise<BacktestPlanReceipt | null>;
  claimWindow(receipt: BacktestWindowReceipt): Promise<{ claimed: boolean; receipt: BacktestWindowReceipt }>;
  completeWindow(id: string, output: { evidenceBuildIds: readonly string[]; forecastSnapshotId: string; scoreIds: readonly string[] }): Promise<void>;
  failWindow(id: string, code: string): Promise<void>;
  completePlan(id: string): Promise<void>;
}

export async function runBacktestPlan(input: { plan: BacktestPlanReceipt; receipts: BacktestReceiptRepository; orchestrator: ForecastOrchestrator; repository: ForecastOrchestratorRepository; correlationId: string }) {
  const existing = await input.receipts.findPlan(input.plan.id);
  if (existing && existing.planHash !== input.plan.planHash) throw error("BACKTEST_PLAN_ID_CONFLICT");
  if (!existing) await input.receipts.createPlan(input.plan);
  const completedWindowIds: string[] = []; const duplicateWindowIds: string[] = [];
  for (const window of input.plan.windows) {
    const receipt: BacktestWindowReceipt = { ...window, planId: input.plan.id, state: "PENDING", correlationId: input.correlationId };
    const claim = await input.receipts.claimWindow(receipt);
    if (!claim.claimed) { duplicateWindowIds.push(window.id); completedWindowIds.push(window.id); continue; }
    try {
      const result = await runBacktestOrigin({ orchestrator: input.orchestrator, repository: input.repository, window, modelVersion: input.plan.modelVersion, configHash: input.plan.configHash, correlationId: input.correlationId, planId: input.plan.id });
      await input.receipts.completeWindow(window.id, { evidenceBuildIds: result.forecast.evidenceBuildIds, forecastSnapshotId: result.forecast.id, scoreIds: [] });
      completedWindowIds.push(window.id);
    } catch (cause) { await input.receipts.failWindow(window.id, cause instanceof Error ? cause.message : "BACKTEST_FAILED"); throw cause; }
  }
  await input.receipts.completePlan(input.plan.id);
  return { state: "SUCCEEDED" as const, completedWindowIds, duplicateWindowIds };
}

export interface RunBacktestOriginInput {
  readonly orchestrator: ForecastOrchestrator;
  readonly repository: ForecastOrchestratorRepository;
  readonly window: RollingOriginWindow;
  readonly modelVersion: "poisson-ensemble-v1";
  readonly configHash: string;
  readonly correlationId: string;
  readonly planId?: string;
}

export async function runBacktestOrigin(input: RunBacktestOriginInput): Promise<BacktestOriginResult> {
  const window = validateRollingOriginWindow(input.window);
  const forecast = await input.orchestrator.run({
    fixtureId: window.fixtureId,
    asOf: window.forecastCutoff,
    kind: "PRE_MATCH",
    modelVersion: input.modelVersion,
    configHash: input.configHash,
    initiator: { type: "backtest", correlationId: input.correlationId, windowId: window.id, ...(input.planId ? { planId: input.planId } : {}) },
  }, input.repository);
  return { window, forecast };
}
