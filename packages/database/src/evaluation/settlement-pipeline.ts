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

async function withSerializableRetry<T>(database: PrismaClient, operation: (transaction: PrismaClient) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await database.$transaction(
        (transaction) => operation(transaction as unknown as PrismaClient),
        { isolationLevel: "Serializable", maxWait: 5_000, timeout: 15_000 },
      );
    } catch (error) {
      if (attempt >= 3 || (error as { code?: string }).code !== "P2034") throw error;
    }
  }
}

export function createSettlementPipelineService({ database }: { database: PrismaClient }) {
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

      return withSerializableRetry(database, async (transaction) => {
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
          targetResult = await processRevision(transaction, command, result);
        }
        if (!targetResult) throw new Error("RESULT_LINEAGE_EMPTY");
        return targetResult;
      });
    },
  };
}

async function processRevision(transaction: PrismaClient, command: SettlementPipelineCommand, result: ResultRow): Promise<SettlementPipelineResult> {
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
