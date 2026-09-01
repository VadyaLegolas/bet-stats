import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { createPrismaClient, type PrismaClient } from "../../packages/database/src/index";

export const LIVE_TEAM_ID = "live-evidence-home";
export const LIVE_CUTOFF = "2026-09-01T12:00:00.000Z";
export const LIVE_LATER_CUTOFF = "2026-09-02T12:00:00.000Z";
export const LIVE_API_ORIGIN = "http://127.0.0.1:3211";
export const LIVE_WEB_ORIGIN = "http://127.0.0.1:3210";

const statePointer = join(tmpdir(), "bet-stats-live-evidence-state-pointer");
const databaseRoot = resolve(process.cwd(), "packages/database");
const prismaCli = resolve(databaseRoot, "node_modules/prisma/build/index.js");

type StackState = { containerName: string; databaseUrl: string; apiPid?: number; webPid?: number; stateDir: string };

function docker(...args: string[]): string {
  return execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

async function unusedPort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("Could not allocate PostgreSQL port"));
      server.close((error) => error ? reject(error) : resolvePort(address.port));
    });
  });
}

async function waitFor(url: string, description: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = new Error(`${description} returned ${response.status}`);
    } catch (error) { lastError = error; }
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }
  throw new Error(`${description} did not become ready: ${String(lastError)}`);
}

async function seedPublishedEvidence(prisma: PrismaClient): Promise<void> {
  await prisma.league.create({ data: { id: "live-league", name: "Live League", countryCode: "GB" } });
  await prisma.season.create({ data: { id: "live-season", leagueId: "live-league", label: "2026", startsOn: new Date("2026-01-01"), endsOn: new Date("2026-12-31") } });
  await prisma.team.createMany({ data: [
    { id: LIVE_TEAM_ID, name: "Live Evidence FC", normalizedName: "live evidence fc", countryCode: "GB" },
    { id: "live-opponent", name: "Historical Opponent", normalizedName: "historical opponent", countryCode: "GB" },
  ] });
  const captures: string[] = [];
  for (let index = 0; index < 10; index += 1) {
    const fixtureId = `live-past-${String(index + 1).padStart(2, "0")}`;
    const kickoff = new Date(Date.UTC(2026, 7, 1 + index, 12));
    const observed = new Date(kickoff.getTime() + 2 * 60 * 60 * 1_000);
    const observationId = `live-observation-${index + 1}`;
    const payloadHash = `live-hash-${index + 1}`;
    captures.push(payloadHash);
    await prisma.fixture.create({ data: { id: fixtureId, leagueId: "live-league", seasonId: "live-season", homeTeamId: LIVE_TEAM_ID, awayTeamId: "live-opponent", kickoffUtc: kickoff, status: "FINISHED" } });
    await prisma.sourceObservation.create({ data: { id: observationId, provider: "football-data.org", endpointFamily: "RESULTS", externalIdentity: fixtureId, observedAt: observed, payloadHash, rawPayload: { score: `${index % 3 + 1}-0` }, payloadBytes: 24 + index } });
    await prisma.resultVersion.create({ data: { id: `live-result-${index + 1}`, fixtureId, observationId, effectiveAt: kickoff, observedAt: observed, homeGoals: index % 3 + 1, awayGoals: 0, status: "FINISHED", revision: 1 } });
  }
  const manifest = { expectedUnits: ["results"], completedUnits: ["results"], expectedCaptures: captures, completedCaptures: captures };
  await prisma.syncRun.create({ data: { id: "live-run", logicalKey: "live-run", revision: 1, provider: "football-data.org", endpointFamily: "RESULTS", lane: "critical", windowFrom: new Date("2026-08-01T00:00:00.000Z"), windowTo: new Date(LIVE_CUTOFF), state: "SUCCEEDED", correlationId: "live-evidence-correlation", expectedUnits: 1, completedUnits: 1, expectedCaptures: captures.length, completedCaptures: captures.length, completionManifest: manifest } });
  const observationIds = Array.from({ length: 10 }, (_, index) => `live-observation-${index + 1}`);
  await prisma.syncAttempt.createMany({ data: observationIds.map((observationId, index) => ({ syncRunId: "live-run", attemptNumber: index + 1, observationId, state: "SUCCEEDED", finishedAt: new Date(LIVE_CUTOFF) })) });
  const { createPrismaEvidenceRebuildDatabase, runEvidenceRebuild } = await import("../../workers/data-sync/dist/jobs/evidence-rebuild.js");
  const result = await runEvidenceRebuild({ database: createPrismaEvidenceRebuildDatabase(prisma), teamId: LIVE_TEAM_ID, cutoff: LIVE_CUTOFF, configVersion: "live-evidence-v1", configHash: "live-evidence-config-v1", syncRunId: "live-run" });
  if (result.state !== "PUBLISHED") throw new Error(`Expected a PUBLISHED live evidence build, received ${result.state}`);
}

