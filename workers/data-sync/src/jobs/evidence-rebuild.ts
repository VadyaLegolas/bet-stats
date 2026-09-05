import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@bet-stats/database";
import { buildTeamEvidence, type EvidenceMatch } from "@bet-stats/domain";

export const LATEST_VISIBLE_RESULT_SQL = `
SELECT * FROM (
  SELECT rv.*, f."kickoffUtc", f."homeTeamId", f."awayTeamId",
    so."sourceUpdatedAt", so."payloadHash", so."payloadBytes",
    ROW_NUMBER() OVER (PARTITION BY rv."fixtureId" ORDER BY rv."observedAt" DESC, rv.revision DESC, rv.id ASC) AS rank
  FROM "ResultVersion" rv
  JOIN "Fixture" f ON f.id = rv."fixtureId"
  JOIN "SourceObservation" so ON so.id = rv."observationId"
  WHERE rv."effectiveAt" <= $1::timestamptz
    AND rv."observedAt" <= $1::timestamptz
    AND (f."homeTeamId" = $2 OR f."awayTeamId" = $2)
) visible WHERE rank = 1
ORDER BY "kickoffUtc", "observedAt", "fixtureId"`;

type BuildRecord = Readonly<{ id: string; state: string; teamId?: unknown; configHash?: unknown; syncRunId?: unknown }>;
export type SourceRunCompletion = Readonly<{
  state: string;
  expectedUnits: number;
  completedUnits: number;
  expectedCaptures: number;
  completedCaptures: number;
  completionManifest: unknown;
}>;

export interface EvidenceRebuildTransaction {
  sourceRunCompletion(syncRunId: string): Promise<SourceRunCompletion | null>;
  latestPublishedBuild(teamId: string, cutoff: string): Promise<BuildRecord | null>;
  findBuild(key: { teamId: string; cutoff: string; configHash: string; syncRunId: string }): Promise<BuildRecord | null>;
  loadEligibleMatches(teamId: string, cutoff: string, sql: string): Promise<readonly EvidenceMatch[]>;
  createBuild(build: Record<string, unknown>): Promise<BuildRecord>;
  stageComponent(component: Record<string, unknown>): Promise<void>;
  publishBuild(id: string): Promise<void>;
  failBuild(id: string): Promise<void>;
}

export interface EvidenceRebuildDatabase {
  transaction<T>(work: (transaction: EvidenceRebuildTransaction) => Promise<T>): Promise<T>;
}

export interface EvidenceRebuildInput {
  readonly database: EvidenceRebuildDatabase;
  readonly teamId: string;
  readonly cutoff: string;
  readonly configVersion: string;
  readonly configHash: string;
  readonly syncRunId: string;
  readonly replayPlanId?: string;
}

type EligibleResultRow = Readonly<{
  fixtureId: string;
  kickoffUtc: Date;
  homeTeamId: string;
  awayTeamId: string;
  effectiveAt: Date;
  observedAt: Date;
  sourceUpdatedAt: Date | null;
  payloadHash: string;
  payloadBytes: number;
  homeGoals: number | null;
  awayGoals: number | null;
}>;

/** Production PostgreSQL adapter for the pure rebuild orchestration. */
export function createPrismaEvidenceRebuildDatabase(client: PrismaClient): EvidenceRebuildDatabase {
  return {
    transaction: async (work) => client.$transaction(async (transaction) => work({
      sourceRunCompletion: async (syncRunId) => transaction.syncRun.findUnique({
        where: { id: syncRunId },
        select: { state: true, expectedUnits: true, completedUnits: true, expectedCaptures: true, completedCaptures: true, completionManifest: true },
      }),
      latestPublishedBuild: async (teamId, cutoff) => transaction.evidenceBuild.findFirst({
        where: { teamId, cutoff: { lte: new Date(cutoff) }, state: "PUBLISHED" },
        orderBy: [{ cutoff: "desc" }, { publishedAt: "desc" }],
      }),
      findBuild: async (key) => transaction.evidenceBuild.findFirst({
        where: { teamId: key.teamId, cutoff: new Date(key.cutoff), configHash: key.configHash, syncRunId: key.syncRunId },
      }),
      loadEligibleMatches: async (teamId, cutoff, statement) => {
        const rows = await transaction.$queryRawUnsafe<EligibleResultRow[]>(statement, new Date(cutoff), teamId);
        return rows.map((row) => {
          const isHome = row.homeTeamId === teamId;
          const goalsFor = isHome ? row.homeGoals : row.awayGoals;
          const goalsAgainst = isHome ? row.awayGoals : row.homeGoals;
          const points = goalsFor === null || goalsAgainst === null ? undefined : goalsFor > goalsAgainst ? 3 as const : goalsFor === goalsAgainst ? 1 as const : 0 as const;
          return {
            fixtureId: row.fixtureId,
            kickoffUtc: row.kickoffUtc.toISOString(),
            effectiveAt: row.effectiveAt.toISOString(),
            observedAt: row.observedAt.toISOString(),
            sourceUpdatedAt: row.sourceUpdatedAt?.toISOString() ?? null,
            payloadHash: row.payloadHash,
            payloadBytes: row.payloadBytes,
            teamId,
            opponentId: isHome ? row.awayTeamId : row.homeTeamId,
            venue: isHome ? "HOME" as const : "AWAY" as const,
            ...(goalsFor === null ? {} : { goalsFor }),
            ...(goalsAgainst === null ? {} : { goalsAgainst }),
            ...(points === undefined ? {} : { points }),
          };
        });
      },
      createBuild: async (build) => transaction.evidenceBuild.create({ data: build as never }),
      stageComponent: async (component) => { await transaction.evidenceComponent.create({ data: component as never }); },
      publishBuild: async (id) => { await transaction.evidenceBuild.update({ where: { id }, data: { state: "PUBLISHED", publishedAt: new Date() } }); },
      failBuild: async (id) => { await transaction.evidenceBuild.update({ where: { id }, data: { state: "FAILED" } }); },
    })),
  };
}

