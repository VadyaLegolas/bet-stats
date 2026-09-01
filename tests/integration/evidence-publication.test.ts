import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPrismaClient, type PrismaClient } from "@bet-stats/database";
import { parseEvidenceProjection } from "@bet-stats/domain";
import { EvidenceService } from "../../apps/api/src/modules/evidence/evidence.service.js";
import { renderEvidenceComponentFields } from "../../apps/web/app/teams/[teamId]/evidence/page.js";
import {
  createPrismaEvidenceRebuildDatabase,
  runEvidenceRebuild,
} from "../../workers/data-sync/src/jobs/evidence-rebuild.js";

const databaseRoot = resolve(import.meta.dirname, "../../packages/database");
const prismaCli = resolve(databaseRoot, "node_modules/prisma/build/index.js");
const containerName = `bet-stats-evidence-publication-${process.pid}`;
let databaseUrl = "";
let prisma: PrismaClient;

function docker(...args: string[]): string {
  return execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

async function seedRun(id: string, cutoff: string, observationId: string, payloadHash: string): Promise<void> {
  const manifest = JSON.stringify({ expectedUnits: ["results"], completedUnits: ["results"], expectedCaptures: [payloadHash], completedCaptures: [payloadHash] });
  await prisma.$executeRawUnsafe(
    `INSERT INTO "SyncRun" (id,"logicalKey",revision,provider,"endpointFamily",lane,"windowFrom","windowTo",state,"correlationId","expectedUnits","completedUnits","expectedCaptures","completedCaptures","completionManifest") VALUES ($1,$2,1,'football-data.org','RESULTS','critical','2026-08-01T00:00:00.000Z'::timestamptz,$3::timestamptz,'SUCCEEDED',$4,1,1,1,1,$5::jsonb)`,
    id,
    id,
    cutoff,
    `${id}-correlation`,
    manifest,
  );
  await prisma.syncAttempt.create({ data: { syncRunId: id, attemptNumber: 1, observationId, state: "SUCCEEDED", finishedAt: new Date(cutoff) } });
}

describe("real PostgreSQL evidence publication boundary", () => {
  beforeAll(async () => {
    docker("run", "--detach", "--name", containerName, "--env", "POSTGRES_PASSWORD=postgres", "--env", "POSTGRES_DB=bet_stats", "--publish", "127.0.0.1::5432", "postgres:18-alpine");
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try { docker("exec", containerName, "pg_isready", "-U", "postgres", "-d", "bet_stats"); break; }
      catch (error) { if (attempt === 59) throw error; Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500); }
    }
    const port = docker("port", containerName, "5432/tcp").split(":").at(-1);
    if (!port) throw new Error("Docker did not publish PostgreSQL port");
    databaseUrl = `postgresql://postgres:postgres@127.0.0.1:${port}/bet_stats`;
    execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], { cwd: databaseRoot, env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: "pipe" });
    prisma = createPrismaClient(databaseUrl);

    await prisma.league.create({ data: { id: "league", name: "League", countryCode: "GB" } });
    await prisma.season.create({ data: { id: "season", leagueId: "league", label: "2026", startsOn: new Date("2026-01-01"), endsOn: new Date("2026-12-31") } });
    await prisma.team.createMany({ data: [{ id: "home", name: "Home", normalizedName: "home", countryCode: "GB" }, { id: "away", name: "Away", normalizedName: "away", countryCode: "GB" }] });
    await prisma.fixture.create({ data: { id: "fixture", leagueId: "league", seasonId: "season", homeTeamId: "home", awayTeamId: "away", kickoffUtc: new Date("2026-08-29T09:00:00.000Z"), status: "FINISHED" } });
    await prisma.sourceObservation.create({ data: { id: "obs-early", provider: "football-data.org", endpointFamily: "RESULTS", externalIdentity: "fixture", observedAt: new Date("2026-08-29T10:00:00.000Z"), payloadHash: "hash-early", rawPayload: { score: "2-1" }, payloadBytes: 15 } });
    await prisma.resultVersion.create({ data: { id: "result-early", fixtureId: "fixture", observationId: "obs-early", effectiveAt: new Date("2026-08-29T09:00:00.000Z"), observedAt: new Date("2026-08-29T10:00:00.000Z"), homeGoals: 2, awayGoals: 1, status: "FINISHED", revision: 1 } });
    await seedRun("run-early", "2026-08-29T12:00:00.000Z", "obs-early", "hash-early");
  }, 120_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    try { docker("rm", "--force", containerName); } catch { /* best effort */ }
  });

  it("publishes a complete build and keeps the exact-cutoff Nest response invariant", async () => {
    const rebuildDatabase = createPrismaEvidenceRebuildDatabase(prisma);
    await expect(runEvidenceRebuild({ database: rebuildDatabase, teamId: "home", cutoff: "2026-08-29T12:00:00.000Z", configVersion: "evidence-v1", configHash: "config-v1", syncRunId: "run-early" })).resolves.toMatchObject({ state: "PUBLISHED" });

    process.env.DATABASE_URL = databaseUrl;
    const service = new EvidenceService();
    const first = await service.get("home", "2026-08-29T12:00:00.000Z");
    const sharedDto = parseEvidenceProjection(first);
    expect(first).toMatchObject({ state: "LIMITED", resolvedAsOfUtc: "2026-08-29T12:00:00.000Z", receipt: { configVersion: "evidence-v1", inputs: [{ fixtureId: "fixture", payloadHash: "hash-early" }] } });
    expect(first.components.form5).toMatchObject({
      value: 3,
      sampleSize: 1,
      sourceRefs: [{
        fixtureId: "fixture",
        effectiveAt: "2026-08-29T09:00:00.000Z",
        observedAt: "2026-08-29T10:00:00.000Z",
        payloadHash: "hash-early",
        payloadBytes: 15,
      }],
    });
    const stagedForm = await prisma.evidenceComponent.findUniqueOrThrow({
      where: { buildId_component: { buildId: first.buildId!, component: "form5" } },
    });
    expect(stagedForm.sourceTimes).toEqual([{
      fixtureId: "fixture",
      effectiveAt: "2026-08-29T09:00:00.000Z",
      observedAt: "2026-08-29T10:00:00.000Z",
      payloadHash: "hash-early",
      payloadBytes: 15,
    }]);
    expect(renderEvidenceComponentFields(sharedDto.components.goalRates!)).toEqual([
      { label: "Goals for", value: "2.00 goals/match" },
      { label: "Goals against", value: "1.00 goals/match" },
    ]);

    await prisma.sourceObservation.create({ data: { id: "obs-late", provider: "football-data.org", endpointFamily: "RESULTS", externalIdentity: "fixture", observedAt: new Date("2026-08-30T10:00:00.000Z"), payloadHash: "hash-late", rawPayload: { score: "1-1" }, payloadBytes: 15 } });
    await prisma.resultVersion.create({ data: { id: "result-late", fixtureId: "fixture", observationId: "obs-late", effectiveAt: new Date("2026-08-29T09:00:00.000Z"), observedAt: new Date("2026-08-30T10:00:00.000Z"), homeGoals: 1, awayGoals: 1, status: "FINISHED", revision: 2, supersedesResultVersionId: "result-early" } });
    await seedRun("run-late", "2026-08-30T12:00:00.000Z", "obs-late", "hash-late");
    await runEvidenceRebuild({ database: rebuildDatabase, teamId: "home", cutoff: "2026-08-30T12:00:00.000Z", configVersion: "evidence-v1", configHash: "config-v1", syncRunId: "run-late" });

    const repeated = await service.get("home", "2026-08-29T12:00:00.000Z");
    expect(repeated).toEqual(first);
    await service.onModuleDestroy();
  });
});
