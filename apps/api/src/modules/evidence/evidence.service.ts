import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import { createPrismaClient, type PrismaClient } from "@bet-stats/database";
import {
  evidenceComponentUnit,
  isEvidenceSourceRef,
  isEvidenceComponentKind,
  parseEvidenceProjection,
  type EvidenceComponentKind,
  type EvidenceLimitation,
  type EvidenceProjectionComponent,
  type EvidenceProjectionDto,
  type EvidenceReceipt,
  type EvidenceSourceRef,
} from "@bet-stats/domain";

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
const STALE_AFTER_MS = 72 * 60 * 60 * 1_000;

export interface PublishedEvidenceComponent {
  component: string;
  value: unknown;
  sampleSize: number;
  limitation: string | null;
  sourceTimes: unknown;
}

export interface PublishedEvidenceBuild {
  id: string;
  state: string;
  cutoff: Date | string;
  publishedAt: Date | string | null;
  components: readonly PublishedEvidenceComponent[];
}

export interface EvidenceRepository {
  findPublished(teamId: string, cutoff: string): Promise<PublishedEvidenceBuild | null>;
}

export type EvidenceProjection = EvidenceProjectionDto;

function contractError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}

function parseCutoff(value: unknown): { requested: string; utc: string; time: number } {
  if (typeof value !== "string" || !ISO_INSTANT.test(value)) throw contractError("INVALID_AS_OF");
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw contractError("INVALID_AS_OF");
  return { requested: value, utc: new Date(time).toISOString(), time };
}

function asReceipt(value: unknown): EvidenceReceipt | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<EvidenceReceipt>;
  if (typeof candidate.resolvedAsOf !== "string" || !Array.isArray(candidate.inputs) || candidate.sourceWindow === undefined) return null;
  return { ...candidate, inputs: candidate.inputs.filter(isEvidenceSourceRef) } as EvidenceReceipt;
}

function sourceRefs(component: PublishedEvidenceComponent, receipt: EvidenceReceipt | null): readonly EvidenceSourceRef[] | null {
  if (!Array.isArray(component.sourceTimes)) return null;
  const inputs = receipt?.inputs ?? [];
  const refs: EvidenceSourceRef[] = [];
  for (const value of component.sourceTimes) {
    if (!isEvidenceSourceRef(value)) return null;
    const source = value;
    const full = inputs.find((input) => isEvidenceSourceRef(input)
      && input.fixtureId === source.fixtureId
      && input.effectiveAt === source.effectiveAt
      && input.observedAt === source.observedAt
      && input.payloadHash === source.payloadHash
      && input.payloadBytes === source.payloadBytes);
    if (!full) return null;
    refs.push(full);
  }
  if (component.value !== null && component.value !== undefined && refs.length === 0) return null;
  return refs;
}

function limitation(value: string | null): EvidenceLimitation | null {
  return value === "NO_ELIGIBLE_HISTORY" || value === "LIMITED_HISTORY" || value === "MISSING_TIMESTAMP" ? value : null;
}

function projectComponent(component: PublishedEvidenceComponent, receipt: EvidenceReceipt | null): EvidenceProjectionComponent | null {
  if (!isEvidenceComponentKind(component.component)) return null;
  const kind: EvidenceComponentKind = component.component;
  const refs = sourceRefs(component, receipt);
  const projected = {
    kind,
    value: refs === null ? null : component.value ?? null,
    unit: evidenceComponentUnit(kind),
    sampleSize: component.sampleSize,
    limitation: refs === null ? "MISSING_TIMESTAMP" as const : limitation(component.limitation),
    sourceRefs: refs ?? [],
  };
  try { return parseEvidenceProjection({ teamId: "validation", requestedAsOf: "validation", resolvedAsOfUtc: "validation", cutoffBoundary: { observedAt: "validation" }, state: "LIMITED", freshness: "UNAVAILABLE", buildId: null, publishedAt: null, receipt: null, coverage: null, components: { [kind]: projected } }).components[kind] ?? null; }
  catch { return { ...projected, value: null, limitation: "MISSING_TIMESTAMP", sourceRefs: [] } as EvidenceProjectionComponent; }
}

export async function resolveTeamEvidence(input: { teamId?: unknown; asOf?: unknown }, repository?: EvidenceRepository): Promise<EvidenceProjection> {
  const cutoff = parseCutoff(input.asOf);
  if (typeof input.teamId !== "string" || input.teamId.trim() === "") throw contractError("INVALID_TEAM_ID");
  const build = await repository?.findPublished(input.teamId, cutoff.utc) ?? null;
  if (!build) return parseEvidenceProjection({ teamId: input.teamId, requestedAsOf: cutoff.requested, resolvedAsOfUtc: cutoff.utc, cutoffBoundary: { observedAt: cutoff.utc }, state: "PENDING", freshness: "UNAVAILABLE", buildId: null, publishedAt: null, receipt: null, coverage: null, components: {} });
  const buildCutoff = new Date(build.cutoff).getTime();
  if (build.state !== "PUBLISHED") throw contractError("UNPUBLISHED_BUILD");
  if (!Number.isFinite(buildCutoff) || buildCutoff > cutoff.time) throw contractError("POST_CUTOFF_BUILD");
  const receiptRow = build.components.find((component) => component.component === "receipt");
  const receipt = asReceipt(receiptRow?.value);
  const components = Object.fromEntries(build.components.filter((component) => component.component !== "receipt").flatMap((component) => {
    const projected = projectComponent(component, receipt);
    return projected === null ? [] : [[projected.kind, projected]];
  }));
  const limited = !receipt || Object.values(components).some((component) => component.limitation !== null || component.sampleSize === 0 || component.value === null);
  const publishedAt = build.publishedAt === null ? null : new Date(build.publishedAt).toISOString();
  const freshness = publishedAt === null ? "UNAVAILABLE" : cutoff.time - Date.parse(publishedAt) > STALE_AFTER_MS ? "STALE" : "FRESH";
  return parseEvidenceProjection({ teamId: input.teamId, requestedAsOf: cutoff.requested, resolvedAsOfUtc: cutoff.utc, cutoffBoundary: { observedAt: cutoff.utc }, state: limited ? "LIMITED" : "COMPLETE", freshness, buildId: build.id, publishedAt, receipt, coverage: receipt?.sourceWindow ?? null, components });
}

@Injectable()
export class EvidenceService implements OnModuleDestroy {
  private readonly database: PrismaClient | null = process.env.DATABASE_URL ? createPrismaClient(process.env.DATABASE_URL) : null;
  private readonly repository: EvidenceRepository = {
    findPublished: async (teamId, cutoff) => {
      if (!this.database) return null;
      return this.database.evidenceBuild.findFirst({ where: { teamId, cutoff: { lte: new Date(cutoff) }, state: "PUBLISHED" }, include: { components: true }, orderBy: [{ cutoff: "desc" }, { publishedAt: "desc" }] }) as Promise<PublishedEvidenceBuild | null>;
    },
  };
  async onModuleDestroy(): Promise<void> { await this.database?.$disconnect(); }
  get(teamId: string, asOf?: string): Promise<EvidenceProjection> { return resolveTeamEvidence({ teamId, asOf }, this.repository); }
}
