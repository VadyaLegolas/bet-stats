import {
  REPLAY_PROVIDER_POLICY_VERSION,
  type ReplayProviderPolicyDenialReason,
  type ReplayProviderPolicySnapshot,
  type RequestPriorityLane,
} from "@bet-stats/domain";

import type { PrismaClient } from "./client.js";

export interface ReplayProviderPolicyConfig {
  readonly provider: string;
  readonly endpointFamily: string;
  readonly lane: RequestPriorityLane;
  readonly configuredAllowance: number;
  readonly criticalHeadroom: number;
  readonly resetTimezone: string;
}

export interface ReplayProviderPolicyRepository {
  read(provider: string, endpointFamily: string): Promise<ReplayProviderPolicySnapshot>;
}

export function createReplayProviderPolicyRepository(options: {
  database: PrismaClient;
  policies: readonly ReplayProviderPolicyConfig[];
  now?: () => Date;
  circuitFreshnessMs?: number;
}): ReplayProviderPolicyRepository {
  const now = options.now ?? (() => new Date());
  const circuitFreshnessMs = options.circuitFreshnessMs ?? 5 * 60_000;

  return {
    async read(provider, endpointFamily) {
      const observedAt = now();
      const config = options.policies.find((policy) => policy.provider === provider && policy.endpointFamily === endpointFamily);
      if (!config) return unavailableSnapshot(provider, endpointFamily, observedAt, "MISSING_POLICY");
      if (!validConfig(config) || !Number.isSafeInteger(circuitFreshnessMs) || circuitFreshnessMs <= 0) {
        return unavailableSnapshot(provider, endpointFamily, observedAt, "MALFORMED_POLICY");
      }

      let resetDate: string;
      try {
        resetDate = dateInTimezone(observedAt, config.resetTimezone);
      } catch {
        return configuredUnavailableSnapshot(config, observedAt, "UNKNOWN_RESET_SEMANTICS");
      }

      const [circuit, reserved] = await Promise.all([
        options.database.providerCircuitState.findUnique({
          where: { provider_endpointFamily: { provider, endpointFamily } },
          select: { state: true, updatedAt: true, nextProbeAt: true, probeLeaseExpiresAt: true },
        }),
        options.database.providerRequestReservation.count({
          where: { provider, requestDate: new Date(`${resetDate}T00:00:00.000Z`) },
        }),
      ]);
      if (!circuit) {
        return quotaSnapshot(config, observedAt, resetDate, reserved, null, null, "MISSING_CIRCUIT_STATE");
      }

      const validUntil = new Date(circuit.updatedAt.getTime() + circuitFreshnessMs);
      const blockedReason = validUntil <= observedAt ? "STALE_CIRCUIT_STATE" : null;
      return quotaSnapshot(config, observedAt, resetDate, reserved, circuit, validUntil, blockedReason);
    },
  };
}

function quotaSnapshot(
  config: ReplayProviderPolicyConfig,
  observedAt: Date,
  resetDate: string,
  reserved: number,
  circuit: { state: "CLOSED" | "OPEN" | "HALF_OPEN"; updatedAt: Date; nextProbeAt: Date | null; probeLeaseExpiresAt: Date | null } | null,
  validUntil: Date | null,
  blockedReason: ReplayProviderPolicyDenialReason | null,
): ReplayProviderPolicySnapshot {
  const remaining = Math.max(0, config.configuredAllowance - reserved);
  const laneCapacity = config.lane === "critical"
    ? config.configuredAllowance
    : Math.max(0, config.configuredAllowance - config.criticalHeadroom);
  return {
    version: REPLAY_PROVIDER_POLICY_VERSION,
    provider: config.provider,
    endpointFamily: config.endpointFamily,
    lane: config.lane,
    resetDate,
    resetTimezone: config.resetTimezone,
    configuredAllowance: config.configuredAllowance,
    criticalHeadroom: config.criticalHeadroom,
    reserved,
    remaining,
    availableForLane: Math.max(0, laneCapacity - reserved),
    circuit: {
      state: circuit?.state ?? null,
      updatedAt: circuit?.updatedAt.toISOString() ?? null,
      nextProbeAt: circuit?.nextProbeAt?.toISOString() ?? null,
      probeLeaseExpiresAt: circuit?.probeLeaseExpiresAt?.toISOString() ?? null,
    },
    observedAt: observedAt.toISOString(),
    validUntil: validUntil?.toISOString() ?? null,
    blockedReason,
  };
}

function configuredUnavailableSnapshot(
  config: ReplayProviderPolicyConfig,
  observedAt: Date,
  blockedReason: ReplayProviderPolicyDenialReason,
): ReplayProviderPolicySnapshot {
  return {
    ...unavailableSnapshot(config.provider, config.endpointFamily, observedAt, blockedReason),
    lane: config.lane,
    resetTimezone: config.resetTimezone,
    configuredAllowance: Number.isSafeInteger(config.configuredAllowance) && config.configuredAllowance >= 0 ? config.configuredAllowance : null,
    criticalHeadroom: Number.isSafeInteger(config.criticalHeadroom) && config.criticalHeadroom >= 0 ? config.criticalHeadroom : null,
  };
}

function unavailableSnapshot(
  provider: string,
  endpointFamily: string,
  observedAt: Date,
  blockedReason: ReplayProviderPolicyDenialReason,
): ReplayProviderPolicySnapshot {
  return {
    version: REPLAY_PROVIDER_POLICY_VERSION,
    provider,
    endpointFamily,
    lane: null,
    resetDate: null,
    resetTimezone: null,
    configuredAllowance: null,
    criticalHeadroom: null,
    reserved: null,
    remaining: null,
    availableForLane: null,
    circuit: { state: null, updatedAt: null, nextProbeAt: null, probeLeaseExpiresAt: null },
    observedAt: observedAt.toISOString(),
    validUntil: null,
    blockedReason,
  };
}

function validConfig(config: ReplayProviderPolicyConfig): boolean {
  return config.provider.length > 0
    && config.endpointFamily.length > 0
    && ["critical", "standard", "optional"].includes(config.lane)
    && Number.isSafeInteger(config.configuredAllowance)
    && config.configuredAllowance >= 0
    && Number.isSafeInteger(config.criticalHeadroom)
    && config.criticalHeadroom >= 0
    && config.criticalHeadroom <= config.configuredAllowance
    && config.resetTimezone.length > 0;
}

function dateInTimezone(instant: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) throw new RangeError("Provider reset timezone is unavailable");
  return `${year}-${month}-${day}`;
}
