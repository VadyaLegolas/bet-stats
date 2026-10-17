import { BadRequestException, ConflictException, Injectable, type OnModuleDestroy } from "@nestjs/common";
import { createPrismaClient, type PrismaClient } from "@bet-stats/database";
import {
  evidenceComponentUnit,
  isEvidenceSourceRef,
  isEvidenceComponentKind,
  parseEvidenceReceipt,
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
  const exception = code === "UNPUBLISHED_BUILD" || code === "POST_CUTOFF_BUILD"
    ? new ConflictException({ code })
    : new BadRequestException({ code });
  return Object.assign(exception, { code });
}

function parseCutoff(value: unknown): { requested: string; utc: string; time: number } {
  if (typeof value !== "string" || !ISO_INSTANT.test(value)) throw contractError("INVALID_AS_OF");
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw contractError("INVALID_AS_OF");
  return { requested: value, utc: new Date(time).toISOString(), time };
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
  const receipt = parseEvidenceReceipt(receiptRow?.value);
  const components = Object.fromEntries(build.components.filter((component) => component.component !== "receipt").flatMap((component) => {
    const projected = projectComponent(component, receipt);
    return projected === null ? [] : [[projected.kind, projected]];
  }));
  const limited = !receipt || Object.values(components).some((component) => component.limitation !== null || component.sampleSize === 0 || component.value === null);
  const publishedAt = build.publishedAt === null ? null : new Date(build.publishedAt).toISOString();
  const freshness = publishedAt === null ? "UNAVAILABLE" : cutoff.time - Date.parse(publishedAt) > STALE_AFTER_MS ? "STALE" : "FRESH";
  return parseEvidenceProjection({ teamId: input.teamId, requestedAsOf: cutoff.requested, resolvedAsOfUtc: cutoff.utc, cutoffBoundary: { observedAt: cutoff.utc }, state: limited ? "LIMITED" : "COMPLETE", freshness, buildId: build.id, publishedAt, receipt, coverage: receipt?.sourceWindow ?? null, components });
}

export interface EvidenceDisplayTeam {
  id: string;
  name: string;
}

export interface EvidenceDisplayFixture {
  id: string;
  name: string;
  kickoff: string;
}

export interface EvidenceDisplayFixtureRow {
  id: string;
  kickoffUtc: Date;
  homeTeam: { name: string };
  awayTeam: { name: string };
}

export interface EvidenceDisplay {
  team: EvidenceDisplayTeam | null;
  fixture: EvidenceDisplayFixture | null;
}

export type EvidenceFixtureLabels = Readonly<Record<string, string>>;

export type EvidenceResponse = EvidenceProjection & { team: EvidenceDisplayTeam | null; fixture: EvidenceDisplayFixture | null; fixtureLabels: EvidenceFixtureLabels };

export interface EvidenceDisplayLookup {
  findTeam(teamId: string): Promise<EvidenceDisplayTeam | null>;
  findFixture(fixtureId: string): Promise<EvidenceDisplayFixtureRow | null>;
  findFixtures?(fixtureIds: readonly string[]): Promise<readonly EvidenceDisplayFixtureRow[]>;
}

export function attachEvidenceDisplay(projection: EvidenceProjection, team: EvidenceDisplayTeam | null, fixture: EvidenceDisplayFixture | null, fixtureLabels: EvidenceFixtureLabels = {}): EvidenceResponse {
  return { ...projection, team, fixture, fixtureLabels };
}

export function composeFixtureDisplay(row: EvidenceDisplayFixtureRow): EvidenceDisplayFixture {
  return { id: row.id, name: `${row.homeTeam.name} против ${row.awayTeam.name}`, kickoff: row.kickoffUtc.toISOString() };
}

export async function loadEvidenceDisplay(lookup: EvidenceDisplayLookup | null, teamId: string, fixtureId?: string): Promise<EvidenceDisplay> {
  if (!lookup) return { team: null, fixture: null };
  let team: EvidenceDisplayTeam | null = null;
  try {
    team = await lookup.findTeam(teamId);
  } catch {
    team = null;
  }
  let fixture: EvidenceDisplayFixture | null = null;
  const normalizedFixtureId = fixtureId?.trim() || undefined;
  if (normalizedFixtureId !== undefined) {
    try {
      const row = await lookup.findFixture(normalizedFixtureId);
      fixture = row === null ? null : composeFixtureDisplay(row);
    } catch {
      fixture = null;
    }
  }
  return { team, fixture };
}

/** Distinct fixture ids referenced by the projection receipt inputs and component source refs. Pure. */
export function collectEvidenceFixtureIds(projection: EvidenceProjection): readonly string[] {
  const ids = new Set<string>();
  for (const input of projection.receipt?.inputs ?? []) ids.add(input.fixtureId);
  for (const component of Object.values(projection.components)) for (const source of component?.sourceRefs ?? []) ids.add(source.fixtureId);
  return [...ids];
}

/** fixtureId -> composed team label for the fixture trace table; failures degrade to an unlabeled map. */
export async function loadEvidenceFixtureLabels(lookup: EvidenceDisplayLookup | null, projection: EvidenceProjection): Promise<EvidenceFixtureLabels> {
  if (!lookup?.findFixtures) return {};
  const ids = collectEvidenceFixtureIds(projection);
  if (ids.length === 0) return {};
  try {
    const rows = await lookup.findFixtures(ids);
    return Object.fromEntries(rows.map((row) => [row.id, composeFixtureDisplay(row).name]));
  } catch {
    return {};
  }
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
  private displayLookup(): EvidenceDisplayLookup | null {
    const database = this.database;
    if (!database) return null;
    return {
      findTeam: (teamId) => database.team.findUnique({ where: { id: teamId }, select: { id: true, name: true } }),
      findFixture: (fixtureId) => database.fixture.findUnique({
        where: { id: fixtureId },
        select: { id: true, kickoffUtc: true, homeTeam: { select: { name: true } }, awayTeam: { select: { name: true } } },
      }),
      findFixtures: (fixtureIds) => database.fixture.findMany({
        where: { id: { in: [...fixtureIds] } },
        select: { id: true, kickoffUtc: true, homeTeam: { select: { name: true } }, awayTeam: { select: { name: true } } },
      }),
    };
  }
  async get(teamId: string, asOf?: string, fixtureId?: string): Promise<EvidenceResponse> {
    const projection = await resolveTeamEvidence({ teamId, asOf }, this.repository);
    const lookup = this.displayLookup();
    const display = await loadEvidenceDisplay(lookup, teamId, fixtureId);
    const fixtureLabels = await loadEvidenceFixtureLabels(lookup, projection);
    return attachEvidenceDisplay(projection, display.team, display.fixture, fixtureLabels);
  }
}