function start(commandArgs: string[], env: NodeJS.ProcessEnv): ChildProcess {
  const executable = process.platform === "win32" ? "cmd.exe" : "corepack";
  const args = process.platform === "win32" ? ["/d", "/s", "/c", "corepack", ...commandArgs] : commandArgs;
  const child = spawn(executable, args, { cwd: process.cwd(), env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  child.stdout?.resume(); child.stderr?.resume();
  return child;
}

function corepack(...args: string[]): void {
  if (process.platform === "win32") execFileSync("cmd.exe", ["/d", "/s", "/c", "corepack", ...args], { stdio: "pipe" });
  else execFileSync("corepack", args, { stdio: "pipe" });
}

function stopOwned(pid: number | undefined): void {
  if (!pid) return;
  try {
    if (process.platform === "win32") execFileSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
    else process.kill(-pid, "SIGTERM");
  } catch { /* process already exited */ }
}

function cleanup(state: StackState): void {
  stopOwned(state.webPid);
  stopOwned(state.apiPid);
  try { docker("rm", "--force", state.containerName); } catch { /* container already removed */ }
  rmSync(state.stateDir, { recursive: true, force: true });
  try { rmSync(statePointer, { force: true }); } catch { /* absent */ }
}

export async function liveEvidenceGlobalSetup(): Promise<() => Promise<void>> {
  const stateDir = mkdtempSync(join(tmpdir(), "bet-stats-live-evidence-"));
  const state: StackState = { containerName: `bet-stats-live-evidence-${process.pid}-${Date.now()}`, databaseUrl: "", stateDir };
  writeFileSync(statePointer, join(stateDir, "state.json"));
  const persist = () => writeFileSync(join(stateDir, "state.json"), JSON.stringify(state));
  persist();
  try {
    const port = await unusedPort();
    docker("run", "--detach", "--name", state.containerName, "--env", "POSTGRES_PASSWORD=postgres", "--env", "POSTGRES_DB=bet_stats", "--publish", `127.0.0.1:${port}:5432`, "postgres:18-alpine");
    state.databaseUrl = `postgresql://postgres:postgres@127.0.0.1:${port}/bet_stats`;
    persist();
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try { docker("exec", state.containerName, "pg_isready", "-U", "postgres", "-d", "bet_stats"); break; }
      catch (error) { if (attempt === 59) throw error; await new Promise((resolveWait) => setTimeout(resolveWait, 500)); }
    }
    execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], { cwd: databaseRoot, env: { ...process.env, DATABASE_URL: state.databaseUrl }, stdio: "pipe" });
    corepack("pnpm", "--filter", "@bet-stats/data-sync", "build");
    const prisma = createPrismaClient(state.databaseUrl);
    try { await seedPublishedEvidence(prisma); } finally { await prisma.$disconnect(); }
    corepack("pnpm", "--filter", "@bet-stats/config", "build");
    corepack("pnpm", "--filter", "@bet-stats/api", "build");
    state.apiPid = start(["pnpm", "--filter", "@bet-stats/api", "dev"], { DATABASE_URL: state.databaseUrl, API_HOST: "127.0.0.1", API_PORT: "3211", POSTGRES_READY: "true", REDIS_READY: "true", NODE_ENV: "test" }).pid;
    persist();
    await waitFor(`${LIVE_API_ORIGIN}/health/ready`, "Nest readiness");
    state.webPid = start(["pnpm", "--filter", "@bet-stats/web", "exec", "next", "dev", "--hostname", "127.0.0.1", "--port", "3210"], { API_ORIGIN: LIVE_API_ORIGIN, DISPLAY_TIME_ZONE: "Europe/Warsaw", NODE_ENV: "test" }).pid;
    persist();
    await waitFor(LIVE_WEB_ORIGIN, "Next readiness");
    return liveEvidenceGlobalTeardown;
  } catch (error) {
    cleanup(state);
    throw error;
  }
}

export default liveEvidenceGlobalSetup;

export async function liveEvidenceGlobalTeardown(): Promise<void> {
  try {
    const stateFile = readFileSync(statePointer, "utf8").trim();
    cleanup(JSON.parse(readFileSync(stateFile, "utf8")) as StackState);
  } catch { /* setup already cleaned its owned resources */ }
}

export async function appendLaterCorrection(): Promise<void> {
  const stateFile = readFileSync(statePointer, "utf8").trim();
  const state = JSON.parse(readFileSync(stateFile, "utf8")) as StackState;
  if (!state.databaseUrl || !state.containerName || !state.apiPid || !state.webPid) throw new Error("Live evidence ownership metadata is incomplete");
  const prisma = createPrismaClient(state.databaseUrl);
  try {
    await prisma.sourceObservation.create({ data: { id: "live-correction-observation", provider: "football-data.org", endpointFamily: "RESULTS", externalIdentity: "live-past-10", observedAt: new Date("2026-09-02T10:00:00.000Z"), payloadHash: "live-correction-hash", rawPayload: { score: "0-2", corrected: true }, payloadBytes: 38 } });
    await prisma.resultVersion.create({ data: { id: "live-correction-result", fixtureId: "live-past-10", observationId: "live-correction-observation", effectiveAt: new Date("2026-08-10T12:00:00.000Z"), observedAt: new Date("2026-09-02T10:00:00.000Z"), homeGoals: 0, awayGoals: 2, status: "FINISHED", revision: 2, supersedesResultVersionId: "live-result-10" } });
  } finally { await prisma.$disconnect(); }
}
