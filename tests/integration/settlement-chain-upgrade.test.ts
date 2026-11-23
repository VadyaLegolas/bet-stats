import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const migrations = resolve(import.meta.dirname, "../../packages/database/prisma/migrations");
const target = "20261123_phase11_settlement_chain_per_forecast";
const container = `bet-stats-settlement-chain-upgrade-${process.pid}`;
const POLICY = "settlement-policy-v1";
const HASH = "upgrade-policy-hash";

function docker(args: string[], input?: string): string {
  return execFileSync("docker", args, { encoding: "utf8", input, stdio: [input ? "pipe" : "ignore", "pipe", "pipe"] }).trim();
}

function sql(database: string, statement: string): string {
  return docker(["exec", "-i", container, "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", database, "-At"], statement);
}

function lines(output: string): string[] {
  return output.length === 0 ? [] : output.split(/\r?\n/);
}

function migrationSql(): string {
  return `BEGIN;\n${readFileSync(resolve(migrations, target, "migration.sql"), "utf8")}\nCOMMIT;`;
}

function seedMatch(id: string, day: number): string {
  const date = `2026-10-${String(day).padStart(2, "0")}`;
  const forecastA = `${id}-forecast-a`;
  const forecastB = `${id}-forecast-b`;
  return `
    INSERT INTO "Fixture" (id,"leagueId","seasonId","homeTeamId","awayTeamId","kickoffUtc",status,"updatedAt") VALUES ('${id}-fixture','up-league','up-season','up-home','up-away','${date}T18:00:00Z','FINISHED',now());
    INSERT INTO "SourceObservation" (id,provider,"endpointFamily","externalIdentity","observedAt","payloadHash","rawPayload","payloadBytes") VALUES
      ('${id}-obs-1','test','RESULTS','${id}-one','${date}T20:00:00Z','${id}-hash-1','{}',2),
      ('${id}-obs-2','test','RESULTS','${id}-two','${date}T20:01:00Z','${id}-hash-2','{}',2);
    INSERT INTO "ResultVersion" (id,"fixtureId","observationId","effectiveAt","observedAt","homeGoals","awayGoals",status,revision) VALUES
      ('${id}-result-1','${id}-fixture','${id}-obs-1','${date}T18:00:00Z','${date}T20:00:00Z',2,1,'FINISHED',1);
    INSERT INTO "ResultVersion" (id,"fixtureId","observationId","effectiveAt","observedAt","homeGoals","awayGoals",status,revision,"supersedesResultVersionId") VALUES
      ('${id}-result-2','${id}-fixture','${id}-obs-2','${date}T18:00:00Z','${date}T20:01:00Z',1,2,'FINISHED',2,'${id}-result-1');
    INSERT INTO "ForecastSnapshot" (id,"fixtureId",kind,state,revision,cutoff,"modelVersion","modelHash","configVersion","configHash","inputHash","evidenceFingerprint","sourceRefs",probabilities,confidence,assumptions,receipt,"issuedAt") VALUES
      ('${forecastA}','${id}-fixture','PRE_MATCH','ISSUED',1,'${date}T17:00:00Z','poisson-ensemble-v1','${id}-model-a','forecast-config-v1','${id}-config-a','${id}-input-a','${id}-evidence-a','[]','{}','{}','[]','{}','${date}T17:00:01Z');
    INSERT INTO "ForecastSnapshot" (id,"fixtureId",kind,state,revision,"supersedesForecastId",cutoff,"modelVersion","modelHash","configVersion","configHash","inputHash","evidenceFingerprint","sourceRefs",probabilities,confidence,assumptions,receipt,"issuedAt") VALUES
      ('${forecastB}','${id}-fixture','PRE_MATCH','ISSUED',2,'${forecastA}','${date}T17:00:00Z','dixon-coles-ensemble-v1','${id}-model-b','forecast-config-v1','${id}-config-b','${id}-input-b','${id}-evidence-b','[]','{}','{}','[]','{}','${date}T17:00:02Z');
  `;
}

/** Persists one receipt through whichever persist_settlement_receipt is installed in `database`. */
function persist(database: string, receipt: { id: string; fixture: string; result: string; forecast: string; supersedes?: string }): string {
  const claims = `jsonb_build_object('fixtureId','${receipt.fixture}','resultVersionId','${receipt.result}','forecastSnapshotId','${receipt.forecast}','policyVersion','${POLICY}','policyHash','${HASH}','lifecycle','FINISHED','scoreability','SCOREABLE','financialEligibility','ELIGIBLE','classOutcome','SCORED','reason','RESULT_FINISHED')`;
  return sql(database, `SELECT id||':'||revision||':'||COALESCE("supersedesSettlementReceiptId",'-') FROM persist_settlement_receipt('${receipt.id}','${receipt.fixture}','${receipt.result}','${receipt.forecast}','${POLICY}','${HASH}','FINISHED','SCOREABLE','ELIGIBLE','SCORED','RESULT_FINISHED',${claims},now(),${receipt.supersedes ? `'${receipt.supersedes}'` : "NULL"});`);
}

