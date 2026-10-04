import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPrismaClient, type PrismaClient } from "@bet-stats/database";
import { parseEvidenceProjection } from "@bet-stats/domain";
import { EvidenceService, resolveTeamEvidence } from "../../apps/api/src/modules/evidence/evidence.service.js";
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
      try { docker("exec", containerName, "pg_isready", "-h", "127.0.0.1", "-U", "postgres", "-d", "bet_stats"); break; }
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
      sourceUpdatedAt: null,
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

  it("keeps same-time corrections distinct by immutable payload identity", async () => {
    await prisma.sourceObservation.create({ data: { id: "obs-collision", provider: "football-data.org", endpointFamily: "RESULTS", externalIdentity: "fixture", observedAt: new Date("2026-08-30T10:00:00.000Z"), payloadHash: "hash-collision", rawPayload: { score: "0-1", corrected: true }, payloadBytes: 34 } });
    await prisma.resultVersion.create({ data: { id: "result-collision", fixtureId: "fixture", observationId: "obs-collision", effectiveAt: new Date("2026-08-29T09:00:00.000Z"), observedAt: new Date("2026-08-30T10:00:00.000Z"), homeGoals: 0, awayGoals: 1, status: "FINISHED", revision: 3, supersedesResultVersionId: "result-late" } });
    await seedRun("run-collision", "2026-08-30T12:00:00.000Z", "obs-collision", "hash-collision");

    const rebuildDatabase = createPrismaEvidenceRebuildDatabase(prisma);
    await runEvidenceRebuild({ database: rebuildDatabase, teamId: "home", cutoff: "2026-08-30T12:00:00.000Z", configVersion: "evidence-v1", configHash: "config-collision", syncRunId: "run-collision" });
    const build = await prisma.evidenceBuild.findFirstOrThrow({ where: { syncRunId: "run-collision" }, include: { components: true } });
    const form5 = build.components.find((component) => component.component === "form5");
    expect(form5?.sourceTimes).toEqual([expect.objectContaining({ payloadHash: "hash-collision", payloadBytes: 34 })]);

    const components = build.components.map((component) => component.component === "form5"
      ? { ...component, sourceTimes: [{ fixtureId: "fixture", effectiveAt: "2026-08-29T09:00:00.000Z", observedAt: "2026-08-30T10:00:00.000Z", sourceUpdatedAt: null, payloadHash: "hash-late", payloadBytes: 15 }] }
      : component);
    const projected = await resolveTeamEvidence(
      { teamId: "home", asOf: "2026-08-30T12:00:00.000Z" },
      { findPublished: async () => ({ ...build, components }) },
    );
    expect(projected).toMatchObject({
      state: "LIMITED",
      receipt: { inputs: [{ payloadHash: "hash-collision", payloadBytes: 34 }] },
      components: {
        form5: { value: null, limitation: "MISSING_TIMESTAMP", sourceRefs: [] },
        elo: { value: expect.any(Number), sourceRefs: [{ payloadHash: "hash-collision", payloadBytes: 34 }] },
      },
    });
  });

  it("excludes unrelated fixtures before latest-visible result ranking", async () => {
    await prisma.team.createMany({
      data: [
        { id: "unrelated-home", name: "Unrelated Home", normalizedName: "unrelated home", countryCode: "GB" },
        { id: "unrelated-away", name: "Unrelated Away", normalizedName: "unrelated away", countryCode: "GB" },
      ],
      skipDuplicates: true,
    });
    await prisma.fixture.create({
      data: {
        id: "unrelated-fixture",
        leagueId: "league",
        seasonId: "season",
        homeTeamId: "unrelated-home",
        awayTeamId: "unrelated-away",
        kickoffUtc: new Date("2026-08-29T09:00:00.000Z"),
        status: "FINISHED",
      },
    });
    await prisma.sourceObservation.create({
      data: {
        id: "obs-unrelated",
        provider: "football-data.org",
        endpointFamily: "RESULTS",
        externalIdentity: "unrelated-fixture",
        observedAt: new Date("2026-08-29T10:00:00.000Z"),
        payloadHash: "hash-unrelated",
        rawPayload: { score: "4-0" },
        payloadBytes: 15,
      },
    });
    await prisma.resultVersion.create({
      data: {
        id: "result-unrelated",
        fixtureId: "unrelated-fixture",
        observationId: "obs-unrelated",
        effectiveAt: new Date("2026-08-29T09:00:00.000Z"),
        observedAt: new Date("2026-08-29T10:00:00.000Z"),
        homeGoals: 4,
        awayGoals: 0,
        status: "FINISHED",
        revision: 99,
      },
    });
    await seedRun("run-team-isolation", "2026-08-29T12:00:00.000Z", "obs-early", "hash-early");

    const rebuildDatabase = createPrismaEvidenceRebuildDatabase(prisma);
    const result = await runEvidenceRebuild({
      database: rebuildDatabase,
      teamId: "home",
      cutoff: "2026-08-29T12:00:00.000Z",
      configVersion: "evidence-v1",
      configHash: "config-team-isolation",
      syncRunId: "run-team-isolation",
    });
    const build = await prisma.evidenceBuild.findUniqueOrThrow({
      where: { id: result.buildId },
      include: { components: true },
    });
    const receipt = build.components.find((component) => component.component === "receipt");

    expect(receipt?.value).toMatchObject({ inputs: [{ fixtureId: "fixture", payloadHash: "hash-early" }] });
    expect(receipt?.sampleSize).toBe(1);
    for (const component of build.components) {
      const refs = component.sourceTimes as Array<{ fixtureId: string }>;
      expect(refs.every((ref) => ref.fixtureId === "fixture")).toBe(true);
    }
  });

  it("preserves cutoff equality, empty history, and identical-build idempotency", async () => {
    const cutoff = "2026-08-31T12:00:00.000Z";
    await prisma.team.create({
      data: { id: "empty-team", name: "Empty Team", normalizedName: "empty team", countryCode: "GB" },
    });

    const temporalRows = [
      {
        suffix: "equal",
        effectiveAt: cutoff,
        observedAt: cutoff,
        payloadHash: "hash-equal",
      },
      {
        suffix: "effective-after",
        effectiveAt: "2026-08-31T12:00:00.001Z",
        observedAt: cutoff,
        payloadHash: "hash-effective-after",
      },
      {
        suffix: "observed-after",
        effectiveAt: cutoff,
        observedAt: "2026-08-31T12:00:00.001Z",
        payloadHash: "hash-observed-after",
      },
    ] as const;
    for (const row of temporalRows) {
      await prisma.fixture.create({
        data: {
          id: `fixture-${row.suffix}`,
          leagueId: "league",
          seasonId: "season",
          homeTeamId: "home",
          awayTeamId: "away",
          kickoffUtc: new Date("2026-08-31T09:00:00.000Z"),
          status: "FINISHED",
        },
      });
      await prisma.sourceObservation.create({
        data: {
          id: `obs-${row.suffix}`,
          provider: "football-data.org",
          endpointFamily: "RESULTS",
          externalIdentity: `fixture-${row.suffix}`,
          observedAt: new Date(row.observedAt),
          payloadHash: row.payloadHash,
          rawPayload: { score: "1-0" },
          payloadBytes: 15,
        },
      });
      await prisma.resultVersion.create({
        data: {
          id: `result-${row.suffix}`,
          fixtureId: `fixture-${row.suffix}`,
          observationId: `obs-${row.suffix}`,
          effectiveAt: new Date(row.effectiveAt),
          observedAt: new Date(row.observedAt),
          homeGoals: 1,
          awayGoals: 0,
          status: "FINISHED",
          revision: 1,
        },
      });
    }
    await seedRun("run-boundary", cutoff, "obs-equal", "hash-equal");

    const rebuildDatabase = createPrismaEvidenceRebuildDatabase(prisma);
    const input = {
      database: rebuildDatabase,
      teamId: "home",
      cutoff,
      configVersion: "evidence-v1",
      configHash: "config-boundary",
      syncRunId: "run-boundary",
    } as const;
    const first = await runEvidenceRebuild(input);
    const firstBuild = await prisma.evidenceBuild.findUniqueOrThrow({
      where: { id: first.buildId },
      include: { components: { orderBy: { component: "asc" } } },
    });
    const receipt = firstBuild.components.find((component) => component.component === "receipt");
    const receiptInputs = (receipt?.value as { inputs: Array<{ fixtureId: string }> }).inputs;

    expect(receiptInputs.map((item) => item.fixtureId)).toEqual(["fixture", "fixture-equal"]);
    for (const component of firstBuild.components) {
      const refs = component.sourceTimes as Array<{ fixtureId: string }>;
      expect(refs.every((ref) => receiptInputs.some((inputRef) => inputRef.fixtureId === ref.fixtureId))).toBe(true);
    }

    const second = await runEvidenceRebuild(input);
    expect(second).toEqual(first);
    expect(await prisma.evidenceBuild.count({ where: { teamId: "home", cutoff: new Date(cutoff), configHash: "config-boundary", syncRunId: "run-boundary" } })).toBe(1);
    expect(await prisma.evidenceComponent.count({ where: { buildId: first.buildId } })).toBe(9);
    expect(await prisma.evidenceBuild.findUniqueOrThrow({ where: { id: first.buildId }, include: { components: { orderBy: { component: "asc" } } } })).toEqual(firstBuild);

    const empty = await runEvidenceRebuild({ ...input, teamId: "empty-team", configHash: "config-empty" });
    const emptyBuild = await prisma.evidenceBuild.findUniqueOrThrow({
      where: { id: empty.buildId },
      include: { components: true },
    });
    const emptyReceipt = emptyBuild.components.find((component) => component.component === "receipt");
    expect(emptyReceipt).toMatchObject({ sampleSize: 0, limitation: "EMPTY", value: { inputs: [] } });
    for (const component of emptyBuild.components.filter((item) => item.component !== "receipt")) {
      expect(component).toMatchObject({ sampleSize: 0, limitation: "NO_ELIGIBLE_HISTORY", sourceTimes: [] });
      if (component.component !== "elo") expect(component.value).toBeNull();
    }
  });
});
