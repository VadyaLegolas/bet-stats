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
});