const COMPONENT_KEYS = ["form5", "form10", "elo", "homeStrength", "awayStrength", "goalRates", "restDays", "h2h"] as const;

export async function runEvidenceRebuild(input: EvidenceRebuildInput) {
  return input.database.transaction(async (transaction) => {
    const visible = await transaction.latestPublishedBuild(input.teamId, input.cutoff);
    const source = await transaction.sourceRunCompletion(input.syncRunId);
    if (!isCompleteSuccessfulRun(source)) return { state: "PENDING" as const, visibleBuildId: visible?.id ?? null };

    const key = { teamId: input.teamId, cutoff: new Date(input.cutoff).toISOString(), configHash: input.configHash, syncRunId: input.syncRunId };
    const existing = await transaction.findBuild(key);
    if (existing?.state === "PUBLISHED") return { state: "PUBLISHED" as const, buildId: existing.id, visibleBuildId: existing.id };

    const matches = await transaction.loadEligibleMatches(input.teamId, key.cutoff, LATEST_VISIBLE_RESULT_SQL);
    const evidence = buildTeamEvidence({ teamId: input.teamId, asOf: key.cutoff, matches });
    const build = existing ?? await transaction.createBuild({ id: randomUUID(), ...key, configVersion: input.configVersion, state: "BUILDING", ...(input.replayPlanId === undefined ? {} : { replayPlanId: input.replayPlanId }) });
    for (const component of COMPONENT_KEYS) {
      const item = evidence[component];
      await transaction.stageComponent({ buildId: build.id, component, value: item.value, sampleSize: item.sampleSize, limitation: item.limitation, sourceTimes: item.sourceRefs });
    }
    await transaction.stageComponent({ buildId: build.id, component: "receipt", value: evidence.receipt, sampleSize: evidence.receipt.inputs.length, limitation: evidence.state === "COMPLETE" ? null : evidence.state, sourceTimes: evidence.receipt.inputs });
    await transaction.publishBuild(build.id);
    return { state: "PUBLISHED" as const, buildId: build.id, visibleBuildId: build.id };
  });
}

export function isCompleteSuccessfulRun(run: SourceRunCompletion | null): boolean {
  if (!run || run.state !== "SUCCEEDED") return false;
  if (run.expectedUnits < 1 || run.expectedCaptures < 1) return false;
  if (run.completedUnits !== run.expectedUnits || run.completedCaptures !== run.expectedCaptures) return false;
  if (typeof run.completionManifest !== "object" || run.completionManifest === null) return false;
  const manifest = run.completionManifest as Record<string, unknown>;
  const expectedUnits = stringSet(manifest.expectedUnits);
  const completedUnits = stringSet(manifest.completedUnits);
  const expectedCaptures = stringSet(manifest.expectedCaptures);
  const completedCaptures = stringSet(manifest.completedCaptures);
  return expectedUnits?.size === run.expectedUnits && completedUnits?.size === run.completedUnits
    && expectedCaptures?.size === run.expectedCaptures && completedCaptures?.size === run.completedCaptures
    && [...expectedUnits].every((item) => completedUnits.has(item))
    && [...expectedCaptures].every((item) => completedCaptures.has(item));
}

function stringSet(value: unknown): Set<string> | null {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.length === 0)) return null;
  return new Set(value);
}
