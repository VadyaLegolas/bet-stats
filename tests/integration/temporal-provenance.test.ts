import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runEvidenceRebuild } from "../../workers/data-sync/src/jobs/evidence-rebuild.js";
import { recordSyncRunCompletion } from "../../workers/data-sync/src/ingestion/runner.js";

const databaseRoot = resolve(import.meta.dirname, "../../packages/database");
const containerName = `bet-stats-temporal-${process.pid}`;
const prismaCli = resolve(databaseRoot, "node_modules/prisma/build/index.js");
function docker(...args: string[]): string { return execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); }
function sql(statement: string): string[] {
  const output = docker("exec", containerName, "psql", "-U", "postgres", "-d", "bet_stats", "-At", "-c", statement);
  return output.length === 0 ? [] : output.split(/\r?\n/);
}

describe("temporal provenance contract", () => {
  beforeAll(() => {
    docker("run", "--detach", "--name", containerName, "--env", "POSTGRES_PASSWORD=postgres", "--env", "POSTGRES_DB=bet_stats", "--publish", "127.0.0.1::5432", "postgres:18-alpine");
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try { docker("exec", containerName, "pg_isready", "-h", "127.0.0.1", "-U", "postgres", "-d", "bet_stats"); break; }
      catch (error) { if (attempt === 59) throw error; Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500); }
    }
    const port = docker("port", containerName, "5432/tcp").split(":").at(-1);
    if (!port) throw new Error("Docker did not publish PostgreSQL port");
    execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], { cwd: databaseRoot, env: { ...process.env, DATABASE_URL: `postgresql://postgres:postgres@127.0.0.1:${port}/bet_stats` }, stdio: "pipe" });
    sql(`INSERT INTO "League" (id,name,"countryCode","updatedAt") VALUES ('league','League','GB',now()); INSERT INTO "Season" (id,"leagueId",label,"startsOn","endsOn","updatedAt") VALUES ('season','league','2026','2026-01-01','2026-12-31',now()); INSERT INTO "Team" (id,name,"normalizedName","countryCode","updatedAt") VALUES ('home','Home','home','GB',now()),('away','Away','away','GB',now()); INSERT INTO "Fixture" (id,"leagueId","seasonId","homeTeamId","awayTeamId","kickoffUtc",status,"updatedAt") VALUES ('fixture','league','season','home','away','2026-08-29T09:00:00Z','FINISHED',now());`);
  }, 120_000);
  afterAll(() => { try { docker("rm", "--force", containerName); } catch { /* best effort */ } });

  it("persists duplicate-safe immutable observations with raw payload identity", () => {
    sql(`INSERT INTO "SourceObservation" (id,provider,"endpointFamily","externalIdentity","requestedFrom","requestedTo","returnedFrom","returnedTo","observedAt","sourceUpdatedAt","payloadHash","rawPayload","payloadBytes") VALUES ('obs-1','football-data.org','RESULTS','fixture','2026-08-29','2026-08-29','2026-08-29','2026-08-29','2026-08-29T10:00:00Z',NULL,'hash-1','{"score":"2-1"}',15);`);
    expect(() => sql(`INSERT INTO "SourceObservation" (id,provider,"endpointFamily","externalIdentity","observedAt","payloadHash","rawPayload","payloadBytes") VALUES ('obs-dup','football-data.org','RESULTS','fixture','2026-08-29T10:00:00Z','hash-1','{}',2);`)).toThrow();
    expect(() => sql(`UPDATE "SourceObservation" SET "payloadBytes"=0 WHERE id='obs-1';`)).toThrow();
    expect(sql(`SELECT "sourceUpdatedAt" IS NULL, "payloadHash", "payloadBytes" FROM "SourceObservation" WHERE id='obs-1';`)).toEqual(["t|hash-1|15"]);
  });

  it("appends result corrections and enforces both cutoff dimensions", () => {
    sql(`INSERT INTO "ResultVersion" (id,"fixtureId","observationId","effectiveAt","observedAt","homeGoals","awayGoals",status,revision) VALUES ('result-1','fixture','obs-1','2026-08-29T09:00:00Z','2026-08-29T10:00:00Z',2,1,'FINISHED',1); INSERT INTO "SourceObservation" (id,provider,"endpointFamily","externalIdentity","observedAt","payloadHash","rawPayload","payloadBytes") VALUES ('obs-2','football-data.org','RESULTS','fixture','2026-08-30T10:00:00Z','hash-2','{"score":"1-1"}',15); INSERT INTO "ResultVersion" (id,"fixtureId","observationId","effectiveAt","observedAt","homeGoals","awayGoals",status,revision,"supersedesResultVersionId") VALUES ('result-2','fixture','obs-2','2026-08-29T09:00:00Z','2026-08-30T10:00:00Z',1,1,'FINISHED',2,'result-1');`);
    expect(sql(`SELECT id FROM "ResultVersion" WHERE "effectiveAt" <= '2026-08-29T23:59:59Z' AND "observedAt" <= '2026-08-29T23:59:59Z' ORDER BY revision DESC LIMIT 1;`)).toEqual(["result-1"]);
    expect(() => sql(`UPDATE "ResultVersion" SET "homeGoals"=9 WHERE id='result-1';`)).toThrow();
    expect(() => sql(`DELETE FROM "SourceObservation" WHERE id='obs-1';`)).toThrow();
  });

  it("preserves cutoff identity across PostgreSQL session timezones", () => {
    sql(`SET TIME ZONE 'UTC';`);
    const utc = sql(`SELECT id FROM "ResultVersion" WHERE "effectiveAt" <= '2026-08-29T10:30:00Z'::timestamptz AND "observedAt" <= '2026-08-29T10:30:00Z'::timestamptz ORDER BY id;`);
    sql(`SET TIME ZONE 'Europe/Warsaw';`);
    const warsaw = sql(`SELECT id FROM "ResultVersion" WHERE "effectiveAt" <= '2026-08-29T10:30:00Z'::timestamptz AND "observedAt" <= '2026-08-29T10:30:00Z'::timestamptz ORDER BY id;`);
    expect(warsaw).toEqual(utc);
  });

  it("allows only one terminal evidence-build transition", () => {
    sql(`INSERT INTO "SyncRun" (id,"logicalKey",revision,provider,"endpointFamily",lane,"windowFrom","windowTo",state,"correlationId","expectedUnits","completedUnits","expectedCaptures","completedCaptures","completionManifest") VALUES ('run-db','run-db',1,'football-data.org','RESULTS','critical','2026-08-01T00:00:00Z','2026-08-30T00:00:00Z','SUCCEEDED','corr',1,1,1,1,'{"expectedUnits":["results"],"completedUnits":["results"],"expectedCaptures":["hash-1"],"completedCaptures":["hash-1"]}'); INSERT INTO "EvidenceBuild" (id,"teamId",cutoff,"configVersion","configHash","syncRunId",state) VALUES ('build-db','home','2026-08-30T00:00:00Z','v1','config-db','run-db','BUILDING');`);
    sql(`UPDATE "EvidenceBuild" SET state='PUBLISHED', "publishedAt"=now() WHERE id='build-db';`);
    expect(sql(`SELECT state FROM "EvidenceBuild" WHERE id='build-db';`)).toEqual(["PUBLISHED"]);
    expect(() => sql(`UPDATE "EvidenceBuild" SET state='FAILED', "publishedAt"=NULL WHERE id='build-db';`)).toThrow();
    expect(() => sql(`DELETE FROM "EvidenceBuild" WHERE id='build-db';`)).toThrow();
  });
});

