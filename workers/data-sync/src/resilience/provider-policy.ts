import type { PrismaClient, ReplayProviderPolicyRepository } from "@bet-stats/database";
import {
  evaluateReplayProviderPolicy,
  fingerprintReplayProviderPolicy,
  verifyPersistedReplayProviderPolicyFingerprint,
  type ReplayProviderPolicySnapshot,
} from "@bet-stats/domain";

import { classifyProviderError } from "./errors.js";

export function evaluateProviderCache(input: { expiresAt: string; now: string }) {
  return { hit: new Date(input.expiresAt).getTime() > new Date(input.now).getTime(), requiresReservation: false, authoritative: false };
}

export async function executeProviderCall(input: {
  provider: string;
  endpointFamily: string;
  circuitState?: "CLOSED" | "OPEN" | "HALF_OPEN";
  reserve?: () => Promise<unknown>;
  call: () => Promise<unknown>;
  attemptsMade?: number;
  maxAttempts?: number;
  correlationId: string;
}) {
  const circuit = { provider: input.provider, endpointFamily: input.endpointFamily };
  if (input.circuitState === "OPEN") return { status: "blocked", reason: "CIRCUIT_OPEN", circuit } as const;
  await input.reserve?.();
  const attempt = (input.attemptsMade ?? 0) + 1;
  try {
    const value = await input.call();
    return { status: "completed", attempts: attempt, value, correlationId: input.correlationId, circuit } as const;
  } catch (error) {
    const classification = classifyProviderError(error);
    const history = [{ attempt, reason: classification.reason }];
    if (!classification.retryable) return { status: "failed", attempts: attempt, reason: classification.reason, correlationId: input.correlationId, history, circuit } as const;
    if (attempt >= (input.maxAttempts ?? 3)) return { status: "dead-letter", attempts: attempt, reason: classification.reason, correlationId: input.correlationId, history, circuit } as const;
    return { status: "retry", attempts: attempt, reason: classification.reason, correlationId: input.correlationId, history, circuit } as const;
  }
}

export interface ReplayWorkerProviderPolicy {
  readonly snapshot: ReplayProviderPolicySnapshot;
  readonly fingerprint: string;
}

/** Re-read and validate the snapshot persisted by API preview before Worker I/O. */
export async function readReplayWorkerProviderPolicy(input: {
  database: PrismaClient;
  providerPolicyRepository: ReplayProviderPolicyRepository;
  replayPlanId: string;
  provider: string;
  endpointFamily: string;
  now?: () => Date;
}): Promise<ReplayWorkerProviderPolicy> {
  const planRows = await input.database.$queryRawUnsafe<Array<{ impact: unknown; providerPolicyFingerprint: string }>>(
    `SELECT v.impact,v."providerPolicyFingerprint"
     FROM "ReplayPlan" p JOIN "ReplayPreview" v ON v.id=p."previewId"
     WHERE p.id=$1 AND p.provider=$2 AND p."endpointFamily"=$3`,
    input.replayPlanId,
    input.provider,
    input.endpointFamily,
  );
  const approved = planRows[0];
  if (!approved || !isPersistedSnapshot(approved.impact)) throw policyError("MALFORMED_POLICY");
  const approvedSnapshot = approved.impact.providerPolicy;
  const approvedIdentity = verifyPersistedReplayProviderPolicyFingerprint(approvedSnapshot, approved.providerPolicyFingerprint);
  if (!approvedIdentity) throw policyError("MALFORMED_POLICY");

  let snapshot: ReplayProviderPolicySnapshot;
  try {
    snapshot = await input.providerPolicyRepository.read(input.provider, input.endpointFamily);
  } catch {
    throw policyError("MALFORMED_POLICY");
  }
  const fingerprint = fingerprintReplayProviderPolicy(snapshot);
  if (fingerprint !== approvedIdentity) throw policyError("REPLAY_POLICY_CHANGED");
  const decision = evaluateReplayProviderPolicy(snapshot, 1, input.now?.() ?? new Date());
  if (!decision.allowed) throw policyError(decision.reason);
  return { snapshot, fingerprint };
}

function isPersistedSnapshot(impact: unknown): impact is { providerPolicy: ReplayProviderPolicySnapshot } {
  if (!impact || typeof impact !== "object" || !("providerPolicy" in impact)) return false;
  const snapshot = (impact as { providerPolicy?: unknown }).providerPolicy;
  return !!snapshot && typeof snapshot === "object"
    && (snapshot as { version?: unknown }).version === "replay-provider-policy/v1"
    && typeof (snapshot as { provider?: unknown }).provider === "string"
    && typeof (snapshot as { endpointFamily?: unknown }).endpointFamily === "string";
}

function policyError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}
