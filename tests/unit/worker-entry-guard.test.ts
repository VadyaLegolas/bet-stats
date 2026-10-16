import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

const distMain = fileURLToPath(new URL("../../workers/data-sync/dist/main.js", import.meta.url));

const SERVER_CONFIG_KEYS = ["DATABASE_URL", "REDIS_URL", "FOOTBALL_DATA_API_TOKEN", "API_FOOTBALL_API_KEY"] as const;

function childEnv(overrides: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "test", ...overrides };
  for (const key of SERVER_CONFIG_KEYS) delete env[key];
  return { ...env, ...overrides };
}

const configuredEnv = childEnv({
  DATABASE_URL: "postgresql://user:pass@127.0.0.1:55999/dummy",
  REDIS_URL: "redis://127.0.0.1:6390",
  FOOTBALL_DATA_API_TOKEN: "dummy-token",
  API_FOOTBALL_API_KEY: "dummy-key",
});
const unconfiguredEnv = childEnv({});

type ChildResult = { code: number | null; killed: boolean; stdout: string; stderr: string };

async function runNode(args: string[], env: NodeJS.ProcessEnv): Promise<ChildResult> {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, args, { env, timeout: 15_000, windowsHide: true, maxBuffer: 10 * 1024 * 1024 });
    return { code: 0, killed: false, stdout, stderr };
  } catch (error) {
    const failure = error as { code?: number | null; killed?: boolean; stdout?: string; stderr?: string };
    return { code: typeof failure.code === "number" ? failure.code : null, killed: failure.killed === true, stdout: failure.stdout ?? "", stderr: failure.stderr ?? "" };
  }
}

describe.skipIf(!existsSync(distMain))("data-sync worker entry guard", () => {
  it("importing dist/main.js never starts the worker", { timeout: 30_000 }, async () => {
    const script = `await import(${JSON.stringify(pathToFileURL(distMain).href)});`;
    const result = await runNode(["--input-type=module", "-e", script], configuredEnv);
    const output = `${result.stdout}${result.stderr}`;

    expect(result.killed).toBe(false);
    expect(result.code).toBe(0);
    expect(result.stdout).not.toContain("worker.initialized");
    expect(output).not.toContain("forecast.sweep");
  });

  it("direct execution of dist/main.js still reports readiness", { timeout: 30_000 }, async () => {
    const result = await runNode([distMain], unconfiguredEnv);

    expect(result.killed).toBe(false);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("worker.initialized");
  });
});