describe("evidence publication contract", () => {
  it("keeps the prior receipt visible until every source run is terminal", async () => {
    const database = fakeEvidenceDatabase("RUNNING");
    const result = await runEvidenceRebuild({ database, teamId: "home", cutoff: "2026-08-30T00:00:00.000Z", configHash: "config", configVersion: "evidence-v1", syncRunId: "run-2" });
    expect(result).toMatchObject({ state: "PENDING", visibleBuildId: "published-old" });
    expect(database.builds).toHaveLength(1);
  });

  it("publishes components atomically and converges for an identical rebuild", async () => {
    const database = fakeEvidenceDatabase("SUCCEEDED");
    const input = { database, teamId: "home", cutoff: "2026-08-30T00:00:00.000Z", configHash: "config", configVersion: "evidence-v1", syncRunId: "run-2" } as const;
    const first = await runEvidenceRebuild(input);
    const second = await runEvidenceRebuild(input);
    expect(first).toMatchObject({ state: "PUBLISHED" });
    expect(second).toEqual(first);
    expect(database.builds.filter((build) => build.syncRunId === "run-2")).toHaveLength(1);
    expect(database.builds.at(-1)).toMatchObject({ state: "PUBLISHED" });
    expect(database.components.length).toBeGreaterThan(5);
  });

  it.each(["FAILED", "CANCELLED"])("retains the prior publication for a %s source run", async (state) => {
    const database = fakeEvidenceDatabase(state);
    const result = await runEvidenceRebuild({ database, teamId: "home", cutoff: "2026-08-30T00:00:00.000Z", configHash: "config", configVersion: "evidence-v1", syncRunId: "run-2" });
    expect(result).toEqual({ state: "PENDING", visibleBuildId: "published-old" });
    expect(database.builds).toHaveLength(1);
  });

  it("rejects incomplete SUCCEEDED work and records duplicate completion once", async () => {
    const database = fakeEvidenceDatabase("SUCCEEDED", false);
    const rejected = await runEvidenceRebuild({ database, teamId: "home", cutoff: "2026-08-30T00:00:00.000Z", configHash: "config", configVersion: "evidence-v1", syncRunId: "run-2" });
    expect(rejected).toEqual({ state: "PENDING", visibleBuildId: "published-old" });

    let manifest: unknown = { expectedUnits: ["results"], completedUnits: [], expectedCaptures: ["hash-1"], completedCaptures: [] };
    const updates: Array<Record<string, unknown>> = [];
    const transaction = {
      lockSyncRun: async () => ({ state: "RUNNING", completionManifest: manifest }),
      updateSyncRun: async (_id: string, update: Record<string, unknown>) => { manifest = update.completionManifest; updates.push(update); },
    };
    await recordSyncRunCompletion(transaction, "run-2", "results", ["hash-1"]);
    await recordSyncRunCompletion(transaction, "run-2", "results", ["hash-1"]);
    expect(updates.at(-1)).toMatchObject({ completedUnits: 1, completedCaptures: 1, state: "SUCCEEDED" });
  });
});

