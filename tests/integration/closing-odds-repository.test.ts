import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient, createPrismaClosingOddsRepository, type ClosingOddsRepository, type PrismaClient } from "@bet-stats/database";
import { closingObservationId, type ClosingOddsBookInput } from "@bet-stats/domain";

const root = resolve(import.meta.dirname, "../..");
const databaseRoot = resolve(root, "packages/database");
const prismaCli = resolve(databaseRoot, "node_modules/prisma/build/index.js");
const container = `bet-stats-closing-odds-repo-${process.pid}`;
const NOW = "2026-11-30T12:00:00.000Z";
const SOURCE = "BOOKMAKER_BACK";
let prisma: PrismaClient;
let repository: ClosingOddsRepository;

function docker(...args: string[]): string {
  return execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function waitForPostgres(): void {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { docker("exec", container, "pg_isready", "-h", "127.0.0.1", "-U", "postgres", "-d", "bet_stats"); return; }
    catch { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500); }
  }
  throw new Error("PostgreSQL did not become ready");
}

function oneXTwo(overrides: Partial<ClosingOddsBookInput> = {}, odds: { HOME: string; DRAW: string; AWAY: string } = { HOME: "2.10", DRAW: "3.40", AWAY: "3.60" }): ClosingOddsBookInput {
  return {
    fixtureId: "closing-fx-open",
    market: "ONE_X_TWO",
    sourceConvention: SOURCE,
    observedAt: "2026-11-30T11:00:00.000Z",
    selections: [
      { selection: "HOME", decimalOdds: odds.HOME },
      { selection: "DRAW", decimalOdds: odds.DRAW },
      { selection: "AWAY", decimalOdds: odds.AWAY },
    ],
    ...overrides,
  };
}

const GUARDED_TABLES = ["ManualOddsSnapshot", "ManualOddsSelection", "ValueReceipt", "ValueSettlement", "ForecastSnapshot", "ForecastMarket", "SettlementReceipt", "ResultVersion"] as const;

async function counts(): Promise<Record<string, bigint>> {
  const result: Record<string, bigint> = {};
  for (const table of GUARDED_TABLES) {
    result[table] = (await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(`SELECT count(*) AS count FROM "${table}"`))[0]!.count;
  }
  return result;
}

async function closingRows(fixtureId: string): Promise<Array<{ id: string; selection: string; decimalOdds: string; observedAt: Date; observationKind: string; oddsFormat: string }>> {
  return prisma.$queryRawUnsafe(`SELECT id,selection,"decimalOdds","observedAt","observationKind","oddsFormat" FROM "ClosingOddsObservation" WHERE "fixtureId"=$1 ORDER BY "observedAt",selection`, fixtureId);
}

