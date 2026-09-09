import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { createPrismaClient, type PrismaClient } from "../../packages/database/src/client";

export const EVALUATION_API_ORIGIN = "http://127.0.0.1:3221";
export const EVALUATION_WEB_ORIGIN = "http://127.0.0.1:3220";
export const EVALUATION_BOUNDS = { from: "2026-01-01T00:00:00.000Z", to: "2027-01-01T00:00:00.000Z" } as const;
export const AVAILABLE_QUERY = new URLSearchParams({ modelVersion: "acceptance-v1", competitionId: "evaluation-league", market: "ONE_X_TWO", ...EVALUATION_BOUNDS }).toString();
export const LIMITED_QUERY = new URLSearchParams({ modelVersion: "weak-v1", competitionId: "evaluation-league", market: "ONE_X_TWO", ...EVALUATION_BOUNDS }).toString();
export const UNAVAILABLE_QUERY = new URLSearchParams({ modelVersion: "missing-v1", competitionId: "evaluation-league", market: "ONE_X_TWO", ...EVALUATION_BOUNDS }).toString();

const pointer = join(tmpdir(), "bet-stats-live-evaluation-pointer");
const databaseRoot = resolve(process.cwd(), "packages/database");
const prismaCli = resolve(databaseRoot, "node_modules/prisma/build/index.js");
type State = { container: string; url: string; dir: string; apiPid?: number; webPid?: number };

