
import type { EvidenceProjectionDto, EvidenceSourceRef } from "../evidence/contract.js";
import { canonicalSha256 } from "../forecast/canonical-json.js";
import { forecastConfigHashFor } from "../forecast/config.js";
import { parseForecastResponse, type ForecastKind, type ForecastResponseDto } from "../forecast/contract.js";
import type { DixonColesProvenance } from "../forecast/dixon-coles.js";
import { createForecast } from "../forecast/model.js";
import { isForecastModelVersion, type ForecastModelVersion } from "../forecast/model-version.js";

export interface ForecastFixture {
  readonly id: string;
  readonly homeTeamId: string;
  readonly awayTeamId: string;
  readonly leagueId: string;
  readonly kickoffUtc: Date | string;
  readonly canonicalIdentityResolved: boolean;
}

export interface ForecastOrchestratorRepository {
  assertEligible(): Promise<void>;
  findFixture(fixtureId: string): Promise<ForecastFixture | null>;
  findEvidence(teamId: string, cutoff: string): Promise<EvidenceProjectionDto | null>;
  findOfficialLineup(fixtureId: string, cutoff: string): Promise<{ id: string } | null>;
  /** The context is optional so every existing one-argument test double stays valid; absent means PRODUCTION. */
  publish(draft: ForecastResponseDto, context?: ForecastPublishContext): Promise<ForecastResponseDto>;
  /**
   * Resolves rho for a league at a cutoff. Optional to keep every existing
   * repository double compatible; the dixon-coles path fails closed without it.
   */
  findDixonColesParameters?(input: { leagueId: string; asOf: string }): Promise<Readonly<{ rho: number; provenance: DixonColesProvenance }> | null>;
}

export type ForecastInitiator =
  | Readonly<{ type: "production"; correlationId: string }>
  | Readonly<{ type: "backtest"; correlationId: string; planId?: string; windowId: string }>;

/** Provenance of a published snapshot: PRODUCTION is contemporaneous evidence, BACKTEST is retrospective. */
export type ForecastOrigin = "PRODUCTION" | "BACKTEST";

export interface ForecastPublishContext {
  readonly origin: ForecastOrigin;
}

/**
 * The origin comes only from the initiator the orchestrator already validates. It is deliberately not a
 * repository constructor option: one repository instance serves production lineup forecasts and the
 * backtest worker (workers/data-sync/src/main.ts), so a repository-level default would mislabel one of them.
 */
export function forecastOriginOf(initiator: ForecastInitiator): ForecastOrigin {
  return initiator.type === "backtest" ? "BACKTEST" : "PRODUCTION";
}

export interface ForecastOrchestratorInput {
  readonly fixtureId: string;
  readonly asOf: string;
  readonly kind: ForecastKind;
  readonly modelVersion: ForecastModelVersion;
  readonly configHash: string;
  readonly initiator: ForecastInitiator;
  /** Explicit rho wins over the repository resolver; required for dixon-coles when no resolver exists. */
  readonly dixonColes?: Readonly<{ rho: number; provenance: DixonColesProvenance }>;
}

const sha = canonicalSha256;

export function currentForecastConfigHash(): string {
  return forecastConfigHashFor("poisson-ensemble-v1");
}

function coded(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}

type ResolvedDixonColes = Readonly<{ rho: number; provenance: DixonColesProvenance }>;

async function resolveDixonColes(
  input: ForecastOrchestratorInput,
  fixture: ForecastFixture,
  repository: ForecastOrchestratorRepository,
): Promise<ResolvedDixonColes | undefined> {
  // The version is never inferred from the presence of parameters (D-09/D-10).
  if (input.modelVersion !== "dixon-coles-ensemble-v1") return undefined;
  const accept = (candidate: ResolvedDixonColes | null): ResolvedDixonColes => {
    if (!candidate || !Number.isFinite(candidate.rho) || candidate.rho !== candidate.provenance.rho) throw coded("DIXON_COLES_RHO_UNAVAILABLE");
    return candidate;
  };
  if (input.dixonColes) return accept(input.dixonColes);
  const resolved = repository.findDixonColesParameters
    ? await repository.findDixonColesParameters({ leagueId: fixture.leagueId, asOf: input.asOf })
    : null;
  return accept(resolved);
}

function assertSourceBeforeCutoff(source: EvidenceSourceRef, cutoffMs: number): void {
  const times = [source.effectiveAt, source.observedAt, source.sourceUpdatedAt].filter((value): value is string => value !== null);
  if (times.some((value) => !Number.isFinite(Date.parse(value)) || Date.parse(value) > cutoffMs)) throw coded("LEAKAGE_DETECTED");
}

