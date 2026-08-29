import { describe, expect, it, vi } from "vitest";

async function phase2ResultJob(): Promise<Record<string, unknown>> {
  try {
    return await import(/* @vite-ignore */ new URL("../../workers/data-sync/src/jobs/results.js", import.meta.url).href);
  } catch (error) {
    throw new Error("Missing Phase 2 production symbol: runResultSyncJob in workers/data-sync/src/jobs/results.ts", { cause: error });
  }
}

describe("result provider budget ordering", () => {
  it("D-09/D-10 rejects capability, circuit, and policy before construction or I/O", async () => {
    const { runResultSyncJob } = await phase2ResultJob() as { runResultSyncJob: (input: Record<string, unknown>) => Promise<Record<string, unknown>> };
    const providerFactory = vi.fn(() => ({ fetchResults: vi.fn() }));
    const result = await runResultSyncJob({ provider: "football-data.org", endpoint: "RESULTS", capability: "UNKNOWN", circuit: "OPEN", allowance: 10, jobKey: "results-pl-2026", providerFactory });
    expect(result).toMatchObject({ status: "denied" });
    expect(providerFactory).not.toHaveBeenCalled();
  });

  it("PIPE-03 reserves atomically before constructing the provider", async () => {
    const { runResultSyncJob } = await phase2ResultJob() as { runResultSyncJob: (input: Record<string, unknown>) => Promise<Record<string, unknown>> };
    const events: string[] = [];
    const reserve = vi.fn(async () => { events.push("reserved"); return { reserved: true, reused: false }; });
    const providerFactory = vi.fn(() => { events.push("constructed"); return { fetchResults: async () => { events.push("called"); return []; } }; });
    await runResultSyncJob({ provider: "football-data.org", endpoint: "RESULTS", capability: "SUPPORTED", circuit: "CLOSED", allowance: 10, jobKey: "results-pl-2026", reserve, providerFactory });
    expect(events).toEqual(["reserved", "constructed", "called"]);
  });

  it.each([
    ["capability", { capability: "UNKNOWN", circuit: "CLOSED", allowance: 10 }],
    ["circuit", { capability: "SUPPORTED", circuit: "OPEN", allowance: 10 }],
    ["zero allowance", { capability: "SUPPORTED", circuit: "CLOSED", allowance: 0 }],
    ["unknown reset", { capability: "SUPPORTED", circuit: "CLOSED", allowance: 10, resetTimezone: null }],
  ])("denies %s before reservation and provider construction", async (_case, gate) => {
    const { runResultSyncJob } = await phase2ResultJob() as { runResultSyncJob: (input: Record<string, unknown>) => Promise<Record<string, unknown>> };
    const reserve = vi.fn();
    const providerFactory = vi.fn();

    const result = await runResultSyncJob({
      provider: "football-data.org",
      endpoint: "RESULTS",
      lane: "standard",
      jobKey: `results-${_case}`,
      reserve,
      providerFactory,
      ...gate,
    });

    expect(result).toMatchObject({ status: "denied" });
    expect(reserve).not.toHaveBeenCalled();
    expect(providerFactory).not.toHaveBeenCalled();
  });

  it("returns cached evidence without reserving or constructing a provider", async () => {
    const { runResultSyncJob } = await phase2ResultJob() as { runResultSyncJob: (input: Record<string, unknown>) => Promise<Record<string, unknown>> };
    const reserve = vi.fn();
    const providerFactory = vi.fn();

    const result = await runResultSyncJob({
      provider: "football-data.org",
      endpoint: "RESULTS",
      capability: "SUPPORTED",
      circuit: "CLOSED",
      allowance: 10,
      resetTimezone: "UTC",
      lane: "critical",
      jobKey: "results-cached",
      cache: { hit: true, value: ["observation-1"] },
      reserve,
      providerFactory,
    });

    expect(result).toEqual({ status: "cached", value: ["observation-1"] });
    expect(reserve).not.toHaveBeenCalled();
    expect(providerFactory).not.toHaveBeenCalled();
  });

  it("keeps an already-authorized critical reservation valid when reset metadata later becomes unknown", async () => {
    const { runResultSyncJob } = await phase2ResultJob() as { runResultSyncJob: (input: Record<string, unknown>) => Promise<Record<string, unknown>> };
    const reserve = vi.fn(async () => ({ reserved: true, reused: true }));
    const providerFactory = vi.fn(() => ({ fetchResults: async () => [] }));

    const result = await runResultSyncJob({
      provider: "football-data.org",
      endpoint: "RESULTS",
      capability: "SUPPORTED",
      circuit: "CLOSED",
      allowance: 10,
      resetTimezone: null,
      lane: "critical",
      alreadyAuthorized: true,
      jobKey: "results-authorized",
      reserve,
      providerFactory,
    });

    expect(result).toMatchObject({ status: "completed", reservationReused: true });
    expect(providerFactory).toHaveBeenCalledOnce();
  });

  it("records observed quota without widening the configured allowance", async () => {
    const { runResultSyncJob } = await phase2ResultJob() as { runResultSyncJob: (input: Record<string, unknown>) => Promise<Record<string, unknown>> };
    const observeQuota = vi.fn();
    const reserve = vi.fn(async (request: Record<string, unknown>) => {
      expect(request).toMatchObject({ allowance: 10 });
      return { reserved: true, reused: false };
    });
    const providerFactory = vi.fn(() => ({
      fetchResults: async () => ({ data: [], quota: { allowance: 100, remaining: 99 } }),
    }));

    await runResultSyncJob({
      provider: "football-data.org",
      endpoint: "RESULTS",
      capability: "SUPPORTED",
      circuit: "CLOSED",
      allowance: 10,
      resetTimezone: "UTC",
      runtimeAllowance: 100,
      lane: "critical",
      jobKey: "results-quota",
      reserve,
      observeQuota,
      providerFactory,
    });

    expect(observeQuota).toHaveBeenCalledWith({ allowance: 100, remaining: 99 });
  });
});
