import { createHash } from "node:crypto";

import type { PrismaClient } from "@bet-stats/database";
import { currentForecastConfigHash, ForecastOrchestrator, type ForecastOrchestratorRepository } from "@bet-stats/domain";

import type { EnrichmentJobData } from "../queues/index.js";
import { createPrismaEvidenceRebuildDatabase, runEvidenceRebuild } from "./evidence-rebuild.js";
import { planForecastPublication, runForecastPublicationJob, type ForecastPublisher } from "./forecasts.js";
import { schedulePublishedFixtures } from "./fixtures.js";

/** Evidence config identity for sweep-issued forecasts; must match runEvidenceRebuild keying. */
export const EVIDENCE_CONFIG_HASH = createHash("sha256").update("evidence-v1", "utf8").digest("hex");

const INITIAL_OFFSET_MS = 24 * 60 * 60 * 1_000;
const PRE_MATCH_OFFSET_MS = 6 * 60 * 60 * 1_000;
const SWEEP_HORIZON_MS = 14 * 24 * 60 * 60 * 1_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SweepForecastKind = "INITIAL" | "PRE_MATCH";

export interface DueKindsInput {
  readonly kickoffUtc: string;
  readonly now: string;
  readonly issuedKinds: readonly string[];
}

/** Kinds whose kickoff-anchored cutoff has passed and that are not ISSUED yet. Pure. */
export function computeDueKinds(input: DueKindsInput): readonly SweepForecastKind[] {
  const kickoff = Date.parse(input.kickoffUtc);
  const now = Date.parse(input.now);
  if (!Number.isFinite(kickoff) || !Number.isFinite(now)) return [];
  const issued = new Set(input.issuedKinds);
  const due: SweepForecastKind[] = [];
  if (now >= kickoff - INITIAL_OFFSET_MS && !issued.has("INITIAL")) due.push("INITIAL");
  if (now >= kickoff - PRE_MATCH_OFFSET_MS && !issued.has("PRE_MATCH")) due.push("PRE_MATCH");
  return due;
}

export interface InitialCutoffInput {
  readonly kickoffUtc: string;
  readonly now: string;
}

/** INITIAL cutoff: kickoff-24h when still ahead, otherwise the issue moment (late discovery). Pure. */
export function computeInitialCutoff(input: InitialCutoffInput): string {
  const kickoff = Date.parse(input.kickoffUtc);
  const now = Date.parse(input.now);
  return new Date(Math.max(kickoff - INITIAL_OFFSET_MS, now)).toISOString();
}

export interface EnsureTeamEvidenceInput {
  readonly database: PrismaClient;
  readonly teamId: string;
  readonly cutoff: string;
  readonly now?: Date;
  readonly logger?: (event: Record<string, unknown>) => void;
}

/**
 * Build (or reuse) the team evidence build at EXACTLY the forecast cutoff so the
 * ForecastOrchestrator exact-equality gate passes. Returns the buildId when the
 * rebuild reached PUBLISHED, otherwise null (this tick defers, a later tick retries).
 */
export async function ensureTeamEvidence(input: EnsureTeamEvidenceInput): Promise<string | null> {
  const source = await input.database.syncRun.findFirst({
    where: { state: "SUCCEEDED", endpointFamily: "RESULTS" },
    orderBy: { createdAt: "desc" },
    select: { id: true, replayPlanId: true },
  }) ?? await input.database.syncRun.findFirst({
    where: { state: "SUCCEEDED" },
    orderBy: { createdAt: "desc" },
    select: { id: true, replayPlanId: true },
  });
  if (!source) return null;
  const result = await runEvidenceRebuild({
    database: createPrismaEvidenceRebuildDatabase(input.database),
    teamId: input.teamId,
    cutoff: input.cutoff,
    configVersion: "evidence-v1",
    configHash: EVIDENCE_CONFIG_HASH,
    syncRunId: source.id,
    ...(source.replayPlanId ? { replayPlanId: source.replayPlanId } : {}),
  });
  return result.state === "PUBLISHED" ? result.buildId : null;
}

export interface ForecastSweepDeps {
  readonly database: PrismaClient;
  readonly forecastRepository: ForecastOrchestratorRepository;
  readonly enrichmentEnqueue: (job: EnrichmentJobData) => Promise<unknown>;
  readonly now?: () => Date;
  readonly logger?: (event: Record<string, unknown>) => void;
}