describe("closing odds repository on real PostgreSQL", () => {
  let baseline: Record<string, bigint>;

  beforeAll(async () => {
    docker("run", "--detach", "--name", container, "--env", "POSTGRES_PASSWORD=postgres", "--env", "POSTGRES_DB=bet_stats", "--publish", "127.0.0.1::5432", "postgres:18-alpine");
    waitForPostgres();
    const port = docker("port", container, "5432/tcp").split(":").at(-1)!;
    const url = `postgresql://postgres:postgres@127.0.0.1:${port}/bet_stats`;
    execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], { cwd: databaseRoot, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    prisma = createPrismaClient(url);
    repository = createPrismaClosingOddsRepository({ database: prisma, clock: () => new Date(NOW) });
    await prisma.$executeRawUnsafe(`
      INSERT INTO "League" (id,name,"countryCode","updatedAt") VALUES ('closing-league','League','GB',now());
      INSERT INTO "Season" (id,"leagueId",label,"startsOn","endsOn","updatedAt") VALUES ('closing-season','closing-league','2026','2026-01-01','2026-12-31',now());
      INSERT INTO "Team" (id,name,"normalizedName","countryCode","updatedAt") VALUES ('closing-home','Home','home','GB',now()),('closing-away','Away','away','GB',now());
      INSERT INTO "Fixture" (id,"leagueId","seasonId","homeTeamId","awayTeamId","kickoffUtc",status,"updatedAt") VALUES
        ('closing-fx-open','closing-league','closing-season','closing-home','closing-away','2026-12-01T18:00:00Z','SCHEDULED',now()),
        ('closing-fx-past','closing-league','closing-season','closing-home','closing-away','2026-11-29T18:00:00Z','FINISHED',now()),
        ('closing-fx-settled','closing-league','closing-season','closing-home','closing-away','2026-12-02T18:00:00Z','FINISHED',now()),
        ('closing-fx-rollback','closing-league','closing-season','closing-home','closing-away','2026-12-03T18:00:00Z','SCHEDULED',now()),
        ('closing-fx-race','closing-league','closing-season','closing-home','closing-away','2026-12-04T18:00:00Z','SCHEDULED',now());
      INSERT INTO "ManualOddsSnapshot" (id,"fixtureId",market,"inputHash",source,receipt,"submittedAt") VALUES ('closing-odds-1','closing-fx-open','ONE_X_TWO','closing-odds-hash',$$${SOURCE}$$,'{}','2026-11-30T09:00:00Z');
      INSERT INTO "ManualOddsSelection" (id,"oddsSnapshotId",selection,"decimalOdds") VALUES ('closing-odds-selection','closing-odds-1','HOME','2.4');
      INSERT INTO "SourceObservation" (id,provider,"endpointFamily","externalIdentity","observedAt","payloadHash","rawPayload","payloadBytes") VALUES ('closing-result-obs','test','RESULTS','fixture','2026-12-02T20:00:00Z','closing-result-hash','{}',2);
      INSERT INTO "ResultVersion" (id,"fixtureId","observationId","effectiveAt","observedAt","homeGoals","awayGoals",status,revision) VALUES ('closing-result-1','closing-fx-settled','closing-result-obs','2026-12-02T18:00:00Z','2026-12-02T20:00:00Z',2,1,'FINISHED',1);
      INSERT INTO "ForecastSnapshot" (id,"fixtureId",kind,state,revision,cutoff,"modelVersion","modelHash","configVersion","configHash","inputHash","evidenceFingerprint","sourceRefs",probabilities,confidence,assumptions,receipt,"issuedAt") VALUES ('closing-forecast','closing-fx-settled','PRE_MATCH','ISSUED',1,'2026-12-02T17:00:00Z','poisson-v1','model-hash','forecast-config-v1','config-hash','input-hash','evidence-hash','[]','{}','{}','[]','{}','2026-12-02T17:00:01Z');
      INSERT INTO "ForecastMarket" (id,"forecastSnapshotId",market,probabilities) VALUES ('closing-forecast-market','closing-forecast','ONE_X_TWO','[{"selection":"HOME","probability":0.6},{"selection":"DRAW","probability":0.2},{"selection":"AWAY","probability":0.2}]');
    `);
    const receipt = { fixtureId: "closing-fx-settled", resultVersionId: "closing-result-1", forecastSnapshotId: "closing-forecast", policyVersion: "settlement-policy-v1", policyHash: "closing-policy", lifecycle: "FINISHED", scoreability: "SCOREABLE", financialEligibility: "ELIGIBLE", classOutcome: "SCORED", reason: "RESULT_FINISHED" };
    await prisma.$queryRawUnsafe(`SELECT * FROM persist_settlement_receipt('closing-settlement-1','closing-fx-settled','closing-result-1','closing-forecast','settlement-policy-v1','closing-policy','FINISHED','SCOREABLE','ELIGIBLE','SCORED','RESULT_FINISHED',$1::jsonb,'2026-12-02T20:05:00Z',NULL,NULL)`, JSON.stringify(receipt));
    baseline = await counts();
  }, 120_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    try { docker("rm", "--force", "--volumes", container); } catch { /* owned cleanup */ }
  });

  it("records a complete 1X2 set in one transaction with deterministic ids and fixed kind/format", async () => {
    const result = await repository.recordClosingOddsBook(oneXTwo());
    expect(result.created).toBe(true);
    expect(result.observations.map((row) => row.selection)).toEqual(["HOME", "DRAW", "AWAY"]);
    expect(result.observations.map((row) => row.decimalOdds)).toEqual(["2.1", "3.4", "3.6"]);
    for (const row of result.observations) {
      expect(row).toMatchObject({ fixtureId: "closing-fx-open", market: "ONE_X_TWO", sourceConvention: SOURCE, observationKind: "MARKET_CLOSE", oddsFormat: "DECIMAL", observedAt: "2026-11-30T11:00:00.000Z" });
      expect(row.id).toBe(closingObservationId({ fixtureId: "closing-fx-open", market: "ONE_X_TWO", selection: row.selection, sourceConvention: SOURCE, observedAt: "2026-11-30T11:00:00.000Z" }));
    }
    const stored = await closingRows("closing-fx-open");
    expect(stored).toHaveLength(3);
    expect(stored.every((row) => row.observationKind === "MARKET_CLOSE" && row.oddsFormat === "DECIMAL")).toBe(true);
  });

  it("returns the existing rows on an identical replay and adds nothing", async () => {
    const before = await closingRows("closing-fx-open");
    const first = await repository.recordClosingOddsBook(oneXTwo());
    expect(first.created).toBe(false);
    expect(first.observations).toHaveLength(3);
    expect(first.observations.map((row) => row.id).sort()).toEqual(before.map((row) => row.id).sort());
    expect(await closingRows("closing-fx-open")).toHaveLength(3);
  });

  it("rejects the same key with a different price as CLOSING_OBSERVATION_CONFLICT and writes nothing", async () => {
    const before = await closingRows("closing-fx-open");
    await expect(repository.recordClosingOddsBook(oneXTwo({}, { HOME: "2.10", DRAW: "3.40", AWAY: "3.70" }))).rejects.toMatchObject({ code: "CLOSING_OBSERVATION_CONFLICT" });
    expect(await closingRows("closing-fx-open")).toEqual(before);
  });

  it("appends a correction as a new observation with a later observedAt; the latest pre-kickoff row wins", async () => {
    const correction = await repository.recordClosingOddsBook(oneXTwo({ observedAt: "2026-11-30T11:30:00.000Z" }, { HOME: "2.00", DRAW: "3.50", AWAY: "3.80" }));
    expect(correction.created).toBe(true);
    expect(await closingRows("closing-fx-open")).toHaveLength(6);
    const latest = await prisma.$queryRawUnsafe<Array<{ selection: string; decimalOdds: string }>>(
      `SELECT DISTINCT ON (selection) selection,"decimalOdds" FROM "ClosingOddsObservation" WHERE "fixtureId"='closing-fx-open' AND market='ONE_X_TWO' AND "observedAt"<'2026-12-01T18:00:00Z' ORDER BY selection,"observedAt" DESC,id DESC`,
    );
    expect(Object.fromEntries(latest.map((row) => [row.selection, row.decimalOdds]))).toEqual({ AWAY: "3.8", DRAW: "3.5", HOME: "2" });
  });

  it("records complete totals and BTTS sets", async () => {
    const totals = await repository.recordClosingOddsBook({ fixtureId: "closing-fx-open", market: "OVER_UNDER_2_5", sourceConvention: SOURCE, observedAt: "2026-11-30T11:00:00.000Z", selections: [{ selection: "OVER_2_5", decimalOdds: "1.90" }, { selection: "UNDER_2_5", decimalOdds: "1.95" }] });
    const btts = await repository.recordClosingOddsBook({ fixtureId: "closing-fx-open", market: "BTTS", sourceConvention: SOURCE, observedAt: "2026-11-30T11:00:00.000Z", selections: [{ selection: "YES", decimalOdds: "1.80" }, { selection: "NO", decimalOdds: "2.00" }] });
    expect(totals.observations).toHaveLength(2);
    expect(btts.observations).toHaveLength(2);
  });

  it("rejects an incomplete or duplicated set before writing anything", async () => {
    const before = (await closingRows("closing-fx-race")).length;
    const partial = oneXTwo({ fixtureId: "closing-fx-race" });
    await expect(repository.recordClosingOddsBook({ ...partial, selections: partial.selections.slice(0, 2) })).rejects.toMatchObject({ code: "INCOMPLETE_MARKET_SET" });
    await expect(repository.recordClosingOddsBook({ ...partial, selections: [partial.selections[0]!, partial.selections[0]!, partial.selections[2]!] })).rejects.toMatchObject({ code: "DUPLICATE_SELECTION" });
    await expect(repository.recordClosingOddsBook({ ...partial, selections: [{ selection: "HOME", decimalOdds: "1" }, partial.selections[1]!, partial.selections[2]!] })).rejects.toMatchObject({ code: "INVALID_ODDS" });
    expect(await closingRows("closing-fx-race")).toHaveLength(before);
  });

  it.each([
    ["RECORDED_AFTER_KICKOFF", oneXTwo({ fixtureId: "closing-fx-past", observedAt: "2026-11-29T17:00:00.000Z" })],
    ["OBSERVED_AT_NOT_PRE_KICKOFF", oneXTwo({ observedAt: "2026-12-01T18:00:00.000Z" })],
    ["OBSERVED_AT_IN_FUTURE", oneXTwo({ observedAt: "2026-11-30T13:00:00.000Z" })],
    ["FIXTURE_ALREADY_SETTLED", oneXTwo({ fixtureId: "closing-fx-settled", observedAt: "2026-11-30T11:00:00.000Z" })],
    ["FIXTURE_NOT_FOUND", oneXTwo({ fixtureId: "closing-fx-missing" })],
    ["UNKNOWN_SOURCE_CONVENTION", oneXTwo({ sourceConvention: "NO_SUCH_SOURCE" })],
    ["INVALID_OBSERVED_AT", oneXTwo({ observedAt: "2026-11-30T11:00:00Z" })],
  ] as const)("rejects with %s on a server-side decision and writes nothing", async (code, input) => {
    const before = (await closingRows(input.fixtureId)).length;
    await expect(repository.recordClosingOddsBook(input)).rejects.toMatchObject({ code });
    expect(await closingRows(input.fixtureId)).toHaveLength(before);
  });

  it("serializes concurrent identical requests: one creates, the other replays, three rows exist", async () => {
    const input = oneXTwo({ fixtureId: "closing-fx-race" });
    const [first, second] = await Promise.all([repository.recordClosingOddsBook(input), repository.recordClosingOddsBook(input)]);
    expect([first.created, second.created].sort()).toEqual([false, true]);
    expect(await closingRows("closing-fx-race")).toHaveLength(3);
  });

  it("rolls the whole set back when an insert fails midway", async () => {
    await prisma.$executeRawUnsafe(`CREATE FUNCTION closing_test_fail_away() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.selection='AWAY' AND NEW."fixtureId"='closing-fx-rollback' THEN RAISE EXCEPTION 'injected failure'; END IF; RETURN NEW; END; $$`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER closing_test_fail_away BEFORE INSERT ON "ClosingOddsObservation" FOR EACH ROW EXECUTE FUNCTION closing_test_fail_away()`);
    try {
      await expect(repository.recordClosingOddsBook(oneXTwo({ fixtureId: "closing-fx-rollback" }))).rejects.toThrow();
      expect(await closingRows("closing-fx-rollback")).toHaveLength(0);
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER closing_test_fail_away ON "ClosingOddsObservation"`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION closing_test_fail_away()`);
    }
    const retried = await repository.recordClosingOddsBook(oneXTwo({ fixtureId: "closing-fx-rollback" }));
    expect(retried.created).toBe(true);
  });

  it("keeps stored observations immutable: UPDATE and DELETE are rejected by the trigger", async () => {
    const id = closingObservationId({ fixtureId: "closing-fx-open", market: "ONE_X_TWO", selection: "HOME", sourceConvention: SOURCE, observedAt: "2026-11-30T11:00:00.000Z" });
    await expect(prisma.$executeRawUnsafe(`UPDATE "ClosingOddsObservation" SET "decimalOdds"='9' WHERE id=$1`, id)).rejects.toThrow(/immutable/i);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM "ClosingOddsObservation" WHERE id=$1`, id)).rejects.toThrow(/immutable/i);
  });

  it("never touches manual odds, value receipts, value settlements, forecasts or settlement tables", async () => {
    expect(await counts()).toEqual(baseline);
  });
});
