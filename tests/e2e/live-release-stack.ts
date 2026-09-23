import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { createPrismaClient, createSettlementPipelineService } from "../../packages/database/src/index.js";
import { createSettlementJobHandler } from "../../workers/data-sync/src/jobs/settlement.js";
import { createSettlementWorker } from "../../workers/data-sync/src/queues/index.js";
import { PROVIDER_API_ORIGIN, PROVIDER_WEB_ORIGIN, startLiveProviderStack, stopLiveProviderStack } from "./live-provider-stack.js";

export type LiveReleaseState = Readonly<{
  databaseUrl: string;
  redisUrl: string;
  workerPrefix: string;
  apiOrigin: string;
  webOrigin: string;
}>;

const statePath = join(tmpdir(), "bet-stats-live-release-state.json");
let releaseWorker: ReturnType<typeof createSettlementWorker> | undefined;

function assertPrerequisites(): void {
  const major = Number(process.versions.node.split(".")[0]);
  if (major !== 24) {
    throw new Error(`RELEASE_NODE_VERSION_REQUIRED: expected Node 24.x, received ${process.version}. Activate the repository Node 24 runtime before retrying.`);
  }
  try {
    execFileSync("docker", ["version", "--format", "{{.Server.Version}}"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch {
    throw new Error("RELEASE_DOCKER_REQUIRED: Docker Desktop/daemon is unavailable. Start Docker Desktop and verify `docker version` before retrying.");
  }
}

export function readLiveReleaseState(): LiveReleaseState {
  try {
    return JSON.parse(readFileSync(statePath, "utf8")) as LiveReleaseState;
  } catch {
    throw new Error("RELEASE_STACK_STATE_UNAVAILABLE: the owned release stack did not finish setup");
  }
}

/** Fail the release gate if a seeded secret crosses into browser-visible output. */
export async function assertNoReleaseCanary(page: Page, canary: string): Promise<void> {
  const body = await page.locator("body").innerText();
  const html = await page.content();
  if (body.includes(canary) || html.includes(canary)) {
    throw new Error("RELEASE_CANARY_LEAK: seeded private data reached the rendered document");
  }
}

export async function prepareReleaseFixture(fixtureId: string): Promise<void> {
  const state = readLiveReleaseState();
  const database = createPrismaClient(state.databaseUrl);
  try {
    await database.fixture.update({
      where: { id: fixtureId },
      data: { status: "SCHEDULED", kickoffUtc: new Date("2026-09-24T15:00:00.000Z") },
    });
  } finally {
    await database.$disconnect();
  }
}

async function teardown(): Promise<void> {
  try { await releaseWorker?.close(); } finally {
    releaseWorker = undefined;
    await stopLiveProviderStack();
    rmSync(statePath, { force: true });
  }
}

export default async function setup(): Promise<() => Promise<void>> {
  assertPrerequisites();
  rmSync(statePath, { force: true });
  try {
    const provider = await startLiveProviderStack();
    const workerPrefix = `p6-release-${process.pid}-${Date.now()}`;
    const database = createPrismaClient(provider.databaseUrl);
    releaseWorker = createSettlementWorker({
      redisUrl: provider.redisUrl,
      prefix: workerPrefix,
      execute: createSettlementJobHandler({ service: createSettlementPipelineService({ database }) }),
    });
    await releaseWorker.waitUntilReady();
    const state: LiveReleaseState = {
      databaseUrl: provider.databaseUrl,
      redisUrl: provider.redisUrl,
      workerPrefix,
      apiOrigin: PROVIDER_API_ORIGIN,
      webOrigin: PROVIDER_WEB_ORIGIN,
    };
    writeFileSync(statePath, JSON.stringify(state), { encoding: "utf8", mode: 0o600 });
    return teardown;
  } catch (error) {
    await teardown();
    throw error;
  }
}
