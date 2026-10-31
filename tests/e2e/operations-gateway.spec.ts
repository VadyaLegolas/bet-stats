import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";

import { readLiveReleaseState } from "./live-release-stack.js";

// G-08-6: a human operator reaches /internal/operations only through the
// gateway chain — Basic auth at the edge, HMAC signing on internal-api hops —
// so every assertion below travels the same path the launcher starts.
const OPERATOR_USERNAME = "phase-08-operator";
const OPERATOR_PASSWORD = "phase-08-operator-e2e-password";
const OPERATOR_SUBJECT = "release-operator";
const SIGNING_SECRET = "phase-06-operations-signing-secret-32-bytes";
const QUERY = "?page=1&pageSize=25&windowHours=24";
const BACKUP_STATES = ["NOT_CONFIGURED", "NEVER_VERIFIED", "STALE", "FAILED", "HEALTHY"] as const;

let gatewayProcess: ChildProcess | undefined;
let gatewayOrigin = "";

function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      probe.close(() => (port ? resolvePort(port) : reject(new Error("EPHEMERAL_PORT_UNAVAILABLE"))));
    });
  });
}

async function waitForGateway(origin: string): Promise<void> {
  // An unauthenticated probe of a protected path must yield the Basic
  // challenge (401) — connection failures keep retrying until the daemon binds.
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${origin}/internal/operations`);
      if (response.status === 401) return;
    } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error("OPERATOR_GATEWAY_NOT_READY");
}

test.use({ httpCredentials: { username: OPERATOR_USERNAME, password: OPERATOR_PASSWORD } });

test.beforeAll(async () => {
  const { webOrigin } = readLiveReleaseState();
  const port = await freePort();
  gatewayOrigin = `http://127.0.0.1:${port}`;
  const diagnostics: string[] = [];
  gatewayProcess = spawn(process.execPath, [resolve("infra/operator-gateway/server.mjs")], {
    env: {
      ...process.env,
      GATEWAY_PORT: String(port),
      WEB_ORIGIN: webOrigin,
      OPERATOR_BASIC_USERNAME: OPERATOR_USERNAME,
      OPERATOR_BASIC_PASSWORD: OPERATOR_PASSWORD,
      OPERATOR_SUBJECT: OPERATOR_SUBJECT,
      OPERATOR_PROXY_SIGNING_SECRET: SIGNING_SECRET,
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  gatewayProcess.stderr?.on("data", (chunk) => diagnostics.push(String(chunk).slice(-2000)));
  gatewayProcess.once("exit", (code) => diagnostics.push(`gateway exited with code ${code ?? "null"}`));
  try {
    await waitForGateway(gatewayOrigin);
  } catch (error) {
    throw new Error(`OPERATOR_GATEWAY_STARTUP_FAILED: ${diagnostics.join("")}`, { cause: error });
  }
});

test.afterAll(async () => {
  const pid = gatewayProcess?.pid;
  gatewayProcess = undefined;
  if (!pid) return;
  try {
    if (process.platform === "win32") spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
    else process.kill(pid, "SIGTERM");
  } catch {}
});

test("operator reaches the signed operations centre through the gateway", async ({ page }) => {
  await page.goto(`${gatewayOrigin}/internal/operations${QUERY}`);
  await expect(page.getByRole("heading", { level: 1, name: "Центр операций" })).toBeVisible();

  const status = page.getByTestId("backup-status");
  await expect(status).toBeVisible();
  const state = await status.getAttribute("data-state");
  expect(state).not.toBeNull();
  expect(BACKUP_STATES).toContain(state);
  await expect(page.getByText("Этот операционный блок недоступен")).toHaveCount(0);

  await page.getByRole("button", { name: "Создать резервную копию сейчас" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Резервная копия поставлена в очередь" })).toBeVisible();

  await page.getByRole("button", { name: "Запустить проверку восстановления сейчас" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Проверка восстановления поставлена в очередь" })).toBeVisible();
});

test("unsigned access fails closed at the gateway and at the web proxy", async () => {
  const { webOrigin } = readLiveReleaseState();

  // Plain fetch, not a Playwright request context: under test.use({ httpCredentials })
  // the runner silently injects the operator Basic credentials into every
  // request.newContext() (runBeforeCreateRequestContext merges _combinedContextOptions),
  // which would defeat the point of an "anonymous" probe.
  const challenge = await fetch(`${gatewayOrigin}/internal-api/operations/overview${QUERY}`);
  expect(challenge.status).toBe(401);
  expect(await challenge.json()).toEqual({ message: "Authentication required" });

  const bypass = await fetch(`${webOrigin}/internal-api/operations/overview${QUERY}`);
  expect(bypass.status).toBe(404);
  expect(await bypass.json()).toEqual({ message: "Not found" });
});
