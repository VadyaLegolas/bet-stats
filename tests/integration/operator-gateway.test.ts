import { spawn, type ChildProcess } from "node:child_process";
import { createServer, get as getHttp, type IncomingHttpHeaders, type Server } from "node:http";
import { once } from "node:events";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const serverPath = resolve(import.meta.dirname, "../../infra/operator-gateway/server.mjs");
const testSecret = "test-only-proxy-signing-secret-32bytes";

async function listen(server: Server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected a TCP address");
  return `http://127.0.0.1:${address.port}`;
}

async function unusedOrigin() {
  const server = createServer();
  const origin = await listen(server);
  await new Promise<void>((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose()));
  return origin;
}

function startGateway(webOrigin: string, overrides: Record<string, string | undefined> = {}) {
  return new Promise<{ process: ChildProcess; origin: string }>((resolveStart, rejectStart) => {
    const gateway = createServer();
    gateway.listen(0, "127.0.0.1", () => {
      const address = gateway.address();
      if (!address || typeof address === "string") return rejectStart(new Error("Expected a TCP address"));
      const port = address.port;
      gateway.close(() => {
        const child = spawn(process.execPath, [serverPath], {
          env: {
            ...process.env,
            GATEWAY_PORT: String(port),
            WEB_ORIGIN: webOrigin,
            OPERATOR_BASIC_USERNAME: "operator",
            OPERATOR_BASIC_PASSWORD: "test-password",
            OPERATOR_SUBJECT: "local-test-operator",
            OPERATOR_PROXY_SIGNING_SECRET: testSecret,
            ...overrides,
          },
          stdio: ["ignore", "pipe", "pipe"],
        });
        const origin = `http://127.0.0.1:${port}`;
        const deadline = Date.now() + 5_000;
        const waitForGateway = async (): Promise<void> => {
          try {
            await fetch(`${origin}/health`, { signal: AbortSignal.timeout(200) });
            resolveStart({ process: child, origin });
          } catch (error) {
            if (Date.now() > deadline || child.exitCode !== null) {
              rejectStart(error);
              return;
            }
            setTimeout(() => void waitForGateway(), 25);
          }
        };
        void waitForGateway();
      });
    });
  });
}

async function stop(process: ChildProcess) {
  if (process.exitCode !== null) return;
  process.kill();
  await once(process, "exit");
}

function launchGateway(overrides: Record<string, string | undefined>) {
  return spawn(process.execPath, [serverPath], {
    env: {
      ...process.env,
      GATEWAY_PORT: "1",
      WEB_ORIGIN: "http://127.0.0.1:3000",
      OPERATOR_BASIC_USERNAME: "operator",
      OPERATOR_BASIC_PASSWORD: "test-password",
      OPERATOR_SUBJECT: "local-test-operator",
      OPERATOR_PROXY_SIGNING_SECRET: testSecret,
      ...overrides,
    },
    stdio: "ignore",
  });
}

async function exitsBeforeListening(overrides: Record<string, string | undefined>) {
  const reserved = createServer();
  const origin = await listen(reserved);
  const port = new URL(origin).port;
  await new Promise<void>((resolveClose, rejectClose) => reserved.close((error) => error ? rejectClose(error) : resolveClose()));
  const child = launchGateway({ GATEWAY_PORT: port, ...overrides });
  const exited = await Promise.race([
    once(child, "exit").then(() => true),
    new Promise<false>((resolveTimeout) => setTimeout(() => resolveTimeout(false), 500)),
  ]);
  if (!exited) await stop(child);
  return exited;
}

