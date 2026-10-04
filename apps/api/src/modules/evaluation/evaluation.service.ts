import { BadRequestException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { createPrismaClient, type PrismaClient } from "@bet-stats/database";
import {
  COHORT_HEALTH_POLICY,
  RELIABILITY_POLICY,
  SCORE_FORMULA_HASH,
  aggregateFlatOneUnit,
  aggregateReliability,
  evaluateCohortHealth,
  expandCategoricalScore,
  type CohortDenominators,
  type FlatOneUnitReceipt,
  type ReliabilityBucket,
} from "@bet-stats/domain";

const MARKETS = new Set(["all", "ONE_X_TWO", "OVER_UNDER_2_5", "BTTS"]);
const MAX_PERIOD_MS = 366 * 24 * 60 * 60 * 1_000;

export type CohortIdentity = Readonly<{
  modelVersion: string;
  competitionId: string;
  market: string;
  from: string;
  to: string;
}>;

export type ScorecardCohort = Readonly<{
  cohortIdentity: CohortIdentity;
  health: { state: "UNAVAILABLE" | "LIMITED" | "AVAILABLE"; reasons: readonly string[]; performanceClaim: "QUALIFIED_EVIDENCE" | null };
  denominators: CohortDenominators;
  metrics: { meanBrierScore: number; meanLogLoss: number } | null;
  reliability: { policyId: string; buckets: readonly ReliabilityBucket[] };
  financial: { count: number; totalStakedUnits: string; totalProfitUnits: string; roi: string | null; yield: string | null; policyId: string };
  clv: { status: "AVAILABLE" | "UNAVAILABLE"; reason: string | null; comparableCount: number };
  receipts: { formulaId: string; cohortPolicyId: string };
}>;

export type ValueCandidateRow = Readonly<{
  id: string;
  valueReceiptId: string;
  settlementReceiptId: string;
  resultVersionId: string;
  selection: string;
  decimalOdds: string;
  outcome: string;
  stakeUnits: string;
  profitUnits: string;
  clv: { status: string; reason: string | null; value: string | null };
  settledAt: string;
}>;

export interface EvaluationRepository {
  loadCohort(identity: CohortIdentity): Promise<ScorecardCohort>;
  enumerateAvailableCohorts(bounds: Pick<CohortIdentity, "from" | "to">): Promise<readonly ScorecardCohort[]>;
  listValueCandidates(identity: CohortIdentity, cursor: { settledAt: string; id: string } | null, limit: number): Promise<{
    items: readonly ValueCandidateRow[];
    nextCursor: { settledAt: string; id: string } | null;
    pageTotals: { count: number; stakeUnits: string; profitUnits: string };
  }>;
}

type CandidateCursor = { cohortIdentity: CohortIdentity; settledAt: string; id: string };

export function encodeCandidateCursor(identity: CohortIdentity, position: { settledAt: string; id: string }): string {
  return Buffer.from(JSON.stringify({ cohortIdentity: identity, settledAt: position.settledAt, id: position.id }), "utf8").toString("base64url");
}

function decodeCandidateCursor(value: string, expected: CohortIdentity): { settledAt: string; id: string } {
  try {
    if (value.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error();
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as CandidateCursor;
    if (!decoded || Object.keys(decoded).sort().join(",") !== "cohortIdentity,id,settledAt") throw new Error();
    if (JSON.stringify(decoded.cohortIdentity) !== JSON.stringify(expected)) throw new BadRequestException("CURSOR_COHORT_MISMATCH");
    exactUtc(decoded.settledAt, "cursor_settled_at");
    scalar(decoded.id, "cursor_id");
    return { settledAt: decoded.settledAt, id: decoded.id };
  } catch (error) {
    if (error instanceof BadRequestException && error.message === "CURSOR_COHORT_MISMATCH") throw error;
    throw new BadRequestException("INVALID_CURSOR");
  }
}

function exactUtc(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) throw new BadRequestException(`INVALID_${field.toUpperCase()}`);
  const date = new Date(value);
  if (!Number.isFinite(date.valueOf()) || date.toISOString() !== value) throw new BadRequestException(`INVALID_${field.toUpperCase()}`);
  return value;
}

function scalar(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "" || value.length > 128) throw new BadRequestException(`INVALID_${field.toUpperCase()}`);
  return value;
}

