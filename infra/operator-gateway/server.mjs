import { createServer } from "node:http";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

import { authenticateBasic, isProtectedReplayPath, signedOperatorHeaders, stripOperatorHeaders } from "./security.mjs";

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

  return {
    port,
    webOrigin: webOrigin.origin,
    username: environment.OPERATOR_BASIC_USERNAME,
    password: environment.OPERATOR_BASIC_PASSWORD,
    subject: environment.OPERATOR_SUBJECT,
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

function forwardHeaders(headers) {
  const excluded = new Set([...hopByHopHeaders, ...connectionHeaders(headers), "host", "authorization"]);
  const sanitized = stripOperatorHeaders(headers);
  const output = {};
  for (const [name, value] of sanitized.entries()) if (!excluded.has(name)) output[name] = value;
  return output;
}

function unauthorized(response) {
  response.writeHead(401, {
    "content-type": "application/json",
    "cache-control": "private, no-store, max-age=0",
    "www-authenticate": 'Basic realm="Bet Stats Operator", charset="UTF-8"',
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

function createGateway(config) {
  return createServer((incoming, response) => {
    const target = requestTarget(incoming.url, config.webOrigin);
    if (!target) return invalidTarget(response);

    const protectedPath = isProtectedReplayPath(target.pathname);
    if (protectedPath && !authenticateBasic(incoming.headers.authorization, config.username, config.password)) return unauthorized(response);

    const headers = forwardHeaders(incoming.headers);
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
      upstreamResponse.pipe(response);
    });

    const destroyUpstream = () => {
      if (!upstreamRequest.destroyed) upstreamRequest.destroy();
    };
    incoming.once("aborted", destroyUpstream);
    response.once("close", () => {
      if (!response.writableEnded) destroyUpstream();
    });
    upstreamRequest.once("error", () => unavailable(response));
    incoming.pipe(upstreamRequest);
  });
}

function main() {
  const config = requiredConfig(process.env);
  const gateway = createGateway(config);
  gateway.listen(config.port, "0.0.0.0");
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : "Gateway configuration error"}\n`);
  process.exitCode = 1;
}
