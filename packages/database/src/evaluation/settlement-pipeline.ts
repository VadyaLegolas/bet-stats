import { createHash } from "node:crypto";

import {
  SETTLEMENT_POLICY_VERSION,
  resolveSettlement,
  scoreCategoricalForecast,
  type ScoreMarket,
} from "@bet-stats/domain";

import type { PrismaClient } from "../client.js";

export const SETTLEMENT_PIPELINE_POLICY_HASH = createHash("sha256").update(JSON.stringify({
  eligibleForecastKinds: ["LINEUP_CONFIRMED", "PRE_MATCH"],
  lifecycle: {
    ABANDONED: ["NON_SCORED", "NON_FINANCIAL", "NON_SCORED", "RESULT_ABANDONED"],
    CANCELLED: ["NON_SCORED", "NON_FINANCIAL", "NON_SCORED", "RESULT_CANCELLED"],
    FINISHED: ["SCOREABLE", "ELIGIBLE", "SCORED", "RESULT_FINISHED"],
    POSTPONED: ["PENDING", "NOT_ELIGIBLE", "PENDING", "RESULT_POSTPONED"],
    VOID: ["NON_SCORED", "NON_FINANCIAL", "NON_SCORED", "RESULT_VOID"],
  },
  version: SETTLEMENT_POLICY_VERSION,
})).digest("hex");

export interface SettlementPipelineCommand {
  fixtureId: string;
  resultVersionId: string;
  forecastSnapshotId: string;
  policyVersion: string;
  correlationId: string;
}

export interface SettlementPipelineResult {
  settlementReceiptId: string;
  forecastScoreIds: string[];
  valueSettlementIds: string[];
  reason: string;
  duplicate: boolean;
  correlationId: string;
}

type ResultRow = {
  id: string; fixtureId: string; status: string; revision: number; observedAt: Date;
  homeGoals: number | null; awayGoals: number | null; supersedesResultVersionId: string | null;
};
type ForecastRow = { id: string; fixtureId: string; kind: string; state: string; cutoff: Date; issuedAt: Date | null };
type FixtureRow = { id: string; kickoffUtc: Date };
type MarketRow = { market: string; probabilities: unknown };
type SettlementRow = { id: string; revision: number; supersedesSettlementReceiptId: string | null };

function requireId(value: string, code: string): void {
  if (typeof value !== "string" || value.trim() === "" || value.length > 256) throw Object.assign(new Error(code), { code });
}

function stableId(kind: string, ...parts: string[]): string {
  return `${kind}_${createHash("sha256").update(parts.join("\u001f")).digest("hex")}`;
}

function resultOutcome(market: ScoreMarket, homeGoals: number, awayGoals: number): string {
  if (market === "ONE_X_TWO") return homeGoals > awayGoals ? "HOME" : homeGoals < awayGoals ? "AWAY" : "DRAW";
  if (market === "OVER_UNDER_2_5") return homeGoals + awayGoals > 2 ? "OVER_2_5" : "UNDER_2_5";
  return homeGoals > 0 && awayGoals > 0 ? "YES" : "NO";
}

function isScoreMarket(value: string): value is ScoreMarket {
  return value === "ONE_X_TWO" || value === "OVER_UNDER_2_5" || value === "BTTS";
}

const SERIALIZABLE_ATTEMPTS = 3;
const SERIALIZABLE_MAX_WAIT_MS = 5_000;
const SERIALIZABLE_TIMEOUT_MS = 15_000;

/** Raised when the intake gate or its deadline stops a call; none of these leave committed work behind. */
function intakeError(code: string): Error & { code: string } { return Object.assign(new Error(code), { code }); }

/** Lets the Serializable work notice, between its steps, that the lock-holding transaction is about to expire. */
interface IntakeGuard { check(): void }

async function withSerializableRetry<T>(database: PrismaClient, guard: IntakeGuard, operation: (transaction: PrismaClient) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    guard.check();
    try {
      return await database.$transaction(
        (transaction) => operation(transaction as unknown as PrismaClient),
        { isolationLevel: "Serializable", maxWait: SERIALIZABLE_MAX_WAIT_MS, timeout: SERIALIZABLE_TIMEOUT_MS },
      );
    } catch (error) {
      if (attempt >= SERIALIZABLE_ATTEMPTS || (error as { code?: string }).code !== "P2034") throw error;
    }
  }
}

