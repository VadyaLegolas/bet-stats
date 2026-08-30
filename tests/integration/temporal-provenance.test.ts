import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runEvidenceRebuild } from "../../workers/data-sync/src/jobs/evidence-rebuild.js";

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
      try { docker("exec", containerName, "pg_isready", "-U", "postgres", "-d", "bet_stats"); break; }
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
});

function fakeEvidenceDatabase(sourceState: string) {
  const builds: Array<Record<string, unknown>> = [{ id: "published-old", teamId: "home", cutoff: new Date("2026-08-29T00:00:00.000Z"), configHash: "old", syncRunId: "run-1", state: "PUBLISHED" }];
  const components: Array<Record<string, unknown>> = [];
  const match = { fixtureId: "fixture", kickoffUtc: "2026-08-29T09:00:00.000Z", effectiveAt: "2026-08-29T09:00:00.000Z", observedAt: "2026-08-29T10:00:00.000Z", sourceUpdatedAt: null, payloadHash: "hash-1", payloadBytes: 15, teamId: "home", opponentId: "away", venue: "HOME" as const, goalsFor: 2, goalsAgainst: 1, points: 3 as const };
  const transaction = {
    sourceRunState: async () => sourceState,
    latestPublishedBuild: async () => builds.filter((build) => build.state === "PUBLISHED").at(-1) ?? null,
    findBuild: async (key: Record<string, unknown>) => builds.find((build) => build.teamId === key.teamId && build.configHash === key.configHash && build.syncRunId === key.syncRunId) ?? null,
    loadEligibleMatches: async () => [match],
    createBuild: async (build: Record<string, unknown>) => { const stored = { ...build, id: `build-${builds.length}` }; builds.push(stored); return stored; },
    stageComponent: async (component: Record<string, unknown>) => { components.push(component); },
    publishBuild: async (id: string) => { const build = builds.find((item) => item.id === id); if (build) build.state = "PUBLISHED"; },
  };
  return { builds, components, transaction: async <T>(work: (tx: typeof transaction) => Promise<T>) => work(transaction) };
}
