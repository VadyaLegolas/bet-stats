import { randomUUID } from "node:crypto";

import { ConsecutiveBreaker, circuitBreaker, handleWhen, type CircuitBreakerPolicy } from "cockatiel";

import type { PrismaClient } from "@bet-stats/database";

import type { CircuitProbeRegistry } from "../ingestion/runner.js";

export type CircuitProjectionState = "CLOSED" | "OPEN" | "HALF_OPEN";
export interface CircuitProjection { provider: string; endpointFamily: string; state: CircuitProjectionState }

export class ProviderCircuitRegistry {
  readonly #policies = new Map<string, CircuitBreakerPolicy>();
  readonly #states = new Map<string, CircuitProjectionState>();
  readonly #halfOpenProbes = new Set<string>();
  readonly #project: ((projection: CircuitProjection) => void | Promise<void>) | undefined;

  constructor(project?: (projection: CircuitProjection) => void | Promise<void>) { this.#project = project; }

  get(provider: string, endpointFamily: string): CircuitBreakerPolicy {
    const key = this.key(provider, endpointFamily);
    const existing = this.#policies.get(key);
    if (existing) return existing;
    const policy = circuitBreaker(handleWhen(() => true), { halfOpenAfter: 30_000, breaker: new ConsecutiveBreaker(3) });
    policy.onBreak(() => { void this.set(provider, endpointFamily, "OPEN"); });
    policy.onHalfOpen(() => { void this.set(provider, endpointFamily, "HALF_OPEN"); });
    policy.onReset(() => { this.#halfOpenProbes.delete(key); void this.set(provider, endpointFamily, "CLOSED"); });
    this.#states.set(key, "CLOSED");
    this.#policies.set(key, policy);
    return policy;
  }

  state(provider: string, endpointFamily: string): CircuitProjectionState { return this.#states.get(this.key(provider, endpointFamily)) ?? "CLOSED"; }
  acquireProbe(provider: string, endpointFamily: string): boolean {
    const key = this.key(provider, endpointFamily);
    if (this.state(provider, endpointFamily) !== "HALF_OPEN") return true;
    if (this.#halfOpenProbes.has(key)) return false;
    this.#halfOpenProbes.add(key);
    return true;
  }
  releaseProbe(provider: string, endpointFamily: string): void { this.#halfOpenProbes.delete(this.key(provider, endpointFamily)); }
  private key(provider: string, endpointFamily: string): string { return `${provider}:${endpointFamily}`; }
  private async set(provider: string, endpointFamily: string, state: CircuitProjectionState): Promise<void> {
    this.#states.set(this.key(provider, endpointFamily), state);
    await this.#project?.({ provider, endpointFamily, state });
  }
}

/**
 * PostgreSQL-backed ownership for the single probe permitted while a provider
 * circuit is HALF_OPEN. A process keeps only its own random token locally;
 * PostgreSQL remains the source of truth for competing Worker processes.
 */
class DurableProviderCircuitRegistry implements CircuitProbeRegistry {
  readonly #tokens = new Map<string, string>();
  readonly #now: () => Date;
  readonly #leaseMs: number;

  constructor(private readonly database: PrismaClient, options: { now?: () => Date; leaseMs?: number } = {}) {
    this.#now = options.now ?? (() => new Date());
    this.#leaseMs = options.leaseMs ?? 30_000;
  }

  async state(provider: string, endpointFamily: string): Promise<CircuitProjectionState> {
    const circuit = await this.database.providerCircuitState.findUnique({
      where: { provider_endpointFamily: { provider, endpointFamily } },
      select: { state: true },
    });
    return circuit?.state ?? "OPEN";
  }

  async acquireProbe(provider: string, endpointFamily: string): Promise<boolean> {
    const now = this.#now();
    const token = randomUUID();
    const update = await this.database.providerCircuitState.updateMany({
      where: {
        provider,
        endpointFamily,
        state: "HALF_OPEN",
        OR: [
          { probeLeaseToken: null },
          { probeLeaseExpiresAt: null },
          { probeLeaseExpiresAt: { lte: now } },
        ],
      },
      data: { probeLeaseToken: token, probeLeaseExpiresAt: new Date(now.getTime() + this.#leaseMs) },
    });
    if (update.count !== 1) return false;
    this.#tokens.set(this.key(provider, endpointFamily), token);
    return true;
  }

  async releaseProbe(provider: string, endpointFamily: string): Promise<void> {
    const key = this.key(provider, endpointFamily);
    const token = this.#tokens.get(key);
    if (!token) return;
    this.#tokens.delete(key);
    await this.database.providerCircuitState.updateMany({
      where: { provider, endpointFamily, probeLeaseToken: token },
      data: { probeLeaseToken: null, probeLeaseExpiresAt: null },
    });
  }

  private key(provider: string, endpointFamily: string): string { return `${provider}:${endpointFamily}`; }
}

export function createDurableProviderCircuitRegistry(input: {
  database: PrismaClient;
  now?: () => Date;
  leaseMs?: number;
}): CircuitProbeRegistry {
  return new DurableProviderCircuitRegistry(input.database, input);
}
