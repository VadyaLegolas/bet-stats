import { closingObservationId, type OddsMarket } from "@bet-stats/domain";
import type { PrismaClient } from "@bet-stats/database";

/**
 * Shared seed for the Phase 13 read-time CLV integration tests: one league, and for every candidate its own fixture with
 * a forecast, a manual odds snapshot, a value candidate and a settlement receipt. Closing observations are inserted
 * separately and on purpose by raw SQL: the operator write path (13-02) refuses to record after a settlement exists,
 * and these tests need evidence that appears around already settled candidates.
 */

const FORECAST_MARKETS: Readonly<Record<string, string>> = {
  ONE_X_TWO: '[{"selection":"HOME","probability":0.6},{"selection":"DRAW","probability":0.2},{"selection":"AWAY","probability":0.2}]',
  BTTS: '[{"selection":"YES","probability":0.6},{"selection":"NO","probability":0.4}]',
};

export const CLV_LEAGUE_ID = "clv-read-league";

export interface CandidateSpec {
  /** Unique suffix; every candidate gets its own fixture `fx-<key>`. */
  readonly key: string;
  readonly kickoffUtc: string;
  readonly settledAt: string;
  readonly source: string;
  readonly submittedAt: string;
  /** Odds per selection as stored on the manual odds snapshot (may be a subset to build an incomplete candidate set). */
  readonly odds: Readonly<Record<string, string>>;
  readonly market?: OddsMarket;
  readonly selection?: string;
}

export interface SeededCandidate extends Required<CandidateSpec> {
  readonly fixtureId: string;
  readonly oddsSnapshotId: string;
  readonly oddsSelectionId: string;
  readonly forecastSnapshotId: string;
  readonly valueReceiptId: string;
  readonly settlementReceiptId: string;
}

export async function seedClvLeague(db: PrismaClient): Promise<void> {
  await db.$executeRawUnsafe(`
    INSERT INTO "League" (id,name,"countryCode","updatedAt") VALUES ('${CLV_LEAGUE_ID}','League','GB',now());
    INSERT INTO "Season" (id,"leagueId",label,"startsOn","endsOn","updatedAt") VALUES ('clv-read-season','${CLV_LEAGUE_ID}','2026','2026-01-01','2026-12-31',now());
    INSERT INTO "Team" (id,name,"normalizedName","countryCode","updatedAt") VALUES ('clv-read-home','Home','home','GB',now()),('clv-read-away','Away','away','GB',now());
  `);
}