/**
 * Intake gate. A Serializable transaction fixes its snapshot at its FIRST statement, so taking the
 * per-fixture advisory lock inside it makes a waiting duplicate read a snapshot older than the first
 * caller's commit and fail with SQLSTATE 40001. Postgres cannot take a keyed lock without a snapshot
 * (DO/SELECT both set one, so SET TRANSACTION ISOLATION LEVEL afterwards raises 25001), therefore the lock
 * is held by a short outer transaction on its own connection while the Serializable work runs on another.
 *
 * Each in-flight call occupies two pool connections (holder + worker), so concurrent holders per client
 * are capped to leave room for the workers; otherwise holders could starve their own workers.
 * The key differs from the one used inside `persist_settlement_receipt` (`<fixtureId>:settlement`),
 * which is taken on the worker connection; sharing a key would deadlock holder against worker.
 *
 * The holder timeout is derived from the worker's own limits (every Serializable attempt may wait `maxWait` and run
 * `timeout`), plus a margin for `afterSettlement` and pool queueing. The work is not cancellable once running, so it
 * checks a deadline that expires BEFORE the holder does: after that it starts no new attempt or revision and does not
 * commit, which keeps the lock held for as long as anything can still be written. The slot is released only after the
 * holder callback has settled, so a slot never frees while its connection is still busy.
 */
export interface SettlementIntakeOptions {
  /** Concurrent lock-holding transactions per database client. Only the first service created for a client sets it. */
  maxHolders?: number;
  /** Lifetime of the lock-holding transaction. */
  holderTimeoutMs?: number;
  /** How long a call waits for a free holder slot before failing with SETTLEMENT_INTAKE_BUSY (BullMQ retries it). */
  acquireTimeoutMs?: number;
}

const INTAKE_HOLDER_MARGIN_MS = 15_000;
export const SETTLEMENT_INTAKE_DEFAULTS = Object.freeze({
  maxHolders: 3,
  holderTimeoutMs: SERIALIZABLE_ATTEMPTS * (SERIALIZABLE_MAX_WAIT_MS + SERIALIZABLE_TIMEOUT_MS) + INTAKE_HOLDER_MARGIN_MS,
  acquireTimeoutMs: 60_000,
});

class Semaphore {
  private available: number;
  private readonly waiters: Array<{ grant: () => void }> = [];
  constructor(size: number) { this.available = size; }
  acquire(timeoutMs: number): Promise<void> {
    if (this.available > 0) { this.available -= 1; return Promise.resolve(); }
    return new Promise<void>((resolve, reject) => {
      const waiter = { grant: () => { clearTimeout(timer); resolve(); } };
      const timer = setTimeout(() => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(intakeError("SETTLEMENT_INTAKE_BUSY"));
      }, timeoutMs);
      this.waiters.push(waiter);
    });
  }
  release(): void {
    const next = this.waiters.shift();
    if (next) next.grant(); else this.available += 1;
  }
}

const intakeGates = new WeakMap<object, Semaphore>();

async function withIntakeLock<T>(database: PrismaClient, fixtureId: string, options: SettlementIntakeOptions | undefined, work: (guard: IntakeGuard) => Promise<T>): Promise<T> {
  const maxHolders = options?.maxHolders ?? SETTLEMENT_INTAKE_DEFAULTS.maxHolders;
  const holderTimeoutMs = options?.holderTimeoutMs ?? SETTLEMENT_INTAKE_DEFAULTS.holderTimeoutMs;
  const acquireTimeoutMs = options?.acquireTimeoutMs ?? SETTLEMENT_INTAKE_DEFAULTS.acquireTimeoutMs;
  let gate = intakeGates.get(database);
  if (!gate) { gate = new Semaphore(maxHolders); intakeGates.set(database, gate); }
  await gate.acquire(acquireTimeoutMs);
  // Conservative: counted from before the holder transaction starts, and ahead of its expiry by a margin.
  const deadline = Date.now() + holderTimeoutMs - Math.min(5_000, Math.floor(holderTimeoutMs / 5));
  const guard: IntakeGuard = { check: () => { if (Date.now() >= deadline) throw intakeError("SETTLEMENT_INTAKE_DEADLINE"); } };
  let settled: Promise<unknown> = Promise.resolve();
  try {
    return await database.$transaction((holder) => {
      const run = (async () => {
        await holder.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", `${fixtureId}:settlement-intake`);
        return work(guard);
      })();
      settled = run.then(() => undefined, () => undefined);
      return run;
    }, { maxWait: SERIALIZABLE_MAX_WAIT_MS, timeout: holderTimeoutMs });
  } finally {
    try { await settled; } finally { gate.release(); }
  }
}

