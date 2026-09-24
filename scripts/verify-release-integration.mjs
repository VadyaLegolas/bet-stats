import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { delimiter, dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const databaseRoot = resolve(root, "packages/database");
const prismaCli = resolve(databaseRoot, "node_modules/prisma/build/index.js");

function docker(...args) {
  return execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

async function waitFor(container, command, delayMs) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { docker("exec", container, ...command); return; }
    catch (error) {
      if (attempt === 59) throw error;
      await new Promise((resolveWait) => setTimeout(resolveWait, delayMs));
    }
  }
}

export async function startOwnedReleaseDependencies() {
  const suffix = `${process.pid}-${Date.now()}`;
  const postgres = `bet-stats-release-pg-${suffix}`;
  const redis = `bet-stats-release-redis-${suffix}`;
  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    for (const name of [redis, postgres]) {
      try { docker("rm", "--force", name); } catch { /* exact owned cleanup is best effort */ }
    }
  };

  try {
    docker("run", "--detach", "--name", postgres, "--env", "POSTGRES_PASSWORD=postgres", "--env", "POSTGRES_DB=bet_stats", "--publish", "127.0.0.1::5432", "postgres:18-alpine");
    docker("run", "--detach", "--name", redis, "--publish", "127.0.0.1::6379", "redis:8-alpine");
    await waitFor(postgres, ["pg_isready", "-U", "postgres", "-d", "bet_stats"], 500);
    await waitFor(redis, ["redis-cli", "ping"], 250);
    const postgresPort = docker("port", postgres, "5432/tcp").split(":").at(-1);
    const redisPort = docker("port", redis, "6379/tcp").split(":").at(-1);
    if (!postgresPort || !redisPort) throw new Error("RELEASE_DEPENDENCY_PORT_UNAVAILABLE");
    const databaseUrl = `postgresql://postgres:postgres@127.0.0.1:${postgresPort}/bet_stats`;
    const redisUrl = `redis://127.0.0.1:${redisPort}`;
    execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], {
      cwd: databaseRoot,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: "inherit",
    });
    return { databaseUrl, redisUrl, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}

export function runIntegrationTests(environment) {
  const pnpmCli = process.env.npm_execpath
    ?? (process.env.APPDATA ? resolve(process.env.APPDATA, "npm/node_modules/corepack/dist/pnpm.js") : undefined);
  if (!pnpmCli) throw new Error("RELEASE_PNPM_CLI_UNAVAILABLE");
  return new Promise((resolveExit, reject) => {
    const child = spawn(process.execPath, [pnpmCli, "exec", "vitest", "run", "--project", "integration"], {
      cwd: root,
      env: environment,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code) => resolveExit(code ?? 1));
  });
}

export async function runOwnedIntegrationGate({
  start = startOwnedReleaseDependencies,
  run = runIntegrationTests,
  environment = process.env,
} = {}) {
  const owned = await start();
  try {
    const runtimePath = dirname(process.execPath);
    const inheritedPath = environment.PATH ?? environment.Path ?? "";
    return await run({
      ...environment,
      PATH: `${runtimePath}${delimiter}${inheritedPath}`,
      DATABASE_URL: owned.databaseUrl,
      REDIS_URL: owned.redisUrl,
      OPERATOR_PROXY_SIGNING_SECRET: environment.OPERATOR_PROXY_SIGNING_SECRET ?? "release-integration-signing-secret-32-bytes",
      OPERATOR_AUTHORIZED_SUBJECTS: environment.OPERATOR_AUTHORIZED_SUBJECTS ?? "local-test-operator",
    });
  } finally {
    await owned.stop();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runOwnedIntegrationGate();
}
