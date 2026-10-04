import { describe, expect, it, vi } from "vitest";
import { createEnrichmentQueue, createEnrichmentWorker, createEnrichmentSchedule } from "../../workers/data-sync/src/queues/index.js";
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
    const jobs = createEnrichmentSchedule({ fixtureId: "fixture-1", kickoffUtc: "2026-09-12T18:00:00.000Z", policyVersion: "enrichment-v1" });
    expect(jobs).toHaveLength(4);
    expect(jobs.every((job) => job.runAt === "2026-09-12T17:00:00.000Z")).toBe(true);
  });

  it("keeps a fixture published days early delayed until its run window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-09T12:00:00.000Z"));
    const add = vi.fn(async () => undefined), close = vi.fn(async () => undefined);
    class FakeQueue { add = add; close = close; }
    const queue = createEnrichmentQueue({ redisUrl: "redis://localhost:6379", queueFactory: FakeQueue as any });
    const [job] = createEnrichmentSchedule({ fixtureId: "fixture-1", kickoffUtc: "2026-09-12T18:00:00.000Z", policyVersion: "enrichment-v1" });
    await queue.enqueue(job!);
    expect(add).toHaveBeenCalledWith("lineups", job, expect.objectContaining({
      delay: Date.parse(job!.runAt) - Date.now(),
      jobId: expect.stringContaining("enrichment-v1-fixture-1-LINEUPS"),
    }));
    vi.useRealTimers();
  });

  it("moves a pre-cutoff empty execution back to delayed state", async () => {
    const moveToDelayed = vi.fn(async () => undefined);
    class FakeWorker { processor: (job: any) => Promise<unknown>; constructor(_queue: string, processor: (job: any) => Promise<unknown>) { this.processor = processor; } close = async () => undefined; }
    const worker = createEnrichmentWorker({
      redisUrl: "redis://localhost:6379", workerFactory: FakeWorker as any,
      execute: async () => ({ status: "reschedule", runAt: "2026-09-12T17:00:00.000Z", reason: "PRE_CUTOFF_EMPTY" }),
    });
    await expect((worker as any).processor({ data: {}, token: "token-1", moveToDelayed })).rejects.toThrow();
    expect(moveToDelayed).toHaveBeenCalledWith(Date.parse("2026-09-12T17:00:00.000Z"), "token-1");
  });
});