export function createSettlementPipelineService({ database, afterSettlement, intake }: { database: PrismaClient; afterSettlement?: (settlementReceiptId: string) => void | Promise<void>; intake?: SettlementIntakeOptions }) {
  return {
    policyHash: SETTLEMENT_PIPELINE_POLICY_HASH,
    async process(command: SettlementPipelineCommand): Promise<SettlementPipelineResult> {
      for (const [value, code] of [
        [command.fixtureId, "INVALID_FIXTURE_ID"],
        [command.resultVersionId, "INVALID_RESULT_VERSION_ID"],
        [command.forecastSnapshotId, "INVALID_FORECAST_SNAPSHOT_ID"],
        [command.correlationId, "INVALID_CORRELATION_ID"],
      ] as const) requireId(value, code);
      if (command.policyVersion !== SETTLEMENT_POLICY_VERSION) throw Object.assign(new Error("UNKNOWN_SETTLEMENT_POLICY"), { code: "UNKNOWN_SETTLEMENT_POLICY" });

      return withIntakeLock(database, command.fixtureId, intake, (guard) => withSerializableRetry(database, guard, async (transaction) => {
        await transaction.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", `${command.fixtureId}:settlement`);
        const targetRows = await transaction.$queryRawUnsafe<ResultRow[]>(
          `SELECT id,"fixtureId",status,revision,"observedAt","homeGoals","awayGoals","supersedesResultVersionId" FROM "ResultVersion" WHERE id=$1`,
          command.resultVersionId,
        );
        const target = targetRows[0];
        if (!target) throw Object.assign(new Error("RESULT_VERSION_NOT_FOUND"), { code: "RESULT_VERSION_NOT_FOUND" });
        if (target.fixtureId !== command.fixtureId) throw Object.assign(new Error("FIXTURE_SCOPE_MISMATCH"), { code: "FIXTURE_SCOPE_MISMATCH" });

        const chain: ResultRow[] = [];
        let cursor: ResultRow | undefined = target;
        while (cursor) {
          chain.unshift(cursor);
          if (!cursor.supersedesResultVersionId) break;
          const parentRows: ResultRow[] = await transaction.$queryRawUnsafe<ResultRow[]>(
            `SELECT id,"fixtureId",status,revision,"observedAt","homeGoals","awayGoals","supersedesResultVersionId" FROM "ResultVersion" WHERE id=$1`,
            cursor.supersedesResultVersionId,
          );
          cursor = parentRows[0];
          if (!cursor || cursor.fixtureId !== command.fixtureId) throw Object.assign(new Error("RESULT_LINEAGE_INVALID"), { code: "RESULT_LINEAGE_INVALID" });
        }

        let targetResult: SettlementPipelineResult | undefined;
        for (const result of chain) {
          guard.check();
          targetResult = await processRevision(transaction, command, result, afterSettlement);
        }
        if (!targetResult) throw new Error("RESULT_LINEAGE_EMPTY");
        guard.check(); // the commit happens right after this return: never commit once the lock-holding transaction may be gone
        return targetResult;
      }));
    },
  };
}