export function parseCohortQuery(query: Record<string, unknown>, requireDimensions = true): CohortIdentity | Pick<CohortIdentity, "from" | "to"> {
  const allowed = new Set(["modelVersion", "competitionId", "market", "from", "to"]);
  if (Object.keys(query).some((key) => !allowed.has(key)) || Object.values(query).some(Array.isArray)) throw new BadRequestException("INVALID_COHORT_QUERY");
  const from = exactUtc(query.from, "from");
  const to = exactUtc(query.to, "to");
  const duration = Date.parse(to) - Date.parse(from);
  if (duration <= 0 || duration > MAX_PERIOD_MS) throw new BadRequestException("INVALID_COHORT_PERIOD");
  if (!requireDimensions) return { from, to };
  const identity = { modelVersion: scalar(query.modelVersion, "modelVersion"), competitionId: scalar(query.competitionId, "competitionId"), market: scalar(query.market, "market"), from, to };
  if (!MARKETS.has(identity.market)) throw new BadRequestException("INVALID_MARKET");
  return identity;
}

export function canonicalCohortUrl(identity: CohortIdentity): string {
  const query = new URLSearchParams();
  for (const key of ["modelVersion", "competitionId", "market", "from", "to"] as const) query.set(key, identity[key]);
  return `/scorecards?${query.toString()}`;
}

function tuple(identity: CohortIdentity): string {
  return [identity.modelVersion, identity.competitionId, identity.market, identity.from, identity.to].join("\u0001");
}

function emptyCohort(identity: CohortIdentity): ScorecardCohort {
  const denominators = { fixtureCount: 0, forecastCount: 0, eventCount: 0, valueCount: 0 };
  const reliability = aggregateReliability([]);
  const health = evaluateCohortHealth({ denominators, buckets: reliability.buckets });
  const financial = aggregateFlatOneUnit([]);
  return {
    cohortIdentity: identity,
    health,
    denominators,
    metrics: null,
    reliability: { policyId: reliability.policy.identity, buckets: reliability.buckets },
    financial: { count: financial.count, totalStakedUnits: financial.totalStakedUnits, totalProfitUnits: financial.totalProfitUnits, roi: financial.roi, yield: financial.yield, policyId: financial.policyVersion },
    clv: { status: "UNAVAILABLE", reason: "NO_COMPARABLE_CLOSE", comparableCount: 0 },
    receipts: { formulaId: SCORE_FORMULA_HASH, cohortPolicyId: COHORT_HEALTH_POLICY.identity },
  };
}

