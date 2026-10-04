import { createHash } from "node:crypto";

import { SETTLEMENT_POLICY_VERSION } from "@bet-stats/domain";

import type { PrismaClient } from "../client.js";
import type { SettlementPipelineCommand, SettlementPipelineResult } from "./settlement-pipeline.js";

type SettlementService = { process(command: SettlementPipelineCommand): Promise<SettlementPipelineResult> };
type Plan = {
  id: string; version: string; planHash: string; modelVersion: string; configHash: string;
  rangeFrom: string; rangeTo: string; concurrency: number;
  windows: ReadonlyArray<{ id: string; fixtureId: string; trainingEndsAt: string; forecastCutoff: string; evaluationAsOf: string }>;
};
type WindowReceipt = Plan["windows"][number] & { planId: string; state: string; correlationId: string };

function coded(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}

function stableId(kind: string, ...parts: string[]): string {
  return `${kind}_${createHash("sha256").update(parts.join("\u001f")).digest("hex")}`;
}

type ResultNode = { id: string; fixtureId: string; observedAt: Date; effectiveAt: Date; supersedesResultVersionId: string | null };

export function resolveHistoricalResultGraph(rows: readonly ResultNode[], fixtureId: string, evaluationAsOf: Date): ResultNode {
  const boundary = evaluationAsOf.getTime();
  const included = rows.filter((row) => row.fixtureId === fixtureId && row.observedAt.getTime() <= boundary && row.effectiveAt.getTime() <= boundary);
  if (included.length === 0) throw coded("RESULT_NOT_AVAILABLE");
  if (included.some((row) => row.observedAt.getTime() > boundary || row.effectiveAt.getTime() > boundary)) throw coded("RESULT_TIME_BOUNDARY_VIOLATION");
  const byId = new Map(included.map((row) => [row.id, row]));
  for (const row of included) {
    const seen = new Set<string>();
    let cursor: ResultNode | undefined = row;
    while (cursor?.supersedesResultVersionId) {
      if (seen.has(cursor.id)) throw coded("RESULT_LINEAGE_INVALID");
      seen.add(cursor.id);
      cursor = byId.get(cursor.supersedesResultVersionId);
      if (!cursor) throw coded("RESULT_LINEAGE_INVALID");
    }
  }
  const superseded = new Set(included.flatMap((row) => row.supersedesResultVersionId ? [row.supersedesResultVersionId] : []));
  const leaves = included.filter((row) => !superseded.has(row.id));
  if (leaves.length === 0) throw coded("RESULT_LINEAGE_INVALID");
  if (leaves.length !== 1) throw coded("RESULT_VERSION_AMBIGUOUS");
  return leaves[0]!;
}

