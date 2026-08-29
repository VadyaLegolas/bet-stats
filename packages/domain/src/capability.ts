export interface CapabilityKey {
  provider: string;
  leagueId: string;
  seasonId: string;
  endpoint: string;
}

export interface ProviderCapability extends CapabilityKey {
  supported: boolean;
  verifiedAt: Date;
  expiresAt: Date | null;
}

export type CapabilityDecision =
  | { allowed: true }
  | { allowed: false; reason: "UNKNOWN_CAPABILITY" | "UNSUPPORTED_CAPABILITY" | "EXPIRED_CAPABILITY" | "CAPABILITY_MISMATCH" };

export function evaluateCapability(capability: ProviderCapability | undefined, expected: CapabilityKey, now = new Date()): CapabilityDecision {
  if (!capability) return { allowed: false, reason: "UNKNOWN_CAPABILITY" };
  if (capability.provider !== expected.provider || capability.leagueId !== expected.leagueId || capability.seasonId !== expected.seasonId || capability.endpoint !== expected.endpoint) {
    return { allowed: false, reason: "CAPABILITY_MISMATCH" };
  }
  if (!capability.supported) return { allowed: false, reason: "UNSUPPORTED_CAPABILITY" };
  if (capability.expiresAt && capability.expiresAt.getTime() <= now.getTime()) return { allowed: false, reason: "EXPIRED_CAPABILITY" };
  return { allowed: true };
}
