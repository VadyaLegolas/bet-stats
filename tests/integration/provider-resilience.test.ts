import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { evaluateReplayProviderPolicy, fingerprintReplayProviderPolicy, projectReplayProviderPolicyIdentity, verifyPersistedReplayProviderPolicyFingerprint, type ReplayProviderPolicySnapshot } from "@bet-stats/domain";
import type { PrismaClient } from "@bet-stats/database";
import { readReplayWorkerProviderPolicy } from "../../workers/data-sync/src/resilience/provider-policy.js";

import { runGatedIngestion } from "../../workers/data-sync/src/ingestion/runner.js";

const now = new Date("2026-09-05T12:00:00Z");
function snapshot(): ReplayProviderPolicySnapshot {
  return { version: "replay-provider-policy/v1", provider: "football-data.org", endpointFamily: "RESULTS", lane: "critical", resetTimezone: "UTC", configuredAllowance: 10, criticalHeadroom: 3, resetDate: "2026-09-05", reserved: 0, remaining: 10, availableForLane: 10, circuit: { state: "CLOSED", updatedAt: now.toISOString(), nextProbeAt: null, probeLeaseExpiresAt: null }, observedAt: now.toISOString(), validUntil: "2026-09-05T12:05:00Z", blockedReason: null };
}
function legacyHash(value: ReplayProviderPolicySnapshot): string {
  const { observedAt: _ignored, ...legacy } = value;
  function canonical(value: unknown): string {
    if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k,v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
    return JSON.stringify(value);
  }
  return createHash("sha256").update(canonical(legacy)).digest("hex");
}

describe("replay policy identity boundary", () => {
  const stable = { version: "replay-provider-policy/v2", provider: "other", endpointFamily: "STANDINGS", lane: "standard", configuredAllowance: 9, criticalHeadroom: 2, resetTimezone: "Europe/Warsaw" };
  const volatile = { resetDate: "2026-09-06", reserved: 1, remaining: 9, availableForLane: 9, circuit: { ...snapshot().circuit, state: "OPEN" }, observedAt: "2026-09-05T12:01:00Z", validUntil: "2026-09-05T12:06:00Z", blockedReason: "CRITICAL_HEADROOM" };
  it("classifies every snapshot field explicitly", () => {
    expect([...Object.keys(stable), ...Object.keys(volatile)].sort()).toEqual(Object.keys(snapshot()).sort());
    expect(Object.keys(projectReplayProviderPolicyIdentity(snapshot())).sort()).toEqual(Object.keys(stable).sort());
  });
  it.each(Object.entries(stable))("invalidates configured %s before provider construction", async (field, value) => {
    const approved = snapshot(); const changed = { ...approved, [field]: value } as ReplayProviderPolicySnapshot;
    expect(fingerprintReplayProviderPolicy(changed)).not.toBe(fingerprintReplayProviderPolicy(approved));
    const database = { $queryRawUnsafe: async () => [{ impact: { providerPolicy: approved }, providerPolicyFingerprint: fingerprintReplayProviderPolicy(approved) }] } as unknown as PrismaClient;
    const construct = vi.fn();
    await expect(readReplayWorkerProviderPolicy({ database, replayPlanId: "plan", provider: approved.provider, endpointFamily: approved.endpointFamily, providerPolicyRepository: { read: async () => changed }, now: () => now }).then(construct)).rejects.toMatchObject({ code: "REPLAY_POLICY_CHANGED" });
    expect(construct).not.toHaveBeenCalled();
  });
  it.each(Object.entries(volatile))("excludes observed %s from identity", (field, value) => {
    expect(fingerprintReplayProviderPolicy({ ...snapshot(), [field]: value } as ReplayProviderPolicySnapshot)).toBe(fingerprintReplayProviderPolicy(snapshot()));
  });
  it("verifies both immutable hash versions with canonical property order", () => {
    const value = snapshot(); const reversed = Object.fromEntries(Object.entries(value).reverse()) as unknown as ReplayProviderPolicySnapshot;
    const identity = fingerprintReplayProviderPolicy(value);
    expect(identity).toMatch(/^identity-v2:[a-f0-9]{64}$/);
    expect(fingerprintReplayProviderPolicy(reversed)).toBe(identity);
    expect(verifyPersistedReplayProviderPolicyFingerprint(reversed, legacyHash(value))).toBe(identity);
    expect(verifyPersistedReplayProviderPolicyFingerprint(reversed, identity)).toBe(identity);
    for (const hash of ["identity-v3:" + identity.split(":")[1], "0".repeat(64), identity.slice(0,-1), "unknown"]) expect(verifyPersistedReplayProviderPolicyFingerprint(value, hash)).toBeNull();
    expect(verifyPersistedReplayProviderPolicyFingerprint({ ...value, reserved: 1 }, legacyHash(value))).toBeNull();
  });
  it.each([
    { lane: "admin" }, { criticalHeadroom: 11 }, { configuredAllowance: -1 }, { provider: null },
    { remaining: 100 }, { availableForLane: 100 }, { circuit: null }, { blockedReason: "ALLOW" },
  ])("fails closed for malformed identity/observation %j", (changed) => {
    expect(evaluateReplayProviderPolicy({ ...snapshot(), ...changed } as unknown as ReplayProviderPolicySnapshot, 1, now)).toEqual({ allowed: false, reason: "MALFORMED_POLICY" });
  });
  it.each([
    [{ circuit: { ...snapshot().circuit, state: "OPEN" } }, "CIRCUIT_OPEN"],
    [{ circuit: { ...snapshot().circuit, state: "HALF_OPEN" } }, "CIRCUIT_HALF_OPEN"],
    [{ circuit: { ...snapshot().circuit, state: null } }, "MISSING_CIRCUIT_STATE"],
    [{ validUntil: "2026-09-05T11:59:00Z" }, "STALE_CIRCUIT_STATE"],
    [{ reserved: 10, remaining: 0, availableForLane: 0 }, "ALLOWANCE_EXHAUSTED"],
    [{ blockedReason: "CRITICAL_HEADROOM" }, "CRITICAL_HEADROOM"],
  ])("enforces live denial %j with zero construction", async (change, reason) => {
    const approved = snapshot(); const changed = { ...approved, ...change as object } as ReplayProviderPolicySnapshot;
    const database = { $queryRawUnsafe: async () => [{ impact: { providerPolicy: approved }, providerPolicyFingerprint: legacyHash(approved) }] } as unknown as PrismaClient;
    const construct = vi.fn();
    await expect(readReplayWorkerProviderPolicy({ database, replayPlanId: "plan", provider: approved.provider, endpointFamily: approved.endpointFamily, providerPolicyRepository: { read: async () => changed }, now: () => now }).then(construct)).rejects.toMatchObject({ code: reason });
    expect(construct).not.toHaveBeenCalled();
  });
});

