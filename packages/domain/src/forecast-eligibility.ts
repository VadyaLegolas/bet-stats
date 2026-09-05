export type CanonicalIdentityState = "RESOLVED" | "UNRESOLVED";

export function forecastEligibility(state: CanonicalIdentityState): { eligible: true } | { eligible: false; reason: "UNRESOLVED_CANONICAL_IDENTITY" } {
  return state === "RESOLVED" ? { eligible: true } : { eligible: false, reason: "UNRESOLVED_CANONICAL_IDENTITY" };
}