function docker(...args: string[]): string { return execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); }
function corepack(...args: string[]): void { execFileSync(process.platform === "win32" ? "cmd.exe" : "corepack", process.platform === "win32" ? ["/d", "/s", "/c", "corepack", ...args] : args, { cwd: process.cwd(), stdio: "pipe" }); }
function start(args: string[], env: NodeJS.ProcessEnv): ChildProcess {
  return spawn(process.platform === "win32" ? "cmd.exe" : "corepack", process.platform === "win32" ? ["/d", "/s", "/c", "corepack", ...args] : args, { cwd: process.cwd(), env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
}
function stop(pid?: number): void { if (!pid) return; try { process.platform === "win32" ? execFileSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" }) : process.kill(-pid, "SIGTERM"); } catch { /* already stopped */ } }
function cleanup(state: State): void { stop(state.webPid); stop(state.apiPid); try { docker("rm", "--force", state.container); } catch { /* owned container absent */ } rmSync(state.dir, { recursive: true, force: true }); rmSync(pointer, { force: true }); }
async function wait(url: string): Promise<void> { let cause: unknown; for (let i = 0; i < 120; i += 1) { try { const response = await fetch(url); if (response.ok) return; cause = response.status; } catch (error) { cause = error; } await new Promise((done) => setTimeout(done, 500)); } throw new Error(`SERVICE_NOT_READY: ${String(cause)}`); }

async function seed(prisma: PrismaClient): Promise<void> {
  await prisma.league.create({ data: { id: "evaluation-league", name: "Evaluation League", countryCode: "GB" } });
  await prisma.season.create({ data: { id: "evaluation-season", leagueId: "evaluation-league", label: "2026", startsOn: new Date("2026-01-01"), endsOn: new Date("2026-12-31") } });
  await prisma.team.createMany({ data: [{ id: "evaluation-home", name: "Evidence Home", normalizedName: "evidence home", countryCode: "GB" }, { id: "evaluation-away", name: "Evidence Away", normalizedName: "evidence away", countryCode: "GB" }] });
  const { createSettlementPipelineService } = await import("../../packages/database/dist/index.js");
  const service = createSettlementPipelineService({ database: prisma });
  for (let index = 0; index < 51; index += 1) {
    const suffix = String(index + 1).padStart(2, "0"); const fixtureId = `evaluation-fixture-${suffix}`; const model = index === 50 ? "weak-v1" : "acceptance-v1";
    const kickoff = new Date(Date.UTC(2026, 1, index + 1, 18)); const observed = new Date(kickoff.getTime() + 7_200_000); const cutoff = new Date(kickoff.getTime() - 3_600_000);
    await prisma.fixture.create({ data: { id: fixtureId, leagueId: "evaluation-league", seasonId: "evaluation-season", homeTeamId: "evaluation-home", awayTeamId: "evaluation-away", kickoffUtc: kickoff, status: "FINISHED" } });
    await prisma.sourceObservation.create({ data: { id: `evaluation-observation-${suffix}`, provider: "acceptance", endpointFamily: "RESULTS", externalIdentity: fixtureId, observedAt: observed, payloadHash: `evaluation-result-${suffix}`, rawPayload: { home: 2, away: 1 }, payloadBytes: 20 } });
    await prisma.resultVersion.create({ data: { id: `evaluation-result-${suffix}`, fixtureId, observationId: `evaluation-observation-${suffix}`, effectiveAt: kickoff, observedAt: observed, homeGoals: 2, awayGoals: 1, status: "FINISHED", revision: 1 } });
    await prisma.forecastSnapshot.create({ data: { id: `evaluation-forecast-${suffix}`, fixtureId, kind: "PRE_MATCH", state: "ISSUED", revision: 1, cutoff, modelVersion: model, modelHash: "model-hash", configVersion: "forecast-config-v1", configHash: "config-hash", inputHash: `input-${suffix}`, evidenceFingerprint: `evidence-${suffix}`, sourceRefs: [], probabilities: {}, confidence: {}, assumptions: [], receipt: {}, issuedAt: new Date(cutoff.getTime() + 1000), markets: { create: { id: `evaluation-market-${suffix}`, market: "ONE_X_TWO", probabilities: [{ selection: "HOME", probability: 0.5 }, { selection: "DRAW", probability: 0.3 }, { selection: "AWAY", probability: 0.2 }] } } } });
    if (index < 30) {
      await prisma.manualOddsSnapshot.create({ data: { id: `evaluation-odds-${suffix}`, fixtureId, market: "ONE_X_TWO", inputHash: `odds-${suffix}`, source: "BOOKMAKER_BACK", receipt: { selections: [{ selection: "HOME", decimalOdds: "2.4", noVigProbability: "0.45" }] }, submittedAt: new Date(cutoff.getTime() - 1000), selections: { create: { id: `evaluation-selection-${suffix}`, selection: "HOME", decimalOdds: "2.4" } } } });
      await prisma.valueReceipt.create({ data: { id: `evaluation-value-${suffix}`, fixtureId, market: "ONE_X_TWO", forecastSnapshotId: `evaluation-forecast-${suffix}`, oddsSnapshotId: `evaluation-odds-${suffix}`, outcome: "VALUE_CANDIDATE", selection: "HOME", modelProbability: "0.5", noVigProbability: "0.45", fairOdds: "2", edge: "0.05", expectedValue: "0.2", receipt: { market: "ONE_X_TWO", selection: "HOME", decimalOdds: "2.4", modelProbability: "0.5", noVigProbability: "0.45" } } });
      if (index % 2 === 0) await prisma.closingOddsObservation.create({ data: { id: `evaluation-close-${suffix}`, fixtureId, market: "ONE_X_TWO", selection: "HOME", decimalOdds: "2", oddsFormat: "DECIMAL", sourceConvention: "BOOKMAKER_BACK", observationKind: "MARKET_CLOSE", observedAt: new Date(kickoff.getTime() - 30_000) } });
    }
    await service.process({ fixtureId, resultVersionId: `evaluation-result-${suffix}`, forecastSnapshotId: `evaluation-forecast-${suffix}`, policyVersion: "settlement-policy-v1", correlationId: `acceptance-${suffix}` });
  }
}

export default async function setup(): Promise<() => Promise<void>> {
  const dir = mkdtempSync(join(tmpdir(), "bet-stats-live-evaluation-")); const state: State = { container: `bet-stats-live-evaluation-${process.pid}-${Date.now()}`, url: "", dir };
  writeFileSync(pointer, join(dir, "state.json")); const persist = () => writeFileSync(join(dir, "state.json"), JSON.stringify(state)); persist();
  try {
    docker("run", "--detach", "--name", state.container, "--env", "POSTGRES_PASSWORD=postgres", "--env", "POSTGRES_DB=bet_stats", "--publish", "127.0.0.1::5432", "postgres:18-alpine");
    for (let i = 0; i < 60; i += 1) { try { docker("exec", state.container, "pg_isready", "-U", "postgres", "-d", "bet_stats"); break; } catch (error) { if (i === 59) throw error; await new Promise((done) => setTimeout(done, 500)); } }
    const pgPort = docker("port", state.container, "5432/tcp").split(":").at(-1); if (!pgPort) throw new Error("POSTGRES_PORT_MISSING"); state.url = `postgresql://postgres:postgres@127.0.0.1:${pgPort}/bet_stats`; persist();
    execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], { cwd: databaseRoot, env: { ...process.env, DATABASE_URL: state.url }, stdio: "pipe" });
    corepack("pnpm", "--filter", "@bet-stats/config", "build"); corepack("pnpm", "--filter", "@bet-stats/domain", "build"); corepack("pnpm", "--filter", "@bet-stats/database", "build");
    const prisma = createPrismaClient(state.url); try { await seed(prisma); } finally { await prisma.$disconnect(); } corepack("pnpm", "--filter", "@bet-stats/api", "build");
    state.apiPid = start(["pnpm", "--filter", "@bet-stats/api", "dev"], { DATABASE_URL: state.url, API_HOST: "127.0.0.1", API_PORT: "3221", POSTGRES_READY: "true", REDIS_READY: "true", NODE_ENV: "test", ELIGIBILITY_ALLOWED_REGIONS: "PL" }).pid; persist(); await wait(`${EVALUATION_API_ORIGIN}/health/ready`);
    corepack("pnpm", "--filter", "@bet-stats/web", "build"); state.webPid = start(["pnpm", "--filter", "@bet-stats/web", "exec", "next", "start", "--hostname", "127.0.0.1", "--port", "3220"], { API_ORIGIN: EVALUATION_API_ORIGIN, DISPLAY_TIME_ZONE: "Europe/Warsaw", NODE_ENV: "production", ELIGIBILITY_REGION: "PL", ELIGIBILITY_AGE_ACKNOWLEDGED: "true", ELIGIBILITY_CHECKED_AT: new Date().toISOString() }).pid; persist(); await wait(EVALUATION_WEB_ORIGIN); return teardown;
  } catch (error) { cleanup(state); throw error; }
}
export async function teardown(): Promise<void> { try { const stateFile = readFileSync(pointer, "utf8").trim(); cleanup(JSON.parse(readFileSync(stateFile, "utf8")) as State); } catch { /* setup cleaned exact resources */ } }