async function resiliencePolicy(): Promise<Record<string, unknown>> {
  try {
    return await import(/* @vite-ignore */ new URL("../../workers/data-sync/src/resilience/provider-policy.js", import.meta.url).href);
  } catch (error) {
    throw new Error("Missing Phase 2 production symbol: executeProviderCall in workers/data-sync/src/resilience/provider-policy.ts", { cause: error });
  }
}

async function durableCircuits(): Promise<Record<string, unknown>> {
  try {
    return await import(/* @vite-ignore */ new URL("../../workers/data-sync/src/resilience/circuits.js", import.meta.url).href);
  } catch (error) {
    throw new Error("Missing Phase 2 durable ProviderCircuitRegistry in workers/data-sync/src/resilience/circuits.ts", { cause: error });
  }
}

describe("provider resilience policy", () => {
  it("D-12 classifies terminal failures and leaves transient retries to BullMQ", async () => {
    const { executeProviderCall } = await resiliencePolicy() as { executeProviderCall: (input: Record<string, unknown>) => Promise<Record<string, unknown>> };
    const validationCall = vi.fn().mockRejectedValue({ kind: "VALIDATION", message: "invalid payload" });
    const immediate = executeProviderCall({ provider: "football-data.org", endpointFamily: "RESULTS", call: validationCall, attemptsMade: 0, maxAttempts: 3, correlationId: "corr-validation" });
    await expect(immediate).resolves.toMatchObject({ status: "failed", attempts: 1, reason: "VALIDATION" });
    const transientCall = vi.fn().mockRejectedValue({ kind: "TIMEOUT", message: "secret-token-must-not-escape" });
    const retryable = executeProviderCall({ provider: "football-data.org", endpointFamily: "RESULTS", call: transientCall, attemptsMade: 0, maxAttempts: 3, correlationId: "corr-timeout" });
    await expect(retryable).resolves.toMatchObject({ status: "retry", attempts: 1, correlationId: "corr-timeout", reason: "TIMEOUT" });
    expect(transientCall).toHaveBeenCalledTimes(1);
    const exhausted = executeProviderCall({ provider: "football-data.org", endpointFamily: "RESULTS", call: transientCall, attemptsMade: 2, maxAttempts: 3, correlationId: "corr-timeout" });
    await expect(exhausted).resolves.toMatchObject({ status: "dead-letter", attempts: 3, correlationId: "corr-timeout", reason: "TIMEOUT" });
    expect(JSON.stringify(await exhausted)).not.toContain("secret-token-must-not-escape");
  });

  it("D-13 scopes circuits by provider and endpoint family and blocks before reservation", async () => {
    const { executeProviderCall } = await resiliencePolicy() as { executeProviderCall: (input: Record<string, unknown>) => Promise<Record<string, unknown>> };
    const reserve = vi.fn();
    const call = vi.fn();
    const result = await executeProviderCall({ provider: "football-data.org", endpointFamily: "RESULTS", circuitState: "OPEN", reserve, call, correlationId: "corr-open" });
    expect(result).toMatchObject({ status: "blocked", reason: "CIRCUIT_OPEN", circuit: { provider: "football-data.org", endpointFamily: "RESULTS" } });
    expect(reserve).not.toHaveBeenCalled();
    expect(call).not.toHaveBeenCalled();
  });

  it("D-11 treats cache identity as an I/O optimization, never as durable historical truth", async () => {
    const { evaluateProviderCache } = await resiliencePolicy() as { evaluateProviderCache: (input: Record<string, unknown>) => Record<string, unknown> };
    expect(evaluateProviderCache({ provider: "football-data.org", capturedAt: "2026-08-29T10:00:00.000Z", expiresAt: "2026-08-29T10:05:00.000Z", payloadHash: "abc", now: "2026-08-29T10:01:00.000Z" })).toMatchObject({ hit: true, requiresReservation: false, authoritative: false });
  });

  it("allows exactly one concurrent HALF_OPEN probe before reservation and provider I/O", async () => {
    let owned = false;
    const registry = {
      state: vi.fn(() => "HALF_OPEN" as const),
      acquireProbe: vi.fn(() => owned ? false : (owned = true)),
      releaseProbe: vi.fn(() => { owned = false; }),
    };
    let releaseProvider!: () => void;
    const providerBlocked = new Promise<void>((resolve) => { releaseProvider = resolve; });
    const reserve = vi.fn(async () => ({ reserved: true }));
    const providerFactory = vi.fn(() => ({}));
    const callProvider = vi.fn(async () => { await providerBlocked; return "ok"; });
    const input = {
      provider: "football-data.org", endpoint: "RESULTS", capability: "SUPPORTED" as const,
      circuit: "HALF_OPEN" as const, circuitRegistry: registry, lane: "critical" as const,
      allowance: 10, resetTimezone: "UTC", jobKey: "probe", reserve, providerFactory, callProvider,
    };

    const owner = runGatedIngestion(input);
    await vi.waitFor(() => expect(callProvider).toHaveBeenCalledOnce());
    const deferred = await runGatedIngestion({ ...input, jobKey: "deferred" });
    expect(deferred).toEqual({ status: "denied", reason: "CIRCUIT_OPEN" });
    expect(reserve).toHaveBeenCalledTimes(1);
    expect(providerFactory).toHaveBeenCalledTimes(1);
    releaseProvider();
    await expect(owner).resolves.toMatchObject({ status: "completed" });
    expect(registry.releaseProbe).toHaveBeenCalledOnce();
  });

  it.each(["success", "classified failure", "thrown error"])("releases HALF_OPEN ownership after %s", async (outcome) => {
    const registry = {
      state: () => "HALF_OPEN" as const,
      acquireProbe: vi.fn(() => true),
      releaseProbe: vi.fn(),
    };
    const reserve = outcome === "classified failure"
      ? vi.fn(async () => ({ reserved: false, reason: "ALLOWANCE_EXHAUSTED" as const }))
      : vi.fn(async () => ({ reserved: true }));
    const execution = runGatedIngestion({
      provider: "football-data.org", endpoint: "RESULTS", capability: "SUPPORTED", circuit: "HALF_OPEN",
      circuitRegistry: registry, lane: "critical", allowance: 10, resetTimezone: "UTC", jobKey: outcome,
      reserve, providerFactory: () => ({}),
      callProvider: async () => { if (outcome === "thrown error") throw new Error("provider failed"); return "ok"; },
    });
    if (outcome === "thrown error") await expect(execution).rejects.toThrow("provider failed");
    else await execution;
    expect(registry.releaseProbe).toHaveBeenCalledOnce();
  });

  it("uses PostgreSQL-owned HALF_OPEN probe leases rather than process-local state", async () => {
    const { createDurableProviderCircuitRegistry } = await durableCircuits() as {
      createDurableProviderCircuitRegistry?: (input: { database: unknown }) => unknown;
    };
    expect(createDurableProviderCircuitRegistry).toEqual(expect.any(Function));
  });
});
