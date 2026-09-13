import { describe, expect, it, vi } from "vitest";
import { createEnrichmentWorker, createEnrichmentSchedule } from "../../workers/data-sync/src/queues/index.js";
import { schedulePublishedFixtures } from "../../workers/data-sync/src/jobs/fixtures.js";

describe("production enrichment worker", () => {
  it("registers the optional worker and closes it without leaking handles", async () => {
    const close = vi.fn(async () => undefined), execute = vi.fn(async () => ({ status: "completed" }));
    const factory = vi.fn();
    class FakeWorker { close = close; processor: (job: any) => Promise<unknown>; options: any; constructor(queue: string, processor: (job: any) => Promise<unknown>, options: any) { factory(queue, processor, options); this.processor = processor; this.options = options; } }
    const worker = createEnrichmentWorker({ redisUrl: "redis://localhost:6379", prefix: "test", execute, workerFactory: FakeWorker as any });
    await (worker as any).processor({ data: { fixtureId: "fixture-1", endpoint: "LINEUPS", cutoff: "2026-09-12T17:00:00.000Z", policyVersion: "enrichment-v1" } });
    expect(factory).toHaveBeenCalledWith("test-sync-optional", expect.any(Function), expect.objectContaining({ concurrency: 1 }));
    expect(execute).toHaveBeenCalledOnce(); await worker.close(); expect(close).toHaveBeenCalledOnce();
  });

  it("schedules each published fixture once through deterministic job identities", async () => {
    const enqueue = vi.fn(async () => undefined);
    await schedulePublishedFixtures([{ fixtureId: "fixture-1", kickoffUtc: "2026-09-12T18:00:00.000Z" }, { fixtureId: "fixture-1", kickoffUtc: "2026-09-12T18:00:00.000Z" }], enqueue);
    expect(enqueue).toHaveBeenCalledTimes(4);
  });

  it("creates all deterministic jobs for successful fixture publication", () => {
    expect(createEnrichmentSchedule({ fixtureId: "fixture-1", kickoffUtc: "2026-09-12T18:00:00.000Z", policyVersion: "enrichment-v1" })).toHaveLength(4);
  });
});