export function createPrismaEvaluationRepository(client: PrismaClient): EvaluationRepository {
  async function load(identity: CohortIdentity): Promise<ScorecardCohort> {
    const scores = await client.forecastScore.findMany({
      where: {
        supersededBy: null,
        kickoffUtc: { gte: new Date(identity.from), lt: new Date(identity.to) },
        ...(identity.modelVersion === "all" ? {} : { modelVersion: identity.modelVersion }),
        ...(identity.competitionId === "all" ? {} : { leagueId: identity.competitionId }),
        ...(identity.market === "all" ? {} : { market: identity.market }),
      },
      orderBy: [{ kickoffUtc: "asc" }, { id: "asc" }],
    });
    if (scores.length === 0) return emptyCohort(identity);
    const settlementIds = [...new Set(scores.map((row) => row.settlementReceiptId))];
    const values = await client.valueSettlement.findMany({
      where: { supersededBy: null, settlementReceiptId: { in: settlementIds }, ...(identity.market === "all" ? {} : { market: identity.market }) },
      include: { settlementReceipt: { select: { resultVersionId: true, settledAt: true } }, oddsSelection: { select: { decimalOdds: true } } },
    });
    const valueByFixture = new Map(values.map((row) => [row.fixtureId, row.valueReceiptId]));
    const events = scores.flatMap((row) => expandCategoricalScore({
      settlementReceiptId: row.settlementReceiptId,
      forecastSnapshotId: row.forecastSnapshotId,
      fixtureId: row.fixtureId,
      leagueId: row.leagueId,
      market: row.market,
      modelVersion: row.modelVersion,
      kickoffUtc: row.kickoffUtc.toISOString(),
      outcome: row.outcome,
      probabilities: row.probabilities as unknown as readonly { selection: string; probability: number }[],
      valueReceiptId: valueByFixture.get(row.fixtureId) ?? null,
    }));
    const reliability = aggregateReliability(events, RELIABILITY_POLICY);
    const denominators = {
      fixtureCount: new Set(scores.map((row) => row.fixtureId)).size,
      forecastCount: new Set(scores.map((row) => row.forecastSnapshotId)).size,
      eventCount: events.length,
      valueCount: new Set(values.map((row) => row.valueReceiptId)).size,
    };
    const health = evaluateCohortHealth({ denominators, buckets: reliability.buckets });
    const financialReceipts: FlatOneUnitReceipt[] = values.map((row) => ({ status: "SETTLED", policyVersion: "flat-one-unit-v1", stakeUnits: row.stakeUnits, returnUnits: row.returnUnits, profitUnits: row.profitUnits }));
    const financial = aggregateFlatOneUnit(financialReceipts);
    const comparableCount = values.filter((row) => row.clvStatus === "AVAILABLE").length;
    return {
      cohortIdentity: identity,
      health,
      denominators,
      metrics: { meanBrierScore: scores.reduce((sum, row) => sum + row.brierScore, 0) / scores.length, meanLogLoss: scores.reduce((sum, row) => sum + row.logLoss, 0) / scores.length },
      reliability: { policyId: reliability.policy.identity, buckets: reliability.buckets },
      financial: { count: financial.count, totalStakedUnits: financial.totalStakedUnits, totalProfitUnits: financial.totalProfitUnits, roi: financial.roi, yield: financial.yield, policyId: financial.policyVersion },
      clv: { status: comparableCount > 0 ? "AVAILABLE" : "UNAVAILABLE", reason: comparableCount > 0 ? null : "NO_COMPARABLE_CLOSE", comparableCount },
      receipts: { formulaId: scores[0]!.formulaHash, cohortPolicyId: health.policy.identity },
    };
  }
  return {
    loadCohort: load,
    async enumerateAvailableCohorts(bounds) {
      const dimensions = await client.forecastScore.findMany({ where: { supersededBy: null, kickoffUtc: { gte: new Date(bounds.from), lt: new Date(bounds.to) } }, distinct: ["modelVersion", "leagueId", "market"], select: { modelVersion: true, leagueId: true, market: true } });
      return Promise.all(dimensions.map((row) => load({ modelVersion: row.modelVersion, competitionId: row.leagueId, market: row.market, ...bounds })));
    },
    async listValueCandidates(identity, cursor, limit) {
      const rows = await client.valueSettlement.findMany({
        where: {
          supersededBy: null,
          ...(identity.market === "all" ? {} : { market: identity.market }),
          settlementReceipt: {
            settledAt: { gte: new Date(identity.from), lt: new Date(identity.to) },
            forecastSnapshot: identity.modelVersion === "all" ? {} : { modelVersion: identity.modelVersion },
            fixture: identity.competitionId === "all" ? {} : { leagueId: identity.competitionId },
          },
          ...(cursor ? { OR: [
            { settlementReceipt: { settledAt: { lt: new Date(cursor.settledAt) } } },
            { settlementReceipt: { settledAt: new Date(cursor.settledAt) }, id: { lt: cursor.id } },
          ] } : {}),
        },
        include: { settlementReceipt: { select: { resultVersionId: true, settledAt: true } }, oddsSelection: { select: { decimalOdds: true } } },
        orderBy: [{ settlementReceipt: { settledAt: "desc" } }, { id: "desc" }],
        take: limit + 1,
      });
      const selected = rows.slice(0, limit);
      const items: ValueCandidateRow[] = selected.map((row) => ({
        id: row.id,
        valueReceiptId: row.valueReceiptId,
        settlementReceiptId: row.settlementReceiptId,
        resultVersionId: row.settlementReceipt.resultVersionId,
        selection: row.selection,
        decimalOdds: row.oddsSelection.decimalOdds,
        outcome: row.result,
        stakeUnits: row.stakeUnits,
        profitUnits: row.profitUnits,
        clv: { status: row.clvStatus, reason: row.clvReason, value: row.clv },
        settledAt: row.settlementReceipt.settledAt.toISOString(),
      }));
      const totals = aggregateFlatOneUnit(items.map((row) => ({ status: "SETTLED", policyVersion: "flat-one-unit-v1", stakeUnits: row.stakeUnits, returnUnits: "0", profitUnits: row.profitUnits })));
      const last = items.at(-1);
      return {
        items,
        nextCursor: rows.length > limit && last ? { settledAt: last.settledAt, id: last.id } : null,
        pageTotals: { count: items.length, stakeUnits: totals.totalStakedUnits, profitUnits: totals.totalProfitUnits },
      };
    },
  };
}

