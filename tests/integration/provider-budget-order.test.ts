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
});
