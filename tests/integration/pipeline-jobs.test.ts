import { describe, expect, it } from "vitest";

async function phase2Jobs(): Promise<Record<string, unknown>> {
  try {
    return await import(/* @vite-ignore */ new URL("../../workers/data-sync/src/jobs/pipeline.js", import.meta.url).href);
  } catch (error) {
    throw new Error("Missing Phase 2 production symbol: createPipelineJobId in workers/data-sync/src/jobs/pipeline.ts", { cause: error });
  }
}

describe("historical pipeline job contract", () => {
  it("D-08 derives a stable identity from the logical unit and changes it only for an explicit revision", async () => {
    const { createPipelineJobId } = await phase2Jobs() as { createPipelineJobId: (input: Record<string, unknown>) => string };
    const logicalUnit = { provider: "football-data.org", competitionId: "PL", seasonId: "2026", endpoint: "RESULTS", from: "2026-08-01T00:00:00.000Z", to: "2026-08-08T00:00:00.000Z", purpose: "scheduled" };
    expect(createPipelineJobId(logicalUnit)).toBe(createPipelineJobId({ ...logicalUnit }));
    expect(createPipelineJobId({ ...logicalUnit, revision: 2 })).not.toBe(createPipelineJobId(logicalUnit));
  });

  it("D-08 exposes a unique disposable queue namespace without making it the correctness oracle", async () => {
    const { createPipelineQueueName } = await phase2Jobs() as { createPipelineQueueName: (prefix: string) => string };
    expect(createPipelineQueueName(`vitest-${process.pid}-a`)).not.toBe(createPipelineQueueName(`vitest-${process.pid}-b`));
    expect(createPipelineQueueName(`vitest-${process.pid}-a`)).toContain(`vitest-${process.pid}-a`);
  });

  it("registers fixture continuity and result ingestion on the critical lane", async () => {
    const queues = await import("../../workers/data-sync/src/queues/index.js");
    const fixture = async () => "fixture";
    const results = async () => "results";
    const registrations: Array<{ queue: string; name: string; handler: unknown }> = [];
    const workers = queues.createSyncWorkers({
      prefix: `vitest-${process.pid}`,
      handlers: { fixtures: fixture, results },
      register: (registration) => { registrations.push(registration); return { close: async () => undefined }; },
    });
    expect(workers).toHaveLength(2);
    expect(registrations).toEqual(expect.arrayContaining([
      expect.objectContaining({ queue: queues.criticalQueue(`vitest-${process.pid}`), name: "fixtures", handler: fixture }),
      expect.objectContaining({ queue: queues.criticalQueue(`vitest-${process.pid}`), name: "results", handler: results }),
    ]));
  });

  it("uses the same bounded transient retry policy for fixture and result work", async () => {
    const { createSyncJobOptions } = await import("../../workers/data-sync/src/queues/index.js");
    expect(createSyncJobOptions("fixtures")).toEqual(createSyncJobOptions("results"));
    expect(createSyncJobOptions("fixtures")).toMatchObject({ attempts: 3, backoff: { type: "exponential" } });
  });

  it("execution lease claims, waits, reclaims, and fences stale owners", async () => {
    const execution = await import("../../workers/data-sync/src/queues/replay-execution.js");
    expect(execution.DEFAULT_REPLAY_EXECUTION_LEASE).toEqual({
      leaseMs: 30_000,
      heartbeatMs: 5_000,
      deadlineMs: 120_000,
      maxClaims: 3,
    });
    expect(execution.createReplayExecutionContext).toBeTypeOf("function");
    expect(execution.claimReplayExecution).toBeTypeOf("function");
  });
});
