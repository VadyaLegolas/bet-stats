import { describe, expect, it, vi } from "vitest";

import { runGatedIngestion } from "../../workers/data-sync/src/ingestion/runner.js";

async function resiliencePolicy(): Promise<Record<string, unknown>> {
  try {
    return await import(/* @vite-ignore */ new URL("../../workers/data-sync/src/resilience/provider-policy.js", import.meta.url).href);
  } catch (error) {
    throw new Error("Missing Phase 2 production symbol: executeProviderCall in workers/data-sync/src/resilience/provider-policy.ts", { cause: error });
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
});