function fakeEvidenceDatabase(sourceState: string, complete = sourceState === "SUCCEEDED") {
  const builds: Array<Record<string, unknown>> = [{ id: "published-old", teamId: "home", cutoff: new Date("2026-08-29T00:00:00.000Z"), configHash: "old", syncRunId: "run-1", state: "PUBLISHED" }];
  const components: Array<Record<string, unknown>> = [];
  const match = { fixtureId: "fixture", kickoffUtc: "2026-08-29T09:00:00.000Z", effectiveAt: "2026-08-29T09:00:00.000Z", observedAt: "2026-08-29T10:00:00.000Z", sourceUpdatedAt: null, payloadHash: "hash-1", payloadBytes: 15, teamId: "home", opponentId: "away", venue: "HOME" as const, goalsFor: 2, goalsAgainst: 1, points: 3 as const };
  const transaction = {
    sourceRunCompletion: async () => ({
      state: sourceState,
      expectedUnits: 1,
      completedUnits: complete ? 1 : 0,
      expectedCaptures: 1,
      completedCaptures: complete ? 1 : 0,
      completionManifest: {
        expectedUnits: ["results"],
        completedUnits: complete ? ["results"] : [],
        expectedCaptures: ["hash-1"],
        completedCaptures: complete ? ["hash-1"] : [],
      },
    }),
    latestPublishedBuild: async () => builds.filter((build) => build.state === "PUBLISHED").at(-1) ?? null,
    findBuild: async (key: Record<string, unknown>) => builds.find((build) => build.teamId === key.teamId && build.configHash === key.configHash && build.syncRunId === key.syncRunId) ?? null,
    loadEligibleMatches: async () => [match],
    createBuild: async (build: Record<string, unknown>) => { const stored = { ...build, id: `build-${builds.length}` }; builds.push(stored); return stored; },
    stageComponent: async (component: Record<string, unknown>) => { components.push(component); },
    publishBuild: async (id: string) => { const build = builds.find((item) => item.id === id); if (build) build.state = "PUBLISHED"; },
    failBuild: async (id: string) => { const build = builds.find((item) => item.id === id); if (build) build.state = "FAILED"; },
  };
  return { builds, components, transaction: async <T>(work: (tx: typeof transaction) => Promise<T>) => work(transaction) };
}