async function processRevision(transaction: PrismaClient, command: SettlementPipelineCommand, result: ResultRow, afterSettlement?: (settlementReceiptId: string) => void | Promise<void>): Promise<SettlementPipelineResult> {
  const fixture = (await transaction.$queryRawUnsafe<FixtureRow[]>(`SELECT id,"kickoffUtc" FROM "Fixture" WHERE id=$1`, command.fixtureId))[0];
  const forecast = (await transaction.$queryRawUnsafe<ForecastRow[]>(`SELECT id,"fixtureId",kind,state,cutoff,"issuedAt" FROM "ForecastSnapshot" WHERE id=$1`, command.forecastSnapshotId))[0];
  if (!fixture || !forecast) throw Object.assign(new Error("SETTLEMENT_SOURCE_NOT_FOUND"), { code: "SETTLEMENT_SOURCE_NOT_FOUND" });

  const resolved = resolveSettlement({
    result: { ...result, observedAt: result.observedAt.toISOString() },
    forecastSnapshotId: command.forecastSnapshotId,
    forecastCandidates: [{ ...forecast, cutoff: forecast.cutoff.toISOString(), issuedAt: forecast.issuedAt?.toISOString() ?? null }],
    fixtureKickoffUtc: fixture.kickoffUtc.toISOString(),
    settledAt: result.observedAt.toISOString(),
  });
  const existing = await transaction.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id FROM "SettlementReceipt" WHERE "resultVersionId"=$1 AND "forecastSnapshotId"=$2 AND "policyHash"=$3`,
    result.id, command.forecastSnapshotId, resolved.policyHash,
  );
  const priorSettlement = result.supersedesResultVersionId
    ? (await transaction.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id FROM "SettlementReceipt" WHERE "resultVersionId"=$1 AND "forecastSnapshotId"=$2 AND "policyHash"=$3`,
        result.supersedesResultVersionId, command.forecastSnapshotId, resolved.policyHash,
      ))[0]
    : undefined;
  const settlementId = stableId("settlement", result.id, command.forecastSnapshotId, resolved.policyHash);
  const receipt = { ...resolved, correlationId: command.correlationId };
  const settlement = (await transaction.$queryRawUnsafe<SettlementRow[]>(
    `SELECT * FROM persist_settlement_receipt($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::timestamptz,$14,NULL)`,
    settlementId, command.fixtureId, result.id, command.forecastSnapshotId, resolved.policyVersion, resolved.policyHash,
    resolved.lifecycle, resolved.scoreability, resolved.financialEligibility, resolved.classOutcome, resolved.reason,
    JSON.stringify(receipt), resolved.settledAt, priorSettlement?.id ?? null,
  ))[0]!;
  await afterSettlement?.(settlement.id);

  const output: SettlementPipelineResult = { settlementReceiptId: settlement.id, forecastScoreIds: [], valueSettlementIds: [], reason: resolved.reason, duplicate: existing.length > 0, correlationId: command.correlationId };
  if (resolved.scoreability !== "SCOREABLE" || result.homeGoals === null || result.awayGoals === null) return output;

  const markets = await transaction.$queryRawUnsafe<MarketRow[]>(`SELECT market,probabilities FROM "ForecastMarket" WHERE "forecastSnapshotId"=$1 ORDER BY market`, command.forecastSnapshotId);
  for (const market of markets) {
    if (!isScoreMarket(market.market)) throw Object.assign(new Error("INVALID_SCORE_MARKET"), { code: "INVALID_SCORE_MARKET" });
    const predecessor = priorSettlement
      ? (await transaction.$queryRawUnsafe<Array<{ id: string }>>(`SELECT id FROM "ForecastScore" WHERE "settlementReceiptId"=$1 AND market=$2`, priorSettlement.id, market.market))[0]
      : undefined;
    const score = scoreCategoricalForecast({ settlementReceiptId: settlement.id, forecastSnapshotId: command.forecastSnapshotId, market: market.market, outcome: resultOutcome(market.market, result.homeGoals, result.awayGoals), probabilities: market.probabilities as Array<{ selection: string; probability: number }> });
    const scoreReceipt = { ...score, leagueId: (await transaction.fixture.findUniqueOrThrow({ where: { id: command.fixtureId }, select: { leagueId: true } })).leagueId, modelVersion: (await transaction.forecastSnapshot.findUniqueOrThrow({ where: { id: command.forecastSnapshotId }, select: { modelVersion: true } })).modelVersion, kickoffUtc: fixture.kickoffUtc.toISOString(), correlationId: command.correlationId };
    const id = stableId("score", settlement.id, market.market, score.formulaHash);
    const persisted = await transaction.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT * FROM persist_forecast_score($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11)`,
      id, settlement.id, market.market, score.outcome, score.rawChosenProbability, score.clippedChosenProbability, score.brierScore, score.logLoss,
      JSON.stringify(score.classOrder), JSON.stringify(scoreReceipt), predecessor?.id ?? null,
    );
    output.forecastScoreIds.push(persisted[0]!.id);
  }

  const values = await transaction.$queryRawUnsafe<Array<{ id: string; market: string; selection: string; oddsSelectionId: string }>>(
    `SELECT v.id,v.market,v.selection,o.id AS "oddsSelectionId" FROM "ValueReceipt" v JOIN "ManualOddsSelection" o ON o."oddsSnapshotId"=v."oddsSnapshotId" AND o.selection=v.selection WHERE v."forecastSnapshotId"=$1 AND v.outcome='VALUE_CANDIDATE' ORDER BY v.id`,
    command.forecastSnapshotId,
  );
  for (const value of values) {
    const predecessor = priorSettlement
      ? (await transaction.$queryRawUnsafe<Array<{ id: string }>>(`SELECT id FROM "ValueSettlement" WHERE "settlementReceiptId"=$1 AND "valueReceiptId"=$2`, priorSettlement.id, value.id))[0]
      : undefined;
    const closing = (await transaction.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT c.id FROM "ClosingOddsObservation" c JOIN "ManualOddsSelection" o ON o.id=$1 JOIN "ManualOddsSnapshot" s ON s.id=o."oddsSnapshotId" WHERE c."fixtureId"=$2 AND c.market=$3 AND c.selection=$4 AND c."oddsFormat"='DECIMAL' AND c."sourceConvention"=s.source AND c."observationKind"='MARKET_CLOSE' AND c."observedAt">=s."submittedAt" AND c."observedAt"<$5 ORDER BY c."observedAt" DESC,c.id DESC LIMIT 1`,
      value.oddsSelectionId, command.fixtureId, value.market, value.selection, fixture.kickoffUtc,
    ))[0];
    const id = stableId("value_settlement", settlement.id, value.id, "flat-one-unit-v1");
    const persisted = await transaction.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT * FROM persist_value_settlement($1,$2,$3,$4,$5,$6)`,
      id, settlement.id, value.id, value.oddsSelectionId, closing?.id ?? null, predecessor?.id ?? null,
    );
    output.valueSettlementIds.push(persisted[0]!.id);
  }
  return output;
}