export function createPrismaBacktestReceiptRepository({ database, settlementService }: { database: PrismaClient; settlementService: SettlementService }) {
  const findPlan = async (id: string): Promise<Plan | null> => {
    const plan = await database.backtestPlan.findUnique({ where: { id }, include: { windows: { orderBy: { ordinal: "asc" } } } });
    if (!plan) return null;
    return {
      id: plan.id, version: plan.version, planHash: plan.planHash, modelVersion: plan.modelVersion,
      configHash: plan.configHash, rangeFrom: plan.rangeFrom.toISOString(), rangeTo: plan.rangeTo.toISOString(), concurrency: plan.concurrency,
      windows: plan.windows.map((window) => ({ id: window.id, fixtureId: window.fixtureId, trainingEndsAt: window.trainingEndsAt.toISOString(), forecastCutoff: window.forecastCutoff.toISOString(), evaluationAsOf: window.evaluationAsOf.toISOString() })),
    };
  };
  return {
    async createPlan(plan: Plan, correlationId = `backtest:${plan.id}`): Promise<void> {
      await database.$transaction(async (tx) => {
        const existing = await tx.backtestPlan.findUnique({ where: { id: plan.id } });
        if (existing) {
          if (existing.planHash !== plan.planHash) throw coded("BACKTEST_PLAN_ID_CONFLICT");
          return;
        }
        await tx.backtestPlan.create({ data: {
          id: plan.id, version: plan.version, planHash: plan.planHash, modelVersion: plan.modelVersion, configHash: plan.configHash,
          rangeFrom: new Date(plan.rangeFrom), rangeTo: new Date(plan.rangeTo), concurrency: plan.concurrency, state: "PENDING", correlationId,
          receipt: plan as never, windows: { create: plan.windows.map((window, ordinal) => ({ ...window, ordinal, trainingEndsAt: new Date(window.trainingEndsAt), forecastCutoff: new Date(window.forecastCutoff), evaluationAsOf: new Date(window.evaluationAsOf), state: "PENDING", correlationId, receipt: window as never })) },
        } });
      });
    },
    findPlan,
    async markDelivery(planId: string, state: "PENDING" | "RETRYABLE" | "DELIVERED"): Promise<void> {
      await database.backtestPlan.update({ where: { id: planId }, data: { deliveryState: state, deliveryAttempts: { increment: 1 }, ...(state === "DELIVERED" ? { enqueuedAt: new Date() } : {}) } });
    },
    async listPendingDelivery(): Promise<Array<{ id: string; planHash: string; correlationId: string }>> {
      return database.backtestPlan.findMany({ where: { deliveryState: { in: ["PENDING", "RETRYABLE"] } }, select: { id: true, planHash: true, correlationId: true }, orderBy: { createdAt: "asc" }, take: 100 });
    },
    async claimWindow(receipt: WindowReceipt) {
      const changed = await database.backtestWindow.updateMany({ where: { id: receipt.id, planId: receipt.planId, state: { in: ["PENDING", "FAILED"] } }, data: { state: "RUNNING", failureCode: null, correlationId: receipt.correlationId } });
      const row = await database.backtestWindow.findUniqueOrThrow({ where: { id: receipt.id } });
      return { claimed: changed.count === 1, receipt: { ...receipt, state: row.state } };
    },
    async evaluateWindow(windowId: string, input: { fixtureId: string; forecastSnapshotId: string; evaluationAsOf: string; correlationId: string }) {
      const evaluationAsOf = new Date(input.evaluationAsOf);
      const rows = await database.$queryRawUnsafe<ResultNode[]>(`SELECT id,"fixtureId","observedAt","effectiveAt","supersedesResultVersionId" FROM "ResultVersion" WHERE "fixtureId"=$1 AND "observedAt" <= $2 AND "effectiveAt" <= $2 ORDER BY revision`, input.fixtureId, evaluationAsOf);
      const selected = resolveHistoricalResultGraph(rows, input.fixtureId, evaluationAsOf);
      const settled = await settlementService.process({ fixtureId: input.fixtureId, resultVersionId: selected.id, forecastSnapshotId: input.forecastSnapshotId, policyVersion: SETTLEMENT_POLICY_VERSION, correlationId: input.correlationId });
      if (settled.forecastScoreIds.length === 0 || settled.forecastScoreIds.some((id) => !id)) throw coded("BACKTEST_SCORE_IDS_EMPTY");
      return database.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", `${windowId}:backtest-evaluation`);
        const current = await tx.backtestEvaluation.findFirst({ where: { windowId, isCurrent: true }, orderBy: { revision: "desc" } });
        const same = await tx.backtestEvaluation.findUnique({ where: { windowId_evaluationAsOf: { windowId, evaluationAsOf } } });
        if (same) return same;
        if (current) await tx.backtestEvaluation.update({ where: { id: current.id }, data: { isCurrent: false } });
        const revision = (current?.revision ?? 0) + 1;
        return tx.backtestEvaluation.create({ data: {
          id: stableId("backtest_eval", windowId, evaluationAsOf.toISOString(), selected.id), windowId, evaluationAsOf,
          resultVersionId: selected.id, settlementReceiptId: settled.settlementReceiptId, scoreIds: settled.forecastScoreIds as never,
          revision, supersedesEvaluationId: current?.id ?? null, isCurrent: true,
          receipt: { resultVersionId: selected.id, settlementReceiptId: settled.settlementReceiptId, scoreIds: settled.forecastScoreIds, evaluationAsOf: evaluationAsOf.toISOString(), correlationId: input.correlationId } as never,
        } });
      });
    },
    async completeWindow(id: string, output: { evidenceBuildIds: readonly string[]; forecastSnapshotId: string; scoreIds: readonly string[] }): Promise<void> {
      if (output.scoreIds.length === 0) throw coded("BACKTEST_SCORE_IDS_EMPTY");
      await database.backtestWindow.update({ where: { id }, data: { state: "SUCCEEDED", evidenceBuildIds: [...output.evidenceBuildIds] as never, forecastSnapshotId: output.forecastSnapshotId, scoreIds: [...output.scoreIds] as never, completedAt: new Date() } });
    },
    async failWindow(id: string, code: string): Promise<void> { await database.backtestWindow.update({ where: { id }, data: { state: "FAILED", failureCode: code.slice(0, 64) } }); },
    async completePlan(id: string): Promise<void> {
      const remaining = await database.backtestWindow.count({ where: { planId: id, state: { not: "SUCCEEDED" } } });
      if (remaining !== 0) throw coded("BACKTEST_PLAN_INCOMPLETE");
      await database.backtestPlan.update({ where: { id }, data: { state: "SUCCEEDED", completedAt: new Date() } });
    },
  };
}

