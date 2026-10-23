import { createHash, createHmac } from "node:crypto";

import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GET, POST } from "./route.js";

const secret = "operations-signing-secret-that-is-long-enough";
const subject = "ops@example.com";
const credential = "operator-credential-long-enough";

function queryDigest(search: string): string {
  const pairs = [...new URLSearchParams(search).entries()].sort(([leftKey, leftValue], [rightKey, rightValue]) => leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue));
  return createHash("sha256").update(new URLSearchParams(pairs).toString(), "utf8").digest("base64url");
}

function sign(method: string, pathname: string, search = "", at = new Date()): string {
  return createHmac("sha256", secret).update(`${subject}\n${at.toISOString()}\n${method}\n${pathname}\n${queryDigest(search)}`, "utf8").digest("base64url");
}

function signedRequest(pathname: string, method: "GET" | "POST", signatureMethod = method): NextRequest {
  const at = new Date();
  return new NextRequest(`http://web.test${pathname}`, { method, headers: { "x-operator-subject": subject, "x-operator-timestamp": at.toISOString(), "x-operator-signature": sign(signatureMethod, pathname, "", at) } });
}

const context = (path: string[]) => ({ params: Promise.resolve({ path }) });

function stubEnvironment() {
  process.env.OPERATOR_PROXY_SIGNING_SECRET = secret;
  process.env.OPERATOR_AUTHORIZED_SUBJECTS = subject;
  process.env.OPERATOR_CREDENTIAL = credential;
}

describe("operations proxy POST passthrough", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    delete process.env.OPERATOR_PROXY_SIGNING_SECRET;
    delete process.env.OPERATOR_AUTHORIZED_SUBJECTS;
    delete process.env.OPERATOR_CREDENTIAL;
  });

  it("forwards a signed POST to the upstream with method POST and the operator credential", async () => {
    stubEnvironment();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ queued: true }), { status: 202, headers: { "content-type": "application/json; charset=utf-8" } }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(signedRequest("/internal-api/operations/backups/run", "POST"), context(["backups", "run"]));

    expect(response.status).toBe(202);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]! as unknown as [URL, RequestInit & { method: string; headers: Record<string, string> }];
    expect(init.method).toBe("POST");
    expect(String(url)).toContain("/internal/operations/backups/run");
    expect(init.headers["x-operator-credential"]).toBe(credential);
    expect(init.headers["x-operator-actor"]).toBe(subject);
  });

  it("denies a POST whose signature was computed for a different method — same 404 as any invalid signature, no upstream call", async () => {
    stubEnvironment();
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(signedRequest("/internal-api/operations/backups/drill", "POST", "GET"), context(["backups", "drill"]));

    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the existing signed GET passthrough unchanged", async () => {
    stubEnvironment();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ readiness: "READY" }), { status: 200, headers: { "content-type": "application/json; charset=utf-8" } }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(signedRequest("/internal-api/operations/overview", "GET"), context(["overview"]));

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]! as unknown as [URL, RequestInit & { method: string }];
    expect(init.method).toBe("GET");
    expect(String(url)).toContain("/internal/operations/overview");
  });
});
