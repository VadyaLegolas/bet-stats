import { createHash } from "node:crypto";

import type { RequestPriorityLane } from "./request-budget.js";

export const REPLAY_PROVIDER_POLICY_VERSION = "replay-provider-policy/v1" as const;

export type ReplayProviderPolicyDenialReason =
  | "MISSING_POLICY"
  | "MALFORMED_POLICY"
  | "MISSING_CIRCUIT_STATE"
  | "STALE_CIRCUIT_STATE"
  | "UNKNOWN_RESET_SEMANTICS"
  | "CIRCUIT_OPEN"
  | "CIRCUIT_HALF_OPEN"
  | "ALLOWANCE_EXHAUSTED"
  | "CRITICAL_HEADROOM";

export interface ReplayProviderPolicySnapshot {
  readonly version: typeof REPLAY_PROVIDER_POLICY_VERSION;
  readonly provider: string;
  readonly endpointFamily: string;
  readonly lane: RequestPriorityLane | null;
  readonly resetDate: string | null;
  readonly resetTimezone: string | null;
  readonly configuredAllowance: number | null;
  readonly criticalHeadroom: number | null;
  readonly reserved: number | null;
  readonly remaining: number | null;
  readonly availableForLane: number | null;
  readonly circuit: {
    readonly state: "CLOSED" | "OPEN" | "HALF_OPEN" | null;
    readonly updatedAt: string | null;
    readonly nextProbeAt: string | null;
    readonly probeLeaseExpiresAt: string | null;
  };
  readonly observedAt: string;
  readonly validUntil: string | null;
  readonly blockedReason: ReplayProviderPolicyDenialReason | null;
}

export type ReplayProviderPolicyDecision =
  | { readonly allowed: true; readonly remainingAfter: number }
  | { readonly allowed: false; readonly reason: ReplayProviderPolicyDenialReason };

export type ReplayProviderPolicyIdentity = Pick<ReplayProviderPolicySnapshot,
  "version" | "provider" | "endpointFamily" | "lane" | "configuredAllowance" | "criticalHeadroom" | "resetTimezone">;

export function projectReplayProviderPolicyIdentity(snapshot: ReplayProviderPolicySnapshot): ReplayProviderPolicyIdentity {
  const { version, provider, endpointFamily, lane, configuredAllowance, criticalHeadroom, resetTimezone } = snapshot;
  return { version, provider, endpointFamily, lane, configuredAllowance, criticalHeadroom, resetTimezone };
}

export function fingerprintReplayProviderPolicy(snapshot: ReplayProviderPolicySnapshot): string {
  return `identity-v2:${createHash("sha256").update(canonicalJson(projectReplayProviderPolicyIdentity(snapshot))).digest("hex")}`;
}

/** Validate the stored format before deriving its current identity; never rewrite approval hashes. */
export function verifyPersistedReplayProviderPolicyFingerprint(snapshot: ReplayProviderPolicySnapshot, fingerprint: string): string | null {
  try {
    if (!isSnapshotEnvelopeValid(snapshot)) return null;
    const identity = fingerprintReplayProviderPolicy(snapshot);
    if (fingerprint.startsWith("identity-v2:")) return fingerprint === identity ? identity : null;
    if (!/^[a-f0-9]{64}$/.test(fingerprint)) return null;
    const { observedAt: _observedAt, ...legacy } = snapshot;
    return createHash("sha256").update(canonicalJson(legacy)).digest("hex") === fingerprint ? identity : null;
  } catch {
    return null;
  }
}

export function evaluateReplayProviderPolicy(
  snapshot: ReplayProviderPolicySnapshot,
  requiredCalls: number,
  now = new Date(),
): ReplayProviderPolicyDecision {
  if (!isSnapshotEnvelopeValid(snapshot) || !Number.isSafeInteger(requiredCalls) || requiredCalls <= 0) {
    return { allowed: false, reason: "MALFORMED_POLICY" };
  }
  if (snapshot.blockedReason) return { allowed: false, reason: snapshot.blockedReason };
  if (!hasCompleteQuota(snapshot)) return { allowed: false, reason: "MALFORMED_POLICY" };
  if (!snapshot.resetDate || !snapshot.resetTimezone) return { allowed: false, reason: "UNKNOWN_RESET_SEMANTICS" };
  if (!snapshot.validUntil || Date.parse(snapshot.validUntil) <= now.getTime()) {
    return { allowed: false, reason: "STALE_CIRCUIT_STATE" };
  }
  if (snapshot.circuit.state === "OPEN") return { allowed: false, reason: "CIRCUIT_OPEN" };
  if (snapshot.circuit.state === "HALF_OPEN") return { allowed: false, reason: "CIRCUIT_HALF_OPEN" };
  if (snapshot.circuit.state !== "CLOSED") return { allowed: false, reason: "MISSING_CIRCUIT_STATE" };
  if (snapshot.remaining < requiredCalls) return { allowed: false, reason: "ALLOWANCE_EXHAUSTED" };
  if (snapshot.availableForLane < requiredCalls) return { allowed: false, reason: "CRITICAL_HEADROOM" };
  return { allowed: true, remainingAfter: snapshot.availableForLane - requiredCalls };
}

function hasCompleteQuota(snapshot: ReplayProviderPolicySnapshot): snapshot is ReplayProviderPolicySnapshot & {
  lane: RequestPriorityLane;
  configuredAllowance: number;
  criticalHeadroom: number;
  reserved: number;
  remaining: number;
  availableForLane: number;
} {
  return snapshot.lane !== null
    && nonNegativeInteger(snapshot.configuredAllowance)
    && nonNegativeInteger(snapshot.criticalHeadroom)
    && nonNegativeInteger(snapshot.reserved)
    && nonNegativeInteger(snapshot.remaining)
    && nonNegativeInteger(snapshot.availableForLane);
}

function isSnapshotEnvelopeValid(snapshot: ReplayProviderPolicySnapshot): boolean {
  return snapshot.version === REPLAY_PROVIDER_POLICY_VERSION
    && snapshot.provider.length > 0
    && snapshot.endpointFamily.length > 0
    && Number.isFinite(Date.parse(snapshot.observedAt))
    && (snapshot.validUntil === null || Number.isFinite(Date.parse(snapshot.validUntil)))
    && (snapshot.circuit.updatedAt === null || Number.isFinite(Date.parse(snapshot.circuit.updatedAt)))
    && (snapshot.circuit.nextProbeAt === null || Number.isFinite(Date.parse(snapshot.circuit.nextProbeAt)))
    && (snapshot.circuit.probeLeaseExpiresAt === null || Number.isFinite(Date.parse(snapshot.circuit.probeLeaseExpiresAt)));
}

function nonNegativeInteger(value: number | null): value is number {
  return value !== null && Number.isSafeInteger(value) && value >= 0;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  throw new TypeError("Replay provider-policy snapshot is not canonicalizable");
}
