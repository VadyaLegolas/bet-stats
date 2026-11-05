import { spawn, type ChildProcess } from "node:child_process";
import { createHash, createHmac } from "node:crypto";
import { createServer, get as getHttp, type IncomingHttpHeaders, type Server } from "node:http";
import { once } from "node:events";
import { connect, type Socket } from "node:net";
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
  // A fail-closed process must exit before listening; the wider window tolerates
  // slow cold starts under full-suite load without weakening that guarantee.
  const exited = await Promise.race([
    once(child, "exit").then(() => true),
    new Promise<false>((resolveTimeout) => setTimeout(() => resolveTimeout(false), 5_000)),
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

  it("refuses unsigned operations requests at the ingress and signs authenticated ones verifiably", async () => {
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
      // Unsigned: refused at the ingress with 401 — it never reaches the
      // upstream at all, so no unsigned operations request can traverse the
      // chain (the web proxy's fail-closed 404 for direct unsigned requests
      // is proven separately by the release e2e negative assertions).
      const before = requests.filter((request) => request.path !== "/health").length;
      const unsigned = await fetch(`${gateway.origin}/internal-api/operations/overview`);
      expect(unsigned.status).toBe(401);
      expect(requests.filter((request) => request.path !== "/health")).toHaveLength(before);
      // Valid Basic auth: arrives with a signature the Next proxy canonical
      // string accepts.
      const authenticated = await fetch(`${gateway.origin}/internal-api/operations/overview`, {
        headers: { authorization: `Basic ${Buffer.from("operator:test-password").toString("base64")}` },
      });
      expect(authenticated.status).toBe(200);

      const forwarded = requests.filter((request) => request.path !== "/health");
      expect(forwarded).toHaveLength(1);
      const subject = forwarded[0]?.headers["x-operator-subject"];
      const timestamp = forwarded[0]?.headers["x-operator-timestamp"];
      const signature = forwarded[0]?.headers["x-operator-signature"];
      expect(subject).toBe("local-test-operator");
      expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(signature).toMatch(/^[A-Za-z0-9_-]{43}$/);
      // Recompute the exact canonical string the Next proxy builds:
      // subject\ntimestamp\nMETHOD\npathname\nqueryDigest (empty query here).
      const queryDigest = createHash("sha256").update("", "utf8").digest("base64url");
      const payload = `local-test-operator\n${timestamp}\nGET\n/internal-api/operations/overview\n${queryDigest}`;
      const expected = createHmac("sha256", testSecret).update(payload, "utf8").digest("base64url");
      expect(signature).toBe(expected);
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

  it("bounds a stalled upstream request with a classified 504", async () => {
    const upstream = createServer((request, response) => {
      if (request.url === "/health") return response.end("ok");
      request.resume();
    });
    const gateway = await startGateway(await listen(upstream));

    try {
      const startedAt = Date.now();
      const response = await fetch(`${gateway.origin}/stalled`);
      expect(response.status).toBe(504);
      expect(await response.json()).toEqual({ message: "Upstream timed out" });
      expect(Date.now() - startedAt).toBeLessThan(12_000);
    } finally {
      await stop(gateway.process);
      await new Promise<void>((resolveClose, rejectClose) => upstream.close((error) => error ? rejectClose(error) : resolveClose()));
    }
  }, 15_000);

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

function upgradeHandshake(path: string, extraHeaders: Record<string, string> = {}) {
  const lines = [
    `GET ${path} HTTP/1.1`,
    "Host: 127.0.0.1",
    "Connection: Upgrade",
    "Upgrade: websocket",
    "Sec-WebSocket-Key: dGVzdC1rZXk=",
    "Sec-WebSocket-Version: 13",
  ];
  for (const [name, value] of Object.entries(extraHeaders)) lines.push(`${name}: ${value}`);
  return `${lines.join("\r\n")}\r\n\r\n`;
}

// Accumulates every raw byte a socket receives so assertions can inspect the
// literal status line + headers the gateway writes, and polls for a condition
// (a satisfied predicate always wins over a later socket close).
function capture(socket: Socket) {
  const chunks: Buffer[] = [];
  let closed = false;
  socket.on("data", (chunk) => chunks.push(chunk));
  socket.on("error", () => undefined);
  socket.on("close", () => { closed = true; });
  const text = () => Buffer.concat(chunks).toString("latin1");
  const waitUntil = (predicate: (value: string) => boolean, timeoutMs = 5_000) =>
    new Promise<void>((waitResolve, waitReject) => {
      const deadline = Date.now() + timeoutMs;
      const poll = () => {
        const value = text();
        if (predicate(value)) return waitResolve();
        if (closed || Date.now() > deadline) {
          return waitReject(new Error(`Condition not met; received: ${JSON.stringify(value.slice(0, 300))}`));
        }
        setTimeout(poll, 20);
      };
      poll();
    });
  return { text, waitUntil, isClosed: () => closed };
}

// The connect promise is created eagerly: awaiting `once(socket, "connect")`
// after a previous socket's exchange can attach after the event already fired,
// which hangs forever. capture() also attaches before any byte can arrive.
function connectRaw(gatewayOrigin: string) {
  const socket = connect({ port: Number(new URL(gatewayOrigin).port), host: "127.0.0.1" });
  return { socket, received: capture(socket), connected: once(socket, "connect") };
}

// http.Server sockets are allowHalfOpen: once the peer sends FIN the test
// server must end its own side or server.close() waits forever, and a reset
// from a destroyed peer must not crash the run.
function upgradePeer(socket: Socket) {
  socket.on("error", () => undefined);
  socket.on("end", () => socket.end());
  return socket;
}

describe("operator gateway WebSocket upgrade boundary", () => {
  it("proxies a completed upgrade and keeps echoing bytes across a multi-second hold", async () => {
    const upstream = createServer((request, response) => {
      if (request.url === "/health") return response.end("ok");
      request.resume();
      response.writeHead(404);
      response.end();
    });
    upstream.on("upgrade", (_request, socket) => {
      upgradePeer(socket);
      socket.write("HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: echo\r\n\r\n");
      socket.on("data", (chunk) => socket.write(chunk));
    });
    const gateway = await startGateway(await listen(upstream));
    const client = connectRaw(gateway.origin);
    const received = client.received;

    try {
      await client.connected;
      client.socket.write(upgradeHandshake("/_next/hmr?id=self-next-react-debug-channel"));
      await received.waitUntil((value) => value.includes("101 Switching Protocols"));
      expect(received.text()).not.toContain("404");

      client.socket.write("ping-immediate");
      await received.waitUntil((value) => value.includes("ping-immediate"));

      // Hold the upgraded connection open for multiple seconds: the pipe must
      // outlive any gateway request/header timeout (Node detaches upgraded
      // sockets from them), which is exactly what Next's debug-channel readable
      // needs before /internal/operations hydration can complete.
      await new Promise((holdResolve) => setTimeout(holdResolve, 3_000));
      client.socket.write("ping-after-hold");
      await received.waitUntil((value) => value.includes("ping-after-hold"));

      expect(gateway.process.exitCode).toBeNull();
      // The peer may already have closed the socket (clean relay teardown);
      // awaiting 'close' on an already-closed socket would hang forever.
      const closing = received.isClosed() ? Promise.resolve() : once(client.socket, "close").catch(() => undefined);
      client.socket.destroy();
      await closing;
      expect(received.isClosed()).toBe(true);
    } finally {
      client.socket.destroy();
      await stop(gateway.process);
      await new Promise<void>((resolveClose, rejectClose) => upstream.close((error) => error ? rejectClose(error) : resolveClose()));
    }
  }, 15_000);

  it("relays an upstream refusal as a raw non-101 answer and stays healthy", async () => {
    const upstream = createServer((request, response) => {
      if (request.url === "/health") return response.end("ok");
      request.resume();
      response.writeHead(404, { "content-type": "text/plain" });
      response.end("no upgrade here");
    });
    const gateway = await startGateway(await listen(upstream));
    const client = connectRaw(gateway.origin);
    const received = client.received;

    try {
      await client.connected;
      client.socket.write(upgradeHandshake("/_next/hmr?id=no-listener"));
      await received.waitUntil((value) => value.includes("404"));
      expect(received.text()).not.toContain("Switching Protocols");
      expect(gateway.process.exitCode).toBeNull();
      expect((await fetch(`${gateway.origin}/health`)).status).toBe(200);
    } finally {
      client.socket.destroy();
      await stop(gateway.process);
      await new Promise<void>((resolveClose, rejectClose) => upstream.close((error) => error ? rejectClose(error) : resolveClose()));
    }
  }, 15_000);

  it("refuses a protected-path upgrade without credentials before contacting the upstream", async () => {
    let upgradeAttempts = 0;
    const upstream = createServer((request, response) => {
      if (request.url === "/health") return response.end("ok");
      request.resume();
      response.writeHead(404);
      response.end();
    });
    upstream.on("upgrade", (_request, socket) => {
      upgradeAttempts += 1;
      upgradePeer(socket);
      socket.write("HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: echo\r\n\r\n");
    });
    const gateway = await startGateway(await listen(upstream));
    const client = connectRaw(gateway.origin);
    const received = client.received;

    try {
      await client.connected;
      client.socket.write(upgradeHandshake("/internal/operations"));
      await received.waitUntil((value) => value.includes("401"));
      expect(received.text()).not.toContain("Switching Protocols");
      expect(received.text()).toMatch(/www-authenticate: Basic realm="Bet Stats Operator", charset="UTF-8"/i);
      expect(upgradeAttempts).toBe(0);
    } finally {
      client.socket.destroy();
      await stop(gateway.process);
      await new Promise<void>((resolveClose, rejectClose) => upstream.close((error) => error ? rejectClose(error) : resolveClose()));
    }
  }, 15_000);

  it("forwards an authenticated protected-path upgrade upstream and relays the 101", async () => {
    let upgradeAttempts = 0;
    let upgradePath: string | undefined;
    let upstreamAuthorization: string | undefined;
    const upstream = createServer((request, response) => {
      if (request.url === "/health") return response.end("ok");
      request.resume();
      response.writeHead(404);
      response.end();
    });
    upstream.on("upgrade", (request, socket) => {
      upgradeAttempts += 1;
      upgradePath = request.url;
      upstreamAuthorization = request.headers.authorization;
      upgradePeer(socket);
      socket.write("HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: echo\r\n\r\n");
    });
    const gateway = await startGateway(await listen(upstream));
    const client = connectRaw(gateway.origin);
    const received = client.received;

    try {
      await client.connected;
      client.socket.write(upgradeHandshake("/internal/operations", {
        authorization: `Basic ${Buffer.from("operator:test-password").toString("base64")}`,
      }));
      await received.waitUntil((value) => value.includes("101 Switching Protocols"));
      expect(upgradeAttempts).toBe(1);
      expect(upgradePath).toBe("/internal/operations");
      // The gateway consumed the credentials itself; they are stripped before
      // the upstream hop exactly like on the HTTP path (T-mv2-03).
      expect(upstreamAuthorization).toBeUndefined();
      expect(received.text()).not.toMatch(/www-authenticate/i);
    } finally {
      client.socket.destroy();
      await stop(gateway.process);
      await new Promise<void>((resolveClose, rejectClose) => upstream.close((error) => error ? rejectClose(error) : resolveClose()));
    }
  }, 15_000);

  it("rejects an off-origin or protocol-relative upgrade target with a raw 400 and zero upstream requests", async () => {
    const upstreamRequests: string[] = [];
    const upstream = createServer((request, response) => {
      upstreamRequests.push(request.url ?? "");
      if (request.url === "/health") return response.end("ok");
      request.resume();
      response.writeHead(404);
      response.end();
    });
    upstream.on("upgrade", (request) => {
      upstreamRequests.push(request.url ?? "");
      request.socket.on("error", () => undefined);
      request.socket.destroy();
    });
    const gateway = await startGateway(await listen(upstream));
    const protocolRelative = connectRaw(gateway.origin);
    const absoluteForm = connectRaw(gateway.origin);
    const relativeReceived = protocolRelative.received;
    const absoluteReceived = absoluteForm.received;

    try {
      await protocolRelative.connected;
      protocolRelative.socket.write("GET //evil.example/x HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: dGVzdC1rZXk=\r\nSec-WebSocket-Version: 13\r\n\r\n");
      await relativeReceived.waitUntil((value) => value.includes("400"));
      expect(relativeReceived.text()).not.toContain("Switching Protocols");

      await absoluteForm.connected;
      absoluteForm.socket.write("GET http://evil.example/x HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: dGVzdC1rZXk=\r\nSec-WebSocket-Version: 13\r\n\r\n");
      await absoluteReceived.waitUntil((value) => value.includes("400"));
      expect(absoluteReceived.text()).not.toContain("Switching Protocols");

      expect(upstreamRequests.filter((path) => path !== "/health")).toHaveLength(0);
      expect(gateway.process.exitCode).toBeNull();
    } finally {
      protocolRelative.socket.destroy();
      absoluteForm.socket.destroy();
      await stop(gateway.process);
      await new Promise<void>((resolveClose, rejectClose) => upstream.close((error) => error ? rejectClose(error) : resolveClose()));
    }
  }, 15_000);
});
