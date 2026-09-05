import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const migrations = resolve(import.meta.dirname, "../../packages/database/prisma/migrations");
const container = `bet-stats-lease-upgrade-${process.pid}`;
function docker(args: string[], input?: string) { return execFileSync("docker", args, { encoding: "utf8", input, stdio: [input ? "pipe" : "ignore", "pipe", "pipe"] }).trim(); }
function sql(statement: string) { return docker(["exec", "-i", container, "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "bet_stats", "-At"], statement); }

describe("populated replay lease upgrade", () => {
  beforeAll(() => {
    docker(["run", "-d", "--name", container, "-e", "POSTGRES_PASSWORD=postgres", "-e", "POSTGRES_DB=bet_stats", "postgres:18-alpine"]);
    for (let i = 0; i < 60; i += 1) { try { docker(["exec", container, "pg_isready", "-U", "postgres", "-d", "bet_stats"]); break; } catch { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250); } }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2_000);
    for (const directory of readdirSync(migrations).sort().filter((name) => name < "20260904_phase02_sync_run_execution_lease")) {
      sql(readFileSync(resolve(migrations, directory, "migration.sql"), "utf8"));
    }
    sql(`INSERT INTO "ReplayPlan" (id,"logicalKey",revision,provider,"competitionId","endpointFamily","windowFrom","windowTo","previewVersion",actor) VALUES ('p','p',1,'football-data.org','PL','RESULTS',now(),now(),'p','test');
      INSERT INTO "SyncRun" (id,"logicalKey",revision,provider,"endpointFamily",lane,"windowFrom","windowTo",state,"correlationId","replayPlanId","expectedUnits","completedUnits","expectedCaptures","completedCaptures","completionManifest","terminalAt") VALUES
      ('pending','pending',1,'football-data.org','RESULTS','standard',now(),now(),'PENDING','p','p',1,0,1,0,'{"expectedUnits":["u"],"completedUnits":[],"expectedCaptures":["u"],"completedCaptures":[]}',NULL),
      ('running','running',1,'football-data.org','RESULTS','standard',now(),now(),'RUNNING','r','p',1,0,1,0,'{"expectedUnits":["u"],"completedUnits":[],"expectedCaptures":["u"],"completedCaptures":[]}',NULL),
      ('success','success',1,'football-data.org','RESULTS','standard',now(),now(),'SUCCEEDED','s','p',1,1,1,1,'{"expectedUnits":["u"],"completedUnits":["u"],"expectedCaptures":["u"],"completedCaptures":["u"]}',now()),
      ('failed','failed',1,'football-data.org','RESULTS','standard',now(),now(),'FAILED','f','p',1,0,1,0,'{"expectedUnits":["u"],"completedUnits":[],"expectedCaptures":["u"],"completedCaptures":[]}',now());
      INSERT INTO "SyncAttempt" (id,"syncRunId","attemptNumber",state,"startedAt") VALUES ('a','running',1,'RUNNING',now());`);
    sql(`BEGIN;\n${readFileSync(resolve(migrations, "20260904_phase02_sync_run_execution_lease", "migration.sql"), "utf8")}\nCOMMIT;`);
  }, 120_000);
  afterAll(() => { try { docker(["rm", "-f", container]); } catch {} });

  it("backfills only RUNNING runs as expired and preserves attempt history and terminal rows", () => {
    const rows = sql(`SELECT id||':'||state||':'||("executionLeaseToken" IS NOT NULL)||':'||COALESCE(("executionLeaseExpiresAt"<=clock_timestamp())::text,'null') FROM "SyncRun" ORDER BY id;`).split(/\r?\n/);
    expect(rows).toEqual(["failed:FAILED:false:null", "pending:PENDING:false:null", "running:RUNNING:true:true", "success:SUCCEEDED:false:null"]);
    expect(sql(`SELECT "attemptNumber"||':'||state FROM "SyncAttempt" WHERE "syncRunId"='running';`)).toBe("1:RUNNING");
    expect(() => sql(`UPDATE "SyncRun" SET "terminalAt"=now()+interval '1 second' WHERE id='success';`)).toThrow();
  });
});
