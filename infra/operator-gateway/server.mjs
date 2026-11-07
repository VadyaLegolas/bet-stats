import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { pipeline } from "node:stream";

import { authenticateBasic, isProtectedPath, signedOperatorHeaders } from "./security.mjs";

const hopByHopHeaders = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);
const operatorHeaders = new Set(["x-operator-subject", "x-operator-timestamp", "x-operator-signature", "x-operator-gateway-origin"]);
const wwwAuthenticateHeader = 'Basic realm="Bet Stats Operator", charset="UTF-8"';
const subjectPattern = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/;
const upstreamTimeoutMs = 10_000;
const requestTimeoutMs = 180_000;
const headersTimeoutMs = 10_000;
const keepAliveTimeoutMs = 5_000;

function requiredConfig(environment) {
  const names = [
    "GATEWAY_PORT",
    "WEB_ORIGIN",
    "OPERATOR_BASIC_USERNAME",
    "OPERATOR_BASIC_PASSWORD",
    "OPERATOR_SUBJECT",
    "OPERATOR_PROXY_SIGNING_SECRET",
  ];
  for (const name of names) if (!environment[name]) throw new Error(`Missing required configuration: ${name}`);

  const port = Number(environment.GATEWAY_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("GATEWAY_PORT must be an integer from 1 through 65535");

  let webOrigin;
  try {
    webOrigin = new URL(environment.WEB_ORIGIN);
  } catch {
    throw new Error("WEB_ORIGIN must be an absolute HTTP(S) origin");
  }
  if (!/^https?:$/.test(webOrigin.protocol) || webOrigin.pathname !== "/" || webOrigin.search || webOrigin.hash || webOrigin.username || webOrigin.password) {
    throw new Error("WEB_ORIGIN must be an absolute HTTP(S) origin");
  }
  if (environment.OPERATOR_PROXY_SIGNING_SECRET.length < 32) throw new Error("OPERATOR_PROXY_SIGNING_SECRET must contain at least 32 characters");
  const subject = environment.OPERATOR_SUBJECT.normalize("NFKC").trim();
  if (subject !== environment.OPERATOR_SUBJECT || !subjectPattern.test(subject)) throw new Error("OPERATOR_SUBJECT must be canonical and match the operator subject format");

  // The browser-reachable home origin: only loopback WEB_ORIGIN values may be
  // stamped downstream (nav anchors and the gateway bounce consume it). A
  // docker-internal origin (e.g. http://web:3000) yields null — nothing stamps.
  const homeOrigin = ["127.0.0.1", "localhost", "::1", "[::1]"].includes(webOrigin.hostname) ? webOrigin.origin : null;

  return {
    port,
    webOrigin: webOrigin.origin,
    homeOrigin,
    username: environment.OPERATOR_BASIC_USERNAME,
    password: environment.OPERATOR_BASIC_PASSWORD,
    subject,
    signingSecret: environment.OPERATOR_PROXY_SIGNING_SECRET,
  };
}

function requestTarget(rawTarget, webOrigin) {
  if (!rawTarget?.startsWith("/") || rawTarget.startsWith("//") || rawTarget.includes("\\")) return undefined;
  const target = new URL(rawTarget, webOrigin);
  return target.origin === webOrigin ? target : undefined;
}

function connectionHeaders(headers) {
  const value = headers.connection;
  const values = Array.isArray(value) ? value : [value];
  return values.flatMap((entry) => entry?.split(",") ?? []).map((entry) => entry.trim().toLowerCase()).filter(Boolean);
}

function forwardHeaders(headers, excluded = []) {
  const blocked = new Set([...hopByHopHeaders, ...connectionHeaders(headers), ...operatorHeaders, ...excluded]);
  const output = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value !== undefined && !blocked.has(name.toLowerCase())) output[name] = value;
  }
  return output;
}

function unauthorized(response) {
  response.writeHead(401, {
    "content-type": "application/json",
    "cache-control": "private, no-store, max-age=0",
    "www-authenticate": wwwAuthenticateHeader,
  });
  response.end(JSON.stringify({ message: "Authentication required" }));
}

function invalidTarget(response) {
  response.writeHead(400, { "content-type": "application/json", "cache-control": "no-store" });
  response.end(JSON.stringify({ message: "Invalid request target" }));
}

function unavailable(response) {
  if (response.headersSent || response.writableEnded) return response.destroy();
  response.writeHead(502, { "content-type": "application/json", "cache-control": "no-store" });
  response.end(JSON.stringify({ message: "Upstream unavailable" }));
}

function upstreamTimeout(response) {
  if (response.headersSent || response.writableEnded) return response.destroy();
  response.writeHead(504, { "content-type": "application/json", "cache-control": "no-store" });
  response.end(JSON.stringify({ message: "Upstream timed out" }));
}