const legacyIds = ["legacy-l-a1", "legacy-l-a2", "legacy-m-a1"];
const legacyRows = (database: string): string[] => lines(sql(database, `SELECT id||'|'||"fixtureId"||'|'||"forecastSnapshotId"||'|'||revision||'|'||COALESCE("supersedesSettlementReceiptId",'-') FROM "SettlementReceipt" WHERE id IN ('${legacyIds.join("','")}') ORDER BY id;`));
const legacyDigest = (database: string): string => sql(database, `SELECT md5(string_agg(s::text, E'\\n' ORDER BY s.id)) FROM "SettlementReceipt" s WHERE id IN ('${legacyIds.join("','")}');`);

let rowsBefore: string[] = [];
let digestBefore = "";

describe("settlement chain per forecast: upgrade of a populated database", () => {
  beforeAll(() => {
    docker(["run", "-d", "--name", container, "-e", "POSTGRES_PASSWORD=postgres", "-e", "POSTGRES_DB=bet_stats", "postgres:18-alpine"]);
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try { docker(["exec", container, "pg_isready", "-h", "127.0.0.1", "-U", "postgres", "-d", "bet_stats"]); break; }
      catch { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250); }
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2_000);

    const applied = readdirSync(migrations).sort().filter((name) => name < target);
    expect(applied.at(-1)).toBeDefined();
    // Prisma applies every migration in its own transaction; some of them (LOCK TABLE) require one.
    for (const directory of applied) sql("bet_stats", `BEGIN;
${readFileSync(resolve(migrations, directory, "migration.sql"), "utf8")}
COMMIT;`);

    sql("bet_stats", `
      INSERT INTO "League" (id,name,"countryCode","updatedAt") VALUES ('up-league','League','GB',now());
      INSERT INTO "Season" (id,"leagueId",label,"startsOn","endsOn","updatedAt") VALUES ('up-season','up-league','2026','2026-01-01','2026-12-31',now());
      INSERT INTO "Team" (id,name,"normalizedName","countryCode","updatedAt") VALUES ('up-home','Home','home','GB',now()),('up-away','Away','away','GB',now());
      ${seedMatch("l", 10)}
      ${seedMatch("m", 11)}
    `);

    // Legacy data written by the OLD persist_settlement_receipt: L has forecast A at revisions 1 and 2 (result correction), M has A at revision 1.
    expect(persist("bet_stats", { id: "legacy-l-a1", fixture: "l-fixture", result: "l-result-1", forecast: "l-forecast-a" })).toBe("legacy-l-a1:1:-");
    expect(persist("bet_stats", { id: "legacy-l-a2", fixture: "l-fixture", result: "l-result-2", forecast: "l-forecast-a", supersedes: "legacy-l-a1" })).toBe("legacy-l-a2:2:legacy-l-a1");
    expect(persist("bet_stats", { id: "legacy-m-a1", fixture: "m-fixture", result: "m-result-1", forecast: "m-forecast-a" })).toBe("legacy-m-a1:1:-");

    rowsBefore = legacyRows("bet_stats");
    digestBefore = legacyDigest("bet_stats");

    // Template databases must have no sessions: every psql call above is a closed one-shot session.
    sql("postgres", `CREATE DATABASE clean_copy TEMPLATE bet_stats; CREATE DATABASE broken_copy TEMPLATE bet_stats;`);
  }, 300_000);

  afterAll(() => { try { docker(["rm", "-f", "-v", container]); } catch { /* owned cleanup */ } });

  it("captured the legacy state with the old function (per-fixture numbering, old unique key)", () => {
    expect(rowsBefore).toEqual([
      "legacy-l-a1|l-fixture|l-forecast-a|1|-",
      "legacy-l-a2|l-fixture|l-forecast-a|2|legacy-l-a1",
      "legacy-m-a1|m-fixture|m-forecast-a|1|-",
    ]);
    expect(sql("clean_copy", `SELECT count(*) FROM pg_constraint WHERE conname='SettlementReceipt_fixtureId_revision_key';`)).toBe("1");
    // The old function cannot settle a second forecast of L: that is the UAT blocker this migration removes.
    expect(() => persist("clean_copy", { id: "pre-l-b1", fixture: "l-fixture", result: "l-result-1", forecast: "l-forecast-b" })).toThrow(/settlement revision must link predecessor/);
  });

  it("keeps legacy revisions and links byte-identical, replaces the key and settles the second forecast with its own chain", () => {
    sql("clean_copy", migrationSql());

    expect(legacyRows("clean_copy")).toEqual(rowsBefore);
    expect(legacyDigest("clean_copy")).toBe(digestBefore);

    expect(sql("clean_copy", `SELECT count(*) FROM pg_constraint WHERE conname='SettlementReceipt_fixtureId_revision_key';`)).toBe("0");
    expect(sql("clean_copy", `SELECT indexdef FROM pg_indexes WHERE indexname='SettlementReceipt_fixtureId_forecastSnapshotId_revision_key';`)).toMatch(/UNIQUE INDEX .*\("fixtureId", "forecastSnapshotId", revision\)/);
    expect(sql("clean_copy", `SELECT count(*) FROM pg_proc WHERE proname='persist_settlement_receipt';`)).toBe("1");

    // Forecast B of the legacy fixture L: own chain starting at revision 1 without predecessor, then the correction at revision 2.
    expect(persist("clean_copy", { id: "new-l-b1", fixture: "l-fixture", result: "l-result-1", forecast: "l-forecast-b" })).toBe("new-l-b1:1:-");
    expect(persist("clean_copy", { id: "new-l-b2", fixture: "l-fixture", result: "l-result-2", forecast: "l-forecast-b", supersedes: "new-l-b1" })).toBe("new-l-b2:2:new-l-b1");
    // Forecast B of M, and a correction of M's legacy A chain (revision 2 linked to its legacy revision 1).
    expect(persist("clean_copy", { id: "new-m-b1", fixture: "m-fixture", result: "m-result-1", forecast: "m-forecast-b" })).toBe("new-m-b1:1:-");
    expect(persist("clean_copy", { id: "new-m-a2", fixture: "m-fixture", result: "m-result-2", forecast: "m-forecast-a", supersedes: "legacy-m-a1" })).toBe("new-m-a2:2:legacy-m-a1");

    // Idempotent redelivery returns the stored receipt; legacy rows are still untouched.
    expect(persist("clean_copy", { id: "ignored-id", fixture: "l-fixture", result: "l-result-1", forecast: "l-forecast-b" })).toBe("new-l-b1:1:-");
    expect(legacyDigest("clean_copy")).toBe(digestBefore);
    expect(sql("clean_copy", `SELECT count(*) FROM "SettlementReceipt";`)).toBe("7");
    expect(lines(sql("clean_copy", `SELECT "forecastSnapshotId"||':'||string_agg(revision::text, ',' ORDER BY revision) FROM "SettlementReceipt" WHERE "fixtureId"='l-fixture' GROUP BY "forecastSnapshotId" ORDER BY 1;`))).toEqual(["l-forecast-a:1,2", "l-forecast-b:1,2"]);
  });

  it("refuses a corrupted chain (revision 2 without revision 1) and leaves the old key in place", () => {
    // Revision 2 of forecast B on M with no revision 1: written with triggers off, as damaged production data would look.
    sql("broken_copy", `
      SET session_replication_role = replica;
      INSERT INTO "SettlementReceipt" (id,"fixtureId","resultVersionId","forecastSnapshotId",revision,"supersedesSettlementReceiptId","policyVersion","policyHash",lifecycle,scoreability,"financialEligibility","classOutcome",reason,receipt,"resultObservedAt","forecastCutoff","settledAt")
      SELECT 'broken-m-b2','m-fixture','m-result-2','m-forecast-b',2,NULL,'${POLICY}','${HASH}','FINISHED','SCOREABLE','ELIGIBLE','SCORED','RESULT_FINISHED','{}'::jsonb,r."observedAt",f.cutoff,now()
      FROM "ResultVersion" r, "ForecastSnapshot" f WHERE r.id='m-result-2' AND f.id='m-forecast-b';
    `);
    expect(sql("broken_copy", `SELECT count(*) FROM "SettlementReceipt";`)).toBe("4");

    let message = "";
    try { sql("broken_copy", migrationSql()); } catch (error) { message = String((error as { stderr?: unknown }).stderr ?? error); }
    expect(message).toContain("SettlementReceipt chains are not contiguous per forecast");

    expect(sql("broken_copy", `SELECT count(*) FROM pg_constraint WHERE conname='SettlementReceipt_fixtureId_revision_key';`)).toBe("1");
    expect(sql("broken_copy", `SELECT count(*) FROM pg_indexes WHERE indexname='SettlementReceipt_fixtureId_forecastSnapshotId_revision_key';`)).toBe("0");
    expect(legacyDigest("broken_copy")).toBe(digestBefore);
  });
});
