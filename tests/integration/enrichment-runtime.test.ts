import { describe, expect, it, vi } from "vitest";
import { createEnrichmentWorker, createEnrichmentSchedule } from "../../workers/data-sync/src/queues/index.js";

describe("production enrichment worker", () => {
  it("registers the optional worker and closes it without leaking handles", async () => {
    const close = vi.fn(async () => undefined), execute = vi.fn(async () => ({ status: "completed" }));
    const factory = vi.fn((_queue: string, processor: (job: any) => Promise<unknown>, options: any) => ({ close, processor, options }));
    const worker = createEnrichmentWorker({ redisUrl: "redis://localhost:6379", prefix: "test", execute, workerFactory: factory as any });
    await (worker as any).processor({ data: { fixtureId: "fixture-1", endpoint: "LINEUPS", cutoff: "2026-09-12T17:00:00.000Z", policyVersion: "enrichment-v1" } });
    expect(factory).toHaveBeenCalledWith("test-sync-optional", expect.any(Function), expect.objectContaining({ concurrency: 1 }));
    expect(execute).toHaveBeenCalledOnce(); await worker.close(); expect(close).toHaveBeenCalledOnce();
  });

  it("creates all deterministic jobs for successful fixture publication", () => {
    expect(createEnrichmentSchedule({ fixtureId: "fixture-1", kickoffUtc: "2026-09-12T18:00:00.000Z", policyVersion: "enrichment-v1" })).toHaveLength(4);
  });
});
