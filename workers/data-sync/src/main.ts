import { dependencyReadiness, readServerConfig } from "@bet-stats/config";

export { createSyncWorkers } from "./queues/index.js";

export function createWorkerReadiness(state: { postgres: boolean; redis: boolean }) {
  return dependencyReadiness(state);
}

function start(): void {
  readServerConfig(process.env);
  const readiness = createWorkerReadiness({
    postgres: process.env.POSTGRES_READY === "true",
    redis: process.env.REDIS_READY === "true",
  });
  console.info(JSON.stringify({ event: "worker.initialized", readiness }));
}

try {
  start();
} catch {
  console.error("Data-sync worker configuration is invalid");
  process.exitCode = 1;
}