// Raw socket writes for the 'upgrade' path: that handler has no ServerResponse,
// so status lines and bodies are serialized straight onto the TCP socket.
function rawSocketResponse(socket, statusLine, body, extraHeaders = {}) {
  const payload = JSON.stringify(body);
  const headers = {
    "content-type": "application/json",
    "cache-control": "no-store",
    "content-length": String(Buffer.byteLength(payload)),
    connection: "close",
    ...extraHeaders,
  };
  let raw = `HTTP/1.1 ${statusLine}\r\n`;
  for (const [name, value] of Object.entries(headers)) raw += `${name}: ${value}\r\n`;
  raw += `\r\n${payload}`;
  socket.end(raw);
}

// Unlike forwardHeaders, this deliberately KEEPS the hop-by-hop headers a
// WebSocket handshake requires (connection, upgrade, sec-websocket-*); it only
// removes the identity the HTTP path rewrites: host, authorization, and the
// spoofable x-operator-* headers (T-mv2-03).
function upgradeForwardHeaders(headers) {
  const blocked = new Set(["host", "authorization", ...operatorHeaders]);
  const output = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value !== undefined && !blocked.has(name.toLowerCase())) output[name] = value;
  }
  return output;
}

function rawHeaderBlock(rawHeaders, excluded = []) {
  const blocked = new Set(excluded);
  let block = "";
  for (let index = 0; index < rawHeaders.length; index += 2) {
    if (blocked.has(String(rawHeaders[index]).toLowerCase())) continue;
    block += `${rawHeaders[index]}: ${rawHeaders[index + 1]}\r\n`;
  }
  return block;
}

function parseCookies(header) {
  if (!header || typeof header !== "string") return {};
  const cookies = {};
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx !== -1) {
      cookies[trimmed.slice(0, eqIdx).trim()] = decodeURIComponent(trimmed.slice(eqIdx + 1).trim());
    }
  }
  return cookies;
}

function computeOperatorToken(config) {
  return createHmac("sha256", config.signingSecret)
    .update(`${config.username}:${config.password}`)
    .digest("base64url");
}

