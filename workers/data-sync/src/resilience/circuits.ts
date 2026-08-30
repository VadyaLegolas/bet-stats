import { ConsecutiveBreaker, circuitBreaker, handleWhen, type CircuitBreakerPolicy } from "cockatiel";

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
