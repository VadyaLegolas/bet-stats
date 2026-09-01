export type EvidenceLimitation = "NO_ELIGIBLE_HISTORY" | "LIMITED_HISTORY" | "MISSING_TIMESTAMP";

export interface EvidenceMatch {
  readonly fixtureId: string;
  readonly kickoffUtc: string;
  readonly effectiveAt: string;
  readonly observedAt: string;
  readonly sourceUpdatedAt: string | null;
  readonly payloadHash: string;
  readonly payloadBytes: number;
  readonly points?: 0 | 1 | 3;
  readonly teamId?: string;
  readonly opponentId?: string;
  readonly venue?: "HOME" | "AWAY";
  readonly goalsFor?: number;
  readonly goalsAgainst?: number;
}

export interface EvidenceSourceRef {
  readonly fixtureId: string;
  readonly effectiveAt: string;
  readonly observedAt: string;
  readonly sourceUpdatedAt: string | null;
  readonly payloadHash: string;
  readonly payloadBytes: number;
}

export interface EvidenceWindow {
  readonly requestedFrom: string | null;
  readonly requestedTo: string;
  readonly returnedFrom: string | null;
  readonly returnedTo: string | null;
}

export interface EvidenceComponent<T> {
  readonly value: T | null;
  readonly sampleSize: number;
  readonly windowStart: string | null;
  readonly windowEnd: string | null;
  readonly sourceRefs: readonly EvidenceSourceRef[];
  readonly limitation: EvidenceLimitation | null;
}

export interface EvidenceReceipt {
  readonly requestedAsOf: string;
  readonly resolvedAsOf: string;
  readonly configVersion: string;
  readonly sourceWindow: EvidenceWindow;
  readonly inputs: readonly EvidenceSourceRef[];
}

export type EvidenceComponentKind = "form5" | "form10" | "elo" | "homeStrength" | "awayStrength" | "goalRates" | "restDays" | "h2h";
export type EvidenceUnit = "points-per-match" | "rating-points" | "goals-per-match" | "days" | "weight";

interface EvidenceProjectionComponentBase {
  readonly sampleSize: number;
  readonly limitation: EvidenceLimitation | null;
  readonly sourceRefs: readonly EvidenceSourceRef[];
}

export type EvidenceProjectionComponent =
  | (EvidenceProjectionComponentBase & { readonly kind: "form5" | "form10"; readonly value: number | null; readonly unit: "points-per-match" })
  | (EvidenceProjectionComponentBase & { readonly kind: "elo"; readonly value: number | null; readonly unit: "rating-points" })
  | (EvidenceProjectionComponentBase & { readonly kind: "homeStrength" | "awayStrength"; readonly value: number | null; readonly unit: "points-per-match" })
  | (EvidenceProjectionComponentBase & { readonly kind: "goalRates"; readonly value: Readonly<{ for: number; against: number }> | null; readonly unit: "goals-per-match" })
  | (EvidenceProjectionComponentBase & { readonly kind: "restDays"; readonly value: number | null; readonly unit: "days" })
  | (EvidenceProjectionComponentBase & { readonly kind: "h2h"; readonly value: Readonly<{ pointsPerMatch: number; weight: number }> | null; readonly unit: "points-per-match" });

export interface EvidenceProjectionDto {
  readonly teamId: string;
  readonly requestedAsOf: string;
  readonly resolvedAsOfUtc: string;
  readonly cutoffBoundary: Readonly<{ observedAt: string }>;
  readonly state: "COMPLETE" | "LIMITED" | "PENDING";
  readonly freshness: "FRESH" | "STALE" | "UNAVAILABLE";
  readonly buildId: string | null;
  readonly publishedAt: string | null;
  readonly receipt: EvidenceReceipt | null;
  readonly coverage: EvidenceWindow | null;
  readonly components: Partial<Record<EvidenceComponentKind, EvidenceProjectionComponent>>;
}

const COMPONENT_UNITS: Readonly<Record<EvidenceComponentKind, EvidenceUnit>> = {
  form5: "points-per-match",
  form10: "points-per-match",
  elo: "rating-points",
  homeStrength: "points-per-match",
  awayStrength: "points-per-match",
  goalRates: "goals-per-match",
  restDays: "days",
  h2h: "points-per-match",
};

export function isEvidenceComponentKind(value: string): value is EvidenceComponentKind {
  return Object.hasOwn(COMPONENT_UNITS, value);
}

export function evidenceComponentUnit(kind: EvidenceComponentKind): EvidenceUnit {
  return COMPONENT_UNITS[kind];
}

export function parseEvidenceProjection(value: unknown): EvidenceProjectionDto {
  if (!value || typeof value !== "object") throw new Error("INVALID_EVIDENCE_PROJECTION");
  const candidate = value as EvidenceProjectionDto;
  if (typeof candidate.teamId !== "string" || typeof candidate.requestedAsOf !== "string" || typeof candidate.resolvedAsOfUtc !== "string" || !candidate.components || typeof candidate.components !== "object") throw new Error("INVALID_EVIDENCE_PROJECTION");
  if (candidate.receipt !== null && (!candidate.receipt || !Array.isArray(candidate.receipt.inputs) || candidate.receipt.inputs.some((input) => !isEvidenceSourceRef(input)))) throw new Error("INVALID_EVIDENCE_RECEIPT");
  for (const [key, component] of Object.entries(candidate.components)) {
    if (!isEvidenceComponentKind(key) || !component || component.kind !== key || component.unit !== evidenceComponentUnit(key) || !Array.isArray(component.sourceRefs)) throw new Error("INVALID_EVIDENCE_COMPONENT");
    if (component.sourceRefs.some((source) => !isEvidenceSourceRef(source))) throw new Error("INVALID_EVIDENCE_SOURCE_REF");
    if (component.value !== null && !validComponentValue(key, component.value)) throw new Error("INVALID_EVIDENCE_COMPONENT_VALUE");
  }
  return candidate;
}

export function isEvidenceSourceRef(value: unknown): value is EvidenceSourceRef {
  if (!value || typeof value !== "object") return false;
  const source = value as Partial<EvidenceSourceRef>;
  return typeof source.fixtureId === "string" && source.fixtureId.length > 0
    && typeof source.effectiveAt === "string" && Number.isFinite(Date.parse(source.effectiveAt))
    && typeof source.observedAt === "string" && Number.isFinite(Date.parse(source.observedAt))
    && (source.sourceUpdatedAt === null || typeof source.sourceUpdatedAt === "string")
    && typeof source.payloadHash === "string" && source.payloadHash.length > 0
    && typeof source.payloadBytes === "number" && Number.isInteger(source.payloadBytes) && source.payloadBytes >= 0;
}

function validComponentValue(kind: EvidenceComponentKind, value: unknown): boolean {
  if (["form5", "form10", "elo", "homeStrength", "awayStrength", "restDays"].includes(kind)) return typeof value === "number" && Number.isFinite(value);
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return kind === "goalRates"
    ? typeof record.for === "number" && Number.isFinite(record.for) && typeof record.against === "number" && Number.isFinite(record.against)
    : typeof record.pointsPerMatch === "number" && Number.isFinite(record.pointsPerMatch) && typeof record.weight === "number" && Number.isFinite(record.weight);
}

export function toSourceRef(match: EvidenceMatch): EvidenceSourceRef {
  return { fixtureId: match.fixtureId, effectiveAt: match.effectiveAt, observedAt: match.observedAt, sourceUpdatedAt: match.sourceUpdatedAt, payloadHash: match.payloadHash, payloadBytes: match.payloadBytes };
}