function verifyEvidence(projection: EvidenceProjectionDto | null, cutoff: string): asserts projection is EvidenceProjectionDto {
  if (!projection?.buildId || !projection.receipt) throw coded("REQUIRED_EVIDENCE_UNAVAILABLE");
  if (projection.resolvedAsOfUtc !== cutoff || projection.requestedAsOf !== cutoff || projection.cutoffBoundary.observedAt !== cutoff || projection.receipt.requestedAsOf !== cutoff || projection.receipt.resolvedAsOf !== cutoff) throw coded("EVIDENCE_CUTOFF_MISMATCH");
  const boundary = Date.parse(cutoff);
  for (const source of projection.receipt.inputs) assertSourceBeforeCutoff(source, boundary);
  for (const component of Object.values(projection.components)) for (const source of component?.sourceRefs ?? []) assertSourceBeforeCutoff(source, boundary);
}

export class ForecastOrchestrator {
  async run(input: ForecastOrchestratorInput, repository: ForecastOrchestratorRepository): Promise<ForecastResponseDto> {
    if (!Number.isFinite(Date.parse(input.asOf)) || new Date(input.asOf).toISOString() !== input.asOf) throw coded("INVALID_FORECAST_CUTOFF");
    if (!isForecastModelVersion(input.modelVersion)) throw coded("MODEL_VERSION_MISMATCH");
    if (input.configHash !== forecastConfigHashFor(input.modelVersion)) throw coded("CONFIG_HASH_MISMATCH");
    if (!input.initiator.correlationId) throw coded("INVALID_FORECAST_INITIATOR");
    await repository.assertEligible();
    const fixture = await repository.findFixture(input.fixtureId);
    if (!fixture) throw coded("FIXTURE_NOT_FOUND");
    if (!fixture.canonicalIdentityResolved) throw coded("UNRESOLVED_CANONICAL_IDENTITY");
    if (Date.parse(input.asOf) >= new Date(fixture.kickoffUtc).getTime()) throw coded("POST_KICKOFF_CUTOFF");
    const dixonColes = await resolveDixonColes(input, fixture, repository);
    const [home, away] = await Promise.all([
      repository.findEvidence(fixture.homeTeamId, input.asOf),
      repository.findEvidence(fixture.awayTeamId, input.asOf),
    ]);
    verifyEvidence(home, input.asOf);
    verifyEvidence(away, input.asOf);
    const lineup = input.kind === "LINEUP_CONFIRMED" ? await repository.findOfficialLineup(fixture.id, input.asOf) : null;
    if (input.kind === "LINEUP_CONFIRMED" && !lineup) throw coded("LINEUP_NOT_CONFIRMED");
    const homeBuildId = home.buildId;
    const awayBuildId = away.buildId;
    if (!homeBuildId || !awayBuildId) throw coded("REQUIRED_EVIDENCE_UNAVAILABLE");
    const evidenceBuildIds = [homeBuildId, awayBuildId].sort();
    const officialLineupObservationId = lineup?.id ?? null;
    const runtimeIdentity = { modelVersion: input.modelVersion, ...(dixonColes ? { dixonColes } : {}) };
    const preliminary = createForecast({ fixtureId: fixture.id, forecastSnapshotId: "pending", cutoff: input.asOf, canonicalIdentityState: "RESOLVED", home, away, lineupAvailable: lineup !== null, sourceReliability: 1, ...runtimeIdentity });
    if (preliminary.modelVersion !== input.modelVersion || preliminary.configHash !== input.configHash) throw coded("FORECAST_RUNTIME_IDENTITY_MISMATCH");
    const inputHash = sha({ forecastInputHash: preliminary.inputHash, officialLineupObservationId });
    const snapshotId = sha({ fixtureId: fixture.id, kind: input.kind, cutoff: input.asOf, modelVersion: preliminary.modelVersion, configHash: preliminary.configHash, inputHash, evidenceBuildIds, officialLineupObservationId }).slice(7);
    const forecast = createForecast({ fixtureId: fixture.id, forecastSnapshotId: snapshotId, cutoff: input.asOf, canonicalIdentityState: "RESOLVED", home, away, lineupAvailable: lineup !== null, sourceReliability: 1, ...runtimeIdentity });
    const draft: ForecastResponseDto = {
      id: snapshotId, fixtureId: fixture.id, kind: input.kind, officialLineupObservationId, revision: 1, cutoff: input.asOf,
      modelVersion: forecast.modelVersion, modelHash: sha({ version: forecast.modelVersion }), configVersion: forecast.configVersion,
      configHash: forecast.configHash, inputHash, evidenceFingerprint: sha(evidenceBuildIds), evidenceBuildIds,
      probabilities: forecast.markets, confidence: forecast.confidence, limitations: forecast.limitations,
      tail: { retainedMass: forecast.retainedMass, tailMass: forecast.tailMass, warning: forecast.tailWarning, normalizationVersion: forecast.normalizationVersion },
      assumptions: forecast.assumptions,
      receipt: { forecastSnapshotId: snapshotId, officialLineupObservationId, evidenceBuildIds, sourceRefs: forecast.sources, expectedGoals: forecast.expectedGoals, adjustments: forecast.adjustments, ...(forecast.dixonColes ? { dixonColes: forecast.dixonColes } : {}) },
      issuedAt: new Date().toISOString(),
    };
    parseForecastResponse(draft);
    return repository.publish(draft, { origin: forecastOriginOf(input.initiator) });
  }
}
