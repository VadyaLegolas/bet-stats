import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

import { CALIBRATION_CONFIG, fitMarketCalibrator, type CalibratorIdentity, type FittedCalibrator } from "../../packages/domain/src/calibration/index.js";
import type { ScoreMarket } from "../../packages/domain/src/evaluation/scoring.js";

import { makeCalibrationSamples } from "./calibration-samples.js";

/**
 * Shared plumbing for the calibration integration tests: a throwaway PostgreSQL container of the test's own,
 * `prisma migrate deploy` against it, and deterministic fitted calibrators. The development database container
 * is never referenced here.
 */

const workspaceRoot = resolve(import.meta.dirname, "../..");
export const databaseRoot = resolve(workspaceRoot, "packages/database");
export const migrationsRoot = resolve(databaseRoot, "prisma/migrations");
const prismaCli = resolve(databaseRoot, "node_modules/prisma/build/index.js");

export function docker(args: string[], input?: string): string {
  return execFileSync("docker", args, { encoding: "utf8", input, stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"] }).trim();
}

export interface TestPostgres {
  readonly container: string;
  /** Run psql with ON_ERROR_STOP; the statement goes through stdin. Throws with psql's stderr on failure. */
  psql(statement: string, database?: string): string;
  /** Output lines of `psql -At`. */
  lines(statement: string, database?: string): string[];
  url(database?: string): string;
  createDatabase(database: string): void;
  remove(): void;
}

export function startPostgres(container: string): TestPostgres {
  docker(["run", "--detach", "--name", container, "--env", "POSTGRES_PASSWORD=postgres", "--env", "POSTGRES_DB=bet_stats", "--publish", "127.0.0.1::5432", "postgres:18-alpine"]);
  let ready = false;
  for (let attempt = 0; attempt < 120 && !ready; attempt += 1) {
    try {
      docker(["exec", container, "psql", "-U", "postgres", "-d", "bet_stats", "-At", "-c", "SELECT 1"]);
      ready = true;
    } catch {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
    }
  }
  if (!ready) throw new Error(`${container} did not become ready`);
  const port = docker(["port", container, "5432/tcp"]).split(/\r?\n/)[0]!.split(":").at(-1);
  if (!port) throw new Error("Docker did not publish the PostgreSQL port");

  const psql = (statement: string, database = "bet_stats"): string =>
    docker(["exec", "-i", container, "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", database, "-At"], statement);
  return {
    container,
    psql,
    lines: (statement, database) => {
      const output = psql(statement, database);
      return output.length === 0 ? [] : output.split(/\r?\n/);
    },
    url: (database = "bet_stats") => `postgresql://postgres:postgres@127.0.0.1:${port}/${database}`,
    createDatabase: (database) => {
      docker(["exec", container, "createdb", "-U", "postgres", database]);
    },
    remove: () => {
      try {
        docker(["rm", "--force", "--volumes", container]);
      } catch {
        // Best effort: the container was created exclusively by the calling test.
      }
    },
  };
}

/** `prisma migrate deploy` of the full migration set against `databaseUrl` (a throwaway database). */
export function migrateDeploy(databaseUrl: string): void {
  execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], {
    cwd: databaseRoot,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: "pipe",
  });
}

export const TEST_IDENTITY: CalibratorIdentity = Object.freeze({
  modelVersion: "dixon-coles-ensemble-v1" as const,
  configHash: `sha256:${"a".repeat(64)}`,
});

export const OTHER_CONFIG_IDENTITY: CalibratorIdentity = Object.freeze({
  modelVersion: "dixon-coles-ensemble-v1" as const,
  configHash: `sha256:${"b".repeat(64)}`,
});

export const OTHER_MODEL_IDENTITY: CalibratorIdentity = Object.freeze({
  modelVersion: "poisson-ensemble-v1" as const,
  configHash: TEST_IDENTITY.configHash,
});

export interface MakeFittedInput {
  readonly market?: ScoreMarket;
  /** Different seeds give different sample digests and therefore different calibrator ids. */
  readonly seed?: number;
  readonly identity?: CalibratorIdentity;
  readonly count?: number;
  readonly asOf?: string;
}

/** A fitted calibrator from the deterministic generator (400 over-confident samples by default). */
export function makeFitted(input: MakeFittedInput = {}): FittedCalibrator {
  const market = input.market ?? "OVER_UNDER_2_5";
  const result = fitMarketCalibrator({
    identity: input.identity ?? TEST_IDENTITY,
    market,
    samples: makeCalibrationSamples({ market, count: input.count ?? 400, seed: input.seed ?? 101, trueSlope: 0.5, trueIntercept: 0.3 }),
    asOf: input.asOf ?? "2027-03-01T00:00:00.000Z",
    config: CALIBRATION_CONFIG,
  });
  if (result.state !== "FITTED") throw new Error("test fixture did not produce a fitted calibrator");
  return result.calibrator;
}