describe("operator gateway HTTP boundary", () => {
  it("streams public and authenticated protected requests while replacing spoofed operator identity", async () => {
    const requests: Array<{ path: string; headers: IncomingHttpHeaders }> = [];
    const upstream = createServer((request, response) => {
      requests.push({ path: request.url ?? "", headers: request.headers });
      request.resume();
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true }));
    });
    const upstreamOrigin = await listen(upstream);
    const gateway = await startGateway(upstreamOrigin);

    try {
      expect((await fetch(`${gateway.origin}/fixtures`, { headers: { "x-operator-subject": "attacker" } })).status).toBe(200);
      expect((await fetch(`${gateway.origin}/internal-api/pipeline/replay/preview`)).status).toBe(401);
      const response = await fetch(`${gateway.origin}/internal-api/pipeline/replay/preview`, {
        method: "POST",
        headers: {
          authorization: `Basic ${Buffer.from("operator:test-password").toString("base64")}`,
          "x-operator-subject": "attacker",
          "content-type": "application/json",
        },
        body: "{}",
      });

      expect(response.status).toBe(200);
      const forwarded = requests.filter((request) => request.path !== "/health");
      expect(forwarded).toHaveLength(2);
      expect(forwarded[0]?.headers["x-operator-subject"]).toBeUndefined();
      expect(forwarded[1]?.headers["x-operator-subject"]).toBe("local-test-operator");
      expect(forwarded[1]?.headers["x-operator-signature"]).toMatch(/^[A-Za-z0-9_-]{43}$/);
    } finally {
      await stop(gateway.process);
      await new Promise<void>((resolveClose, rejectClose) => upstream.close((error) => error ? rejectClose(error) : resolveClose()));
    }
  });

  it("fails closed for malformed Basic credentials before it opens an upstream request", async () => {
    let upstreamRequests = 0;
    const upstream = createServer((request, response) => {
      if (request.url !== "/health") upstreamRequests += 1;
      request.resume();
      response.end();
    });
    const gateway = await startGateway(await listen(upstream));

    try {
      const response = await fetch(`${gateway.origin}/internal-api/pipeline/replay/preview`, {
        headers: { authorization: "Basic not base64!!!" },
      });
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ message: "Authentication required" });
      expect(upstreamRequests).toBe(0);
    } finally {
      await stop(gateway.process);
      await new Promise<void>((resolveClose, rejectClose) => upstream.close((error) => error ? rejectClose(error) : resolveClose()));
    }
  });

  it("returns a classified 502 when the configured upstream is unavailable", async () => {
    const gateway = await startGateway(await unusedOrigin());
    try {
      const response = await fetch(`${gateway.origin}/fixtures`);
      expect(response.status).toBe(502);
      expect(await response.json()).toEqual({ message: "Upstream unavailable" });
    } finally {
      await stop(gateway.process);
    }
  });

  it("fails startup when a required configuration value is absent", async () => {
    const child = launchGateway({ OPERATOR_PROXY_SIGNING_SECRET: undefined });
    const [code] = await once(child, "exit") as [number | null];
    expect(code).not.toBe(0);
  });

  it.each([
    ["a short signing secret", { OPERATOR_PROXY_SIGNING_SECRET: "too-short" }],
    ["a newline in the operator subject", { OPERATOR_SUBJECT: "local\noperator" }],
    ["a noncanonical operator subject", { OPERATOR_SUBJECT: "ｌocal-test-operator" }],
  ])("fails startup for %s", async (_, overrides) => {
    expect(await exitsBeforeListening(overrides)).toBe(true);
  });

  it("preserves multiple Set-Cookie values and removes Connection-nominated upstream headers", async () => {
    const upstream = createServer((request, response) => {
      if (request.url === "/health") return response.end("ok");
      response.writeHead(200, {
        connection: "x-upstream-private",
        "set-cookie": ["first=value; Path=/", "second=value; Path=/"],
        "x-upstream-private": "remove-me",
        "x-upstream-public": "preserve-me",
      });
      response.end("ok");
    });
    const gateway = await startGateway(await listen(upstream));

    try {
      const response = await fetch(`${gateway.origin}/cookies`);
      expect(response.status).toBe(200);
      expect(response.headers.getSetCookie()).toEqual(["first=value; Path=/", "second=value; Path=/"]);
      expect(response.headers.get("x-upstream-private")).toBeNull();
      expect(response.headers.get("x-upstream-public")).toBe("preserve-me");
    } finally {
      await stop(gateway.process);
      await new Promise<void>((resolveClose, rejectClose) => upstream.close((error) => error ? rejectClose(error) : resolveClose()));
    }
  });

  it("survives an upstream response reset after it has forwarded headers", async () => {
    const upstream = createServer((request, response) => {
      if (request.url === "/health") return response.end("ok");
      response.writeHead(200, { "content-type": "text/plain" });
      response.flushHeaders();
      response.write("partial");
      setTimeout(() => response.socket?.destroy(), 20);
    });
    const gateway = await startGateway(await listen(upstream));

    try {
      const response = await fetch(`${gateway.origin}/reset`);
      await expect(response.text()).rejects.toThrow();
      expect(gateway.process.exitCode).toBeNull();
      expect((await fetch(`${gateway.origin}/health`)).status).toBe(200);
    } finally {
      await stop(gateway.process);
      await new Promise<void>((resolveClose, rejectClose) => upstream.close((error) => error ? rejectClose(error) : resolveClose()));
    }
  });

  it("destroys a pending upstream request when the client disconnects", async () => {
    let upstreamSocketClosed: Promise<void> | undefined;
    let signalUpstreamOpened: () => void;
    const upstreamOpened = new Promise<void>((resolveOpened) => { signalUpstreamOpened = resolveOpened; });
    const upstream = createServer((request, response) => {
      if (request.url === "/health") {
        response.end("ok");
        return;
      }
      upstreamSocketClosed = once(request.socket, "close").then(() => undefined);
      signalUpstreamOpened();
    });
    const gateway = await startGateway(await listen(upstream));

    try {
      const client = getHttp(`${gateway.origin}/fixtures`);
      client.on("error", () => undefined);
      await once(client, "socket");
      await upstreamOpened;
      client.destroy();
      if (!upstreamSocketClosed) throw new Error("upstream request did not open");
      await Promise.race([upstreamSocketClosed, new Promise((_, reject) => setTimeout(() => reject(new Error("upstream stayed open")), 2_000))]);
    } finally {
      await stop(gateway.process);
      await new Promise<void>((resolveClose, rejectClose) => upstream.close((error) => error ? rejectClose(error) : resolveClose()));
    }
  });
});