export interface ForecastSweepResult {
  readonly fixtures: number;
  readonly issued: number;
  readonly skipped: number;
}

/**
 * One periodic sweep over the next 14 days of fixtures: keep enrichment scheduled,
 * build evidence exactly at each due cutoff, and issue due INITIAL/PRE_MATCH forecasts.
 * A failure on one fixture is logged and never aborts the sweep.
 */
export async function runForecastPublicationSweep(deps: ForecastSweepDeps): Promise<ForecastSweepResult> {
  const startedAt = Date.now();
  const now = deps.now ? deps.now() : new Date();
  const nowIso = now.toISOString();
  const logger = deps.logger ?? ((event: Record<string, unknown>) => console.info(JSON.stringify(event)));
  const rows = await deps.database.fixture.findMany({
    where: { kickoffUtc: { gt: now, lt: new Date(now.getTime() + SWEEP_HORIZON_MS) }, homeTeamId: { not: "" }, awayTeamId: { not: "" } },
    select: { id: true, kickoffUtc: true, homeTeamId: true, awayTeamId: true },
  });
  const fixtures = rows.filter((row) => UUID_PATTERN.test(row.id));
  let issued = 0;
  let skipped = 0;
  for (const fixture of fixtures) {
    try {
      const kickoffUtc = fixture.kickoffUtc.toISOString();
      const issuedRows = await deps.database.forecastSnapshot.findMany({ where: { fixtureId: fixture.id, state: "ISSUED" }, select: { kind: true } });
      await schedulePublishedFixtures([{ fixtureId: fixture.id, kickoffUtc }], deps.enrichmentEnqueue);
      const due = computeDueKinds({ kickoffUtc, now: nowIso, issuedKinds: issuedRows.map((row) => row.kind) });
      if (due.length === 0) continue;
      const initialCutoff = computeInitialCutoff({ kickoffUtc, now: nowIso });
      const evidenceBuildIdsAt = async (cutoff: string): Promise<readonly string[] | null> => {
        if (Date.parse(cutoff) > Date.parse(nowIso)) return null;
        const home = await ensureTeamEvidence({ database: deps.database, teamId: fixture.homeTeamId, cutoff, now });
        if (!home) return null;
        const away = await ensureTeamEvidence({ database: deps.database, teamId: fixture.awayTeamId, cutoff, now });
        if (!away) return null;
        return [home, away].sort();
      };
      const plan = await planForecastPublication({
        fixtureId: fixture.id,
        kickoffUtc,
        initialEligibleCutoff: initialCutoff,
        modelVersion: "poisson-ensemble-v1",
        configHash: currentForecastConfigHash(),
        evidenceBuildIdsAt,
        officialLineupAt: async (cutoff) => {
          const lineup = await deps.database.lineupObservation.findFirst({
            where: { fixtureId: fixture.id, status: "OFFICIAL_CONFIRMED", confirmedAt: { lt: new Date(cutoff) } },
            orderBy: { confirmedAt: "desc" },
            select: { id: true, confirmedAt: true },
          });
          return lineup ? { id: lineup.id, confirmedAt: lineup.confirmedAt.toISOString() } : null;
        },
      });
      const publisher: ForecastPublisher = {
        publish: (request) => new ForecastOrchestrator().run({
          fixtureId: request.fixtureId,
          asOf: request.cutoff,
          kind: request.kind,
          modelVersion: "poisson-ensemble-v1",
          configHash: currentForecastConfigHash(),
          initiator: { type: "production", correlationId: `sweep:${request.fixtureId}:${request.kind}:${request.cutoff}` },
        }, deps.forecastRepository),
      };
      const dueSet = new Set<string>(due);
      let issuedHere = 0;
      for (const job of plan) {
        if (!dueSet.has(job.data.kind)) continue;
        await runForecastPublicationJob(job.data, publisher);
        issued += 1;
        issuedHere += 1;
        logger({ event: "forecast.sweep.issued", fixtureId: fixture.id, kind: job.data.kind, cutoff: job.data.cutoff });
      }
      skipped += due.length - issuedHere;
    } catch (error) {
      logger({ event: "forecast.sweep.fixture_failed", fixtureId: fixture.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  logger({ event: "forecast.sweep.completed", fixtures: fixtures.length, issued, skipped, durationMs: Date.now() - startedAt });
  return { fixtures: fixtures.length, issued, skipped };
}
