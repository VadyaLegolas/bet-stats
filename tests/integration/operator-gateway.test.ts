import { spawn, type ChildProcess } from "node:child_process";
import { createServer, get as getHttp, type IncomingHttpHeaders, type Server } from "node:http";
import { once } from "node:events";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const serverPath = resolve(import.meta.dirname, "../../infra/operator-gateway/server.mjs");
const testSecret = "test-only-proxy-signing-secret";

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
    const child = spawn(process.execPath, [serverPath], {
      env: {
        ...process.env,
        GATEWAY_PORT: "0",
        WEB_ORIGIN: "http://127.0.0.1:3000",
        OPERATOR_BASIC_USERNAME: "operator",
        OPERATOR_BASIC_PASSWORD: "test-password",
        OPERATOR_SUBJECT: "local-test-operator",
        OPERATOR_PROXY_SIGNING_SECRET: undefined,
      },
      stdio: "ignore",
    });
    const [code] = await once(child, "exit") as [number | null];
    expect(code).not.toBe(0);
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