function verifyOperatorToken(token, config) {
  if (!token || typeof token !== "string" || !config.signingSecret || !config.username || !config.password) {
    return false;
  }
  const expected = computeOperatorToken(config);
  const tokenBuf = Buffer.from(token);
  const expectedBuf = Buffer.from(expected);
  if (tokenBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(tokenBuf, expectedBuf);
}

function createGateway(config) {
  const server = createServer((incoming, response) => {
    const target = requestTarget(incoming.url, config.webOrigin);
    if (!target) return invalidTarget(response);

    const protectedPath = isProtectedPath(target.pathname);
    if (protectedPath && target.searchParams.has("operator_token")) {
      const queryToken = target.searchParams.get("operator_token");
      if (verifyOperatorToken(queryToken, config)) {
        target.searchParams.delete("operator_token");
        const cleanUrl = target.pathname + (target.search ? target.search : "");
        response.writeHead(302, {
          location: cleanUrl,
          "set-cookie": `operator_session=${queryToken}; Path=/; HttpOnly; SameSite=Lax`,
          "cache-control": "private, no-store, max-age=0",
        });
        return response.end();
      }
    }

    const cookies = parseCookies(incoming.headers.cookie);
    const hasValidCookie = cookies.operator_session && verifyOperatorToken(cookies.operator_session, config);
    const hasValidBasic = authenticateBasic(incoming.headers.authorization, config.username, config.password);

    if (protectedPath && !hasValidBasic && !hasValidCookie) return unauthorized(response);

    const headers = forwardHeaders(incoming.headers, ["host", "authorization"]);
    // forwardHeaders already dropped any client-supplied value (the name is in
    // operatorHeaders), so this assignment can never produce a duplicate header.
    if (config.homeOrigin) headers["x-operator-gateway-origin"] = config.homeOrigin;
    if (protectedPath) Object.assign(headers, signedOperatorHeaders({
      subject: config.subject,
      secret: config.signingSecret,
      method: incoming.method ?? "GET",
      pathname: target.pathname,
      search: target.search,
      timestamp: new Date().toISOString(),
    }));

    const upstreamRequest = (target.protocol === "https:" ? httpsRequest : httpRequest)(target, {
      method: incoming.method,
      headers,
    }, (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode ?? 502, forwardHeaders(upstreamResponse.headers));
      pipeline(upstreamResponse, response, (error) => {
        if (error && !response.destroyed) unavailable(response);
      });
    });

    let timedOut = false;
    const destroyUpstream = () => {
      if (!upstreamRequest.destroyed) upstreamRequest.destroy();
    };
    incoming.once("aborted", destroyUpstream);
    response.once("close", () => {
      if (!response.writableEnded) destroyUpstream();
    });
    upstreamRequest.setTimeout(upstreamTimeoutMs, () => {
      timedOut = true;
      upstreamTimeout(response);
      destroyUpstream();
    });
    upstreamRequest.once("error", () => {
      if (!timedOut) unavailable(response);
    });
    incoming.pipe(upstreamRequest);
  });

  // WebSocket upgrades (e.g. Next dev's HMR/debug-channel socket) traverse the
  // same target + Basic-auth gates as the HTTP path before any upstream socket
  // is opened (T-mv2-01, T-mv2-02), then the handshake is relayed verbatim.
  server.on("upgrade", (incoming, socket, head) => {
    // A reset during a raw handshake must never crash the gateway process.
    socket.on("error", () => socket.destroy());

    const target = requestTarget(incoming.url, config.webOrigin);
    if (!target) {
      return rawSocketResponse(socket, "400 Bad Request", { message: "Invalid request target" });
    }

    const protectedPath = isProtectedPath(target.pathname);
    const cookies = parseCookies(incoming.headers.cookie);
    const hasValidCookie = cookies.operator_session && verifyOperatorToken(cookies.operator_session, config);
    const hasValidBasic = authenticateBasic(incoming.headers.authorization, config.username, config.password);
    if (protectedPath && !hasValidBasic && !hasValidCookie) {
      return rawSocketResponse(socket, "401 Unauthorized", { message: "Authentication required" }, { "www-authenticate": wwwAuthenticateHeader });
    }

    const headers = upgradeForwardHeaders(incoming.headers);
    const upstreamRequest = (target.protocol === "https:" ? httpsRequest : httpRequest)(target, { method: "GET", headers });

    let settled = false;
    let handshakeTimer;
    const settle = () => {
      settled = true;
      clearTimeout(handshakeTimer);
    };

    handshakeTimer = setTimeout(() => {
      if (settled) return;
      settle();
      socket.destroy();
      if (!upstreamRequest.destroyed) upstreamRequest.destroy();
    }, upstreamTimeoutMs);

    socket.once("close", () => {
      if (settled) return;
      settle();
      if (!upstreamRequest.destroyed) upstreamRequest.destroy();
    });

    // Node emits 'upgrade' only for a real 101 from the upstream.
    upstreamRequest.on("upgrade", (upstreamResponse, upstreamSocket, upstreamHead) => {
      if (settled) {
        upstreamSocket.destroy();
        return;
      }
      settle();
      socket.write(`HTTP/1.1 ${upstreamResponse.statusCode} ${upstreamResponse.statusMessage}\r\n${rawHeaderBlock(upstreamResponse.rawHeaders)}\r\n`);
      if (head.length > 0) upstreamSocket.write(head);
      if (upstreamHead.length > 0) socket.write(upstreamHead);
      const destroyPeer = (peer) => {
        if (!peer.destroyed) peer.destroy();
      };
      socket.once("error", () => destroyPeer(upstreamSocket));
      // 'close' alone is not enough: http.Server sockets are allowHalfOpen, so
      // a client FIN defers 'close' indefinitely and the upstream would be
      // orphaned — the plan's "one side's reset cannot orphan the other".
      socket.once("end", () => destroyPeer(upstreamSocket));
      socket.once("close", () => destroyPeer(upstreamSocket));
      upstreamSocket.once("error", () => destroyPeer(socket));
      upstreamSocket.once("close", () => destroyPeer(socket));
      socket.pipe(upstreamSocket);
      upstreamSocket.pipe(socket);
    });

    // The upstream refused the upgrade (e.g. a plain 404): relay its answer
    // verbatim and end the socket — never a partial 101 (fail closed).
    upstreamRequest.on("response", (upstreamResponse) => {
      if (settled) {
        upstreamResponse.resume();
        return;
      }
      settle();
      upstreamResponse.on("error", () => socket.destroy());
      socket.write(`HTTP/1.1 ${upstreamResponse.statusCode} ${upstreamResponse.statusMessage}\r\n${rawHeaderBlock(upstreamResponse.rawHeaders, ["transfer-encoding", "connection"])}\r\n`);
      upstreamResponse.pipe(socket);
    });

    upstreamRequest.on("error", () => {
      if (settled) return;
      settle();
      socket.destroy();
    });

    upstreamRequest.end();
  });

  return server;
}

function main() {
  const config = requiredConfig(process.env);
  const gateway = createGateway(config);
  gateway.requestTimeout = requestTimeoutMs;
  gateway.headersTimeout = headersTimeoutMs;
  gateway.keepAliveTimeout = keepAliveTimeoutMs;
  gateway.listen(config.port, "0.0.0.0");
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : "Gateway configuration error"}\n`);
  process.exitCode = 1;
}
