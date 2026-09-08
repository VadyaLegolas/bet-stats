import { createHash } from "node:crypto";

import type { EvidenceProjectionDto, EvidenceSourceRef } from "../evidence/contract.js";
import { FORECAST_CONFIG } from "../forecast/config.js";
import { parseForecastResponse, type ForecastKind, type ForecastResponseDto } from "../forecast/contract.js";
import { createForecast } from "../forecast/model.js";

export interface ForecastFixture {
  readonly id: string;
  readonly homeTeamId: string;
  readonly awayTeamId: string;
  readonly kickoffUtc: Date | string;
  readonly canonicalIdentityResolved: boolean;
}

export interface ForecastOrchestratorRepository {
  assertEligible(): Promise<void>;
  findFixture(fixtureId: string): Promise<ForecastFixture | null>;
  findEvidence(teamId: string, cutoff: string): Promise<EvidenceProjectionDto | null>;
  findOfficialLineup(fixtureId: string, cutoff: string): Promise<{ id: string } | null>;
  publish(draft: ForecastResponseDto): Promise<ForecastResponseDto>;
}

export type ForecastInitiator =
  | Readonly<{ type: "production"; correlationId: string }>
  | Readonly<{ type: "backtest"; correlationId: string; planId?: string; windowId: string }>;

export interface ForecastOrchestratorInput {
  readonly fixtureId: string;
  readonly asOf: string;
  readonly kind: ForecastKind;
  readonly modelVersion: "poisson-ensemble-v1";
  readonly configHash: string;
  readonly initiator: ForecastInitiator;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value);
}

function sha(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;
}

export function currentForecastConfigHash(): string {
  return sha(FORECAST_CONFIG);
}

function coded(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
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
    if (input.modelVersion !== "poisson-ensemble-v1") throw coded("MODEL_VERSION_MISMATCH");
    if (input.configHash !== currentForecastConfigHash()) throw coded("CONFIG_HASH_MISMATCH");
    if (!input.initiator.correlationId) throw coded("INVALID_FORECAST_INITIATOR");
    await repository.assertEligible();
    const fixture = await repository.findFixture(input.fixtureId);
    if (!fixture) throw coded("FIXTURE_NOT_FOUND");
    if (!fixture.canonicalIdentityResolved) throw coded("UNRESOLVED_CANONICAL_IDENTITY");
    if (Date.parse(input.asOf) >= new Date(fixture.kickoffUtc).getTime()) throw coded("POST_KICKOFF_CUTOFF");
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
    const preliminary = createForecast({ fixtureId: fixture.id, forecastSnapshotId: "pending", cutoff: input.asOf, canonicalIdentityState: "RESOLVED", home, away, lineupAvailable: lineup !== null, sourceReliability: 1 });
    if (preliminary.modelVersion !== input.modelVersion || preliminary.configHash !== input.configHash) throw coded("FORECAST_RUNTIME_IDENTITY_MISMATCH");
    const inputHash = sha({ forecastInputHash: preliminary.inputHash, officialLineupObservationId });
    const snapshotId = sha({ fixtureId: fixture.id, kind: input.kind, cutoff: input.asOf, modelVersion: preliminary.modelVersion, configHash: preliminary.configHash, inputHash, evidenceBuildIds, officialLineupObservationId }).slice(7);
    const forecast = createForecast({ fixtureId: fixture.id, forecastSnapshotId: snapshotId, cutoff: input.asOf, canonicalIdentityState: "RESOLVED", home, away, lineupAvailable: lineup !== null, sourceReliability: 1 });
    const draft: ForecastResponseDto = {
      id: snapshotId, fixtureId: fixture.id, kind: input.kind, officialLineupObservationId, revision: 1, cutoff: input.asOf,
      modelVersion: forecast.modelVersion, modelHash: sha({ version: forecast.modelVersion }), configVersion: forecast.configVersion,
      configHash: forecast.configHash, inputHash, evidenceFingerprint: sha(evidenceBuildIds), evidenceBuildIds,
      probabilities: forecast.markets, confidence: forecast.confidence, limitations: forecast.limitations,
      tail: { retainedMass: forecast.retainedMass, tailMass: forecast.tailMass, warning: forecast.tailWarning, normalizationVersion: forecast.normalizationVersion },
      assumptions: forecast.assumptions,
      receipt: { forecastSnapshotId: snapshotId, officialLineupObservationId, evidenceBuildIds, sourceRefs: forecast.sources, expectedGoals: forecast.expectedGoals, adjustments: forecast.adjustments },
      issuedAt: new Date().toISOString(),
    };
    parseForecastResponse(draft);
    return repository.publish(draft);
  }
}