/** Fixture, forecast, manual odds, VALUE_CANDIDATE receipt and settlement receipt. No ValueSettlement and no closing rows. */
export async function seedCandidate(db: PrismaClient, spec: CandidateSpec): Promise<SeededCandidate> {
  const market = spec.market ?? "ONE_X_TWO";
  const selection = spec.selection ?? "HOME";
  const fixtureId = `fx-${spec.key}`;
  const oddsSnapshotId = `odds-${spec.key}`;
  const oddsSelectionId = `odds-selection-${spec.key}`;
  const forecastSnapshotId = `forecast-${spec.key}`;
  const valueReceiptId = `value-${spec.key}`;
  const settlementReceiptId = `settlement-${spec.key}`;
  const resultVersionId = `result-${spec.key}`;
  const cutoff = new Date(Date.parse(spec.kickoffUtc) - 60 * 60 * 1_000).toISOString();
  const run = (sql: string, ...params: unknown[]) => db.$executeRawUnsafe(sql, ...params);

  await run(`INSERT INTO "Fixture" (id,"leagueId","seasonId","homeTeamId","awayTeamId","kickoffUtc",status,"updatedAt") VALUES ($1,'${CLV_LEAGUE_ID}','clv-read-season','clv-read-home','clv-read-away',$2::timestamptz,'FINISHED',now())`, fixtureId, spec.kickoffUtc);
  await run(`INSERT INTO "SourceObservation" (id,provider,"endpointFamily","externalIdentity","observedAt","payloadHash","rawPayload","payloadBytes") VALUES ($1,'test','RESULTS',$2,$3::timestamptz,$4,'{}',2)`, `result-obs-${spec.key}`, fixtureId, spec.settledAt, `result-hash-${spec.key}`);
  await run(`INSERT INTO "ResultVersion" (id,"fixtureId","observationId","effectiveAt","observedAt","homeGoals","awayGoals",status,revision) VALUES ($1,$2,$3,$4::timestamptz,$5::timestamptz,2,1,'FINISHED',1)`, resultVersionId, fixtureId, `result-obs-${spec.key}`, spec.kickoffUtc, spec.settledAt);
  await run(`INSERT INTO "ForecastSnapshot" (id,"fixtureId",kind,state,revision,cutoff,"modelVersion","modelHash","configVersion","configHash","inputHash","evidenceFingerprint","sourceRefs",probabilities,confidence,assumptions,receipt,"issuedAt") VALUES ($1,$2,'PRE_MATCH','ISSUED',1,$3::timestamptz,'poisson-v1','model-hash','forecast-config-v1','config-hash',$4,'evidence-hash','[]','{}','{}','[]','{}',$3::timestamptz + interval '1 second')`, forecastSnapshotId, fixtureId, cutoff, `input-${spec.key}`);
  await run(`INSERT INTO "ForecastMarket" (id,"forecastSnapshotId",market,probabilities) VALUES ($1,$2,$3,$4::jsonb)`, `forecast-market-${spec.key}`, forecastSnapshotId, market, FORECAST_MARKETS[market]);
  await run(`INSERT INTO "ManualOddsSnapshot" (id,"fixtureId",market,"inputHash",source,receipt,"submittedAt") VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::timestamptz)`, oddsSnapshotId, fixtureId, market, `odds-hash-${spec.key}`, spec.source, JSON.stringify({ selections: Object.entries(spec.odds).map(([name, decimalOdds]) => ({ selection: name, decimalOdds, noVigProbability: "0.4" })) }), spec.submittedAt);
  for (const [name, decimalOdds] of Object.entries(spec.odds)) {
    await run(`INSERT INTO "ManualOddsSelection" (id,"oddsSnapshotId",selection,"decimalOdds") VALUES ($1,$2,$3,$4)`, name === selection ? oddsSelectionId : `odds-selection-${spec.key}-${name}`, oddsSnapshotId, name, decimalOdds);
  }
  // Derived fields must agree with the immutable source snapshots (database guard): model 0.6, no-vig 0.4.
  const valueReceipt = JSON.stringify({ market, selection, decimalOdds: spec.odds[selection], modelProbability: "0.6", noVigProbability: "0.4" });
  await run(`INSERT INTO "ValueReceipt" (id,"fixtureId",market,"forecastSnapshotId","oddsSnapshotId",outcome,selection,"modelProbability","noVigProbability","fairOdds",edge,"expectedValue",receipt) VALUES ($1,$2,$3,$4,$5,'VALUE_CANDIDATE',$6,'0.6','0.4',(1/0.6::numeric)::text,'0.2',(0.6*$7::numeric-1)::text,$8::jsonb)`, valueReceiptId, fixtureId, market, forecastSnapshotId, oddsSnapshotId, selection, spec.odds[selection], valueReceipt);
  const receipt = { fixtureId, resultVersionId, forecastSnapshotId, policyVersion: "settlement-policy-v1", policyHash: "clv-read-policy", lifecycle: "FINISHED", scoreability: "SCOREABLE", financialEligibility: "ELIGIBLE", classOutcome: "SCORED", reason: "RESULT_FINISHED" };
  await db.$queryRawUnsafe(`SELECT * FROM persist_settlement_receipt($1,$2,$3,$4,'settlement-policy-v1','clv-read-policy','FINISHED','SCOREABLE','ELIGIBLE','SCORED','RESULT_FINISHED',$5::jsonb,$6::timestamptz,NULL,NULL)`, settlementReceiptId, fixtureId, resultVersionId, forecastSnapshotId, JSON.stringify(receipt), spec.settledAt);

  return { market, selection, ...spec, fixtureId, oddsSnapshotId, oddsSelectionId, forecastSnapshotId, valueReceiptId, settlementReceiptId };
}

/** Frozen flat-unit settlement of a seeded candidate; the optional observation id is the frozen odds-ratio-clv-v1 closing. */
export async function persistValueSettlement(db: PrismaClient, candidate: SeededCandidate, closingObservationIdOrNull: string | null = null): Promise<string> {
  const id = `value-settlement-${candidate.key}`;
  await db.$queryRawUnsafe(`SELECT * FROM persist_value_settlement($1,$2,$3,$4,$5,NULL)`, id, candidate.settlementReceiptId, candidate.valueReceiptId, candidate.oddsSelectionId, closingObservationIdOrNull);
  return id;
}

/** Raw insert of one closing set at one `observedAt`; returns the observation id per selection. Deliberately bypasses the operator write path. */
export async function insertClosingBook(db: PrismaClient, input: { fixtureId: string; market: OddsMarket; source: string; observedAt: string; odds: Readonly<Record<string, string>> }): Promise<Record<string, string>> {
  const ids: Record<string, string> = {};
  for (const [selection, decimalOdds] of Object.entries(input.odds)) {
    const id = closingObservationId({ fixtureId: input.fixtureId, market: input.market, selection: selection as never, sourceConvention: input.source, observedAt: input.observedAt });
    await db.$executeRawUnsafe(
      `INSERT INTO "ClosingOddsObservation" (id,"fixtureId",market,selection,"decimalOdds","oddsFormat","sourceConvention","observationKind","observedAt") VALUES ($1,$2,$3,$4,$5,'DECIMAL',$6,'MARKET_CLOSE',$7::timestamptz)`,
      id, input.fixtureId, input.market, selection, decimalOdds, input.source, input.observedAt,
    );
    ids[selection] = id;
  }
  return ids;
}
