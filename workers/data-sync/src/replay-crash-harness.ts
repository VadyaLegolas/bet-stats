import { createPrismaClient } from "@bet-stats/database";
import { createReplayWorker } from "./queues/index.js";

const databaseUrl = process.env.REPLAY_CRASH_DATABASE_URL;
const redisUrl = process.env.REPLAY_CRASH_REDIS_URL;
const prefix = process.env.REPLAY_CRASH_PREFIX;
const mode = process.env.REPLAY_CRASH_MODE;

if (!databaseUrl || !redisUrl || !prefix || !/^vitest-[a-z0-9-]+$/i.test(prefix)) {
  throw new Error("Replay crash harness requires isolated allowlisted test configuration");
}

const database = createPrismaClient(databaseUrl);
const worker = createReplayWorker({
  database,
  redisUrl,
  prefix,
  executionLease: { leaseMs: 2_000, heartbeatMs: 250, deadlineMs: 8_000 },
  lockDuration: 1_000,
  stalledInterval: 500,
  execute: async (job, context) => {
    process.send?.({ event: "claimed-before-provider", syncRunId: job.syncRunId, attemptNumber: context.attemptNumber });
    if (mode === "hold-after-claim") await new Promise(() => undefined);
    await context.assertOwner();
    process.send?.({ event: "before-provider-dispatch" });
    await context.publish(async () => undefined, {
      expectedUnits: [job.logicalId], completedUnits: [job.logicalId],
      expectedCaptures: [job.logicalId], completedCaptures: [job.logicalId], delivery: "DELIVERED",
    });
    process.send?.({ event: "published-before-ack" });
  },
});

const close = async () => {
  await worker.close();
  await database.$disconnect();
  process.exit(0);
};
process.once("SIGTERM", () => { void close(); });
process.once("SIGINT", () => { void close(); });