@Injectable()
export class EvaluationService {
  private readonly client: PrismaClient | null;
  private readonly repository: EvaluationRepository | null;

  constructor(@Optional() repository?: EvaluationRepository) {
    this.client = repository ? null : process.env.DATABASE_URL ? createPrismaClient(process.env.DATABASE_URL) : null;
    this.repository = repository ?? (this.client ? createPrismaEvaluationRepository(this.client) : null);
  }

  private repo(): EvaluationRepository {
    if (!this.repository) throw new NotFoundException("Evaluation evidence is unavailable");
    return this.repository;
  }

  async scorecard(query: Record<string, unknown>): Promise<{ result?: ScorecardCohort; redirect?: string }> {
    const complete = ["modelVersion", "competitionId", "market"].every((key) => query[key] !== undefined);
    if (complete) return { result: await this.repo().loadCohort(parseCohortQuery(query, true) as CohortIdentity) };
    if (["modelVersion", "competitionId", "market"].some((key) => query[key] !== undefined)) throw new BadRequestException("INCOMPLETE_COHORT_IDENTITY");
    const bounds = parseCohortQuery(query, false) as Pick<CohortIdentity, "from" | "to">;
    const candidates = (await this.repo().enumerateAvailableCohorts(bounds)).filter((candidate) => candidate.health.state === "AVAILABLE")
      .sort((a, b) => b.denominators.eventCount - a.denominators.eventCount || tuple(a.cohortIdentity).localeCompare(tuple(b.cohortIdentity)));
    const identity = candidates[0]?.cohortIdentity ?? { modelVersion: "all", competitionId: "all", market: "all", ...bounds };
    return { redirect: canonicalCohortUrl(identity) };
  }

  async valueCandidates(query: Record<string, unknown>): Promise<{ items: readonly ValueCandidateRow[]; nextCursor: string | null; pageTotals: { count: number; stakeUnits: string; profitUnits: string }; cohortIdentity: CohortIdentity }> {
    const { cursor: rawCursor, limit: rawLimit, ...cohortQuery } = query;
    const identity = parseCohortQuery(cohortQuery, true) as CohortIdentity;
    const limit = rawLimit === undefined ? 25 : Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new BadRequestException("INVALID_LIMIT");
    if (Array.isArray(rawCursor) || Array.isArray(rawLimit)) throw new BadRequestException("INVALID_CANDIDATE_QUERY");
    if (rawCursor !== undefined && (typeof rawCursor !== "string" || rawCursor.length === 0 || rawCursor.length > 2048)) throw new BadRequestException("INVALID_CURSOR");
    const cursor = rawCursor === undefined ? null : decodeCandidateCursor(rawCursor as string, identity);
    const page = await this.repo().listValueCandidates(identity, cursor, limit);
    return { ...page, nextCursor: page.nextCursor ? encodeCandidateCursor(identity, page.nextCursor) : null, cohortIdentity: identity };
  }
}