export async function compareBacktestPlans(database: PrismaClient, input: { leftPlanId: string; rightPlanId: string; market: string; from: string; to: string }) {
  const plans = await database.backtestPlan.findMany({ where: { id: { in: [input.leftPlanId, input.rightPlanId] } }, include: { windows: { orderBy: { ordinal: "asc" }, include: { evaluations: { where: { isCurrent: true } } } } } });
  if (plans.length !== 2 || plans.some((plan) => plan.state !== "SUCCEEDED")) return { available: false as const, reason: "PLAN_NOT_COMPLETE" };
  const first = plans[0]!;
  const second = plans[1]!;
  const left = input.leftPlanId === first.id ? first : second;
  const right = input.leftPlanId === first.id ? second : first;
  const identity = (plan: typeof first) => plan.windows.map((w) => `${w.fixtureId}|${w.forecastCutoff.toISOString()}|${w.evaluationAsOf.toISOString()}`);
  if (left.version !== right.version || JSON.stringify(identity(left)) !== JSON.stringify(identity(right))) return { available: false as const, reason: "COHORT_MISMATCH" };
  const aggregate = async (plan: typeof first) => {
    const scoreIds = plan.windows.flatMap((window) => window.evaluations.flatMap((evaluation) => evaluation.scoreIds as string[]));
    if (scoreIds.length === 0) throw coded("BACKTEST_SCORE_IDS_EMPTY");
    const scores = await database.forecastScore.findMany({ where: { id: { in: scoreIds }, market: input.market, kickoffUtc: { gte: new Date(input.from), lte: new Date(input.to) } }, select: { brierScore: true, logLoss: true } });
    if (scores.length === 0) throw coded("COMPARISON_EMPTY_COHORT");
    return { modelVersion: plan.modelVersion, configHash: plan.configHash, sampleSize: scores.length, brierScore: scores.reduce((s, x) => s + x.brierScore, 0) / scores.length, logLoss: scores.reduce((s, x) => s + x.logLoss, 0) / scores.length };
  };
  try {
    const leftMetrics = await aggregate(left); const rightMetrics = await aggregate(right);
    if (leftMetrics.sampleSize !== rightMetrics.sampleSize) return { available: false as const, reason: "COHORT_MISMATCH" };
    return { available: true as const, market: input.market, sampleSize: leftMetrics.sampleSize, left: leftMetrics, right: rightMetrics, deltas: { brierScore: rightMetrics.brierScore - leftMetrics.brierScore, logLoss: rightMetrics.logLoss - leftMetrics.logLoss } };
  } catch (error) { return { available: false as const, reason: (error as { code?: string }).code ?? "COMPARISON_UNAVAILABLE" }; }
}
