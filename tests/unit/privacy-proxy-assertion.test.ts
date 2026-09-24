import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { signedEnvironmentSubjectProvider } from "../../apps/api/src/modules/privacy/privacy.service.js";
import { canonicalPrivacyRequestBody, createPrivacyProxyAssertion, createPrivacySessionAssertion, proxy, resolvePrivacySessionSubject } from "../../apps/web/app/internal-api/privacy/[[...path]]/route.js";

describe("privacy trusted proxy assertion", () => {
  it("derives the privacy subject only from a signed server session, never a caller header", () => {
    const sessionSecret = "privacy-session-test-secret-32-bytes";
    const session = createPrivacySessionAssertion({ secret: sessionSecret, subjectId: "owner-subject" });

    expect(resolvePrivacySessionSubject(`privacy_session=${session}`, sessionSecret)).toBe("owner-subject");
    expect(resolvePrivacySessionSubject("privacy_session=not-a-valid-session", sessionSecret)).toBeNull();
    expect(resolvePrivacySessionSubject(undefined, sessionSecret)).toBeNull();
  });

  it("keeps a caller-selected withdrawal subject from replacing the authenticated session", () => {
    const sessionSecret = "privacy-session-test-secret-32-bytes";
    const session = createPrivacySessionAssertion({ secret: sessionSecret, subjectId: "owner-subject" });
    const attackerHeader = "victim-subject";

    expect(attackerHeader).not.toBe(resolvePrivacySessionSubject(`privacy_session=${session}`, sessionSecret));
  });

  it("normalizes empty and formatted JSON POST bodies before signing", () => {
    expect(canonicalPrivacyRequestBody("")).toBe("{}");
    expect(canonicalPrivacyRequestBody("  \n")).toBe("{}");
    expect(canonicalPrivacyRequestBody('{ "resourceType": "RESULT", "resourceId": "fixture-1" }')).toBe('{"resourceType":"RESULT","resourceId":"fixture-1"}');
    expect(canonicalPrivacyRequestBody("not-json")).toBeNull();
  });

  it.each([
    ["consent", "", "{}"],
    ["withdrawal", "", "{}"],
    ["history/view", '{ "resourceType": "RESULT", "resourceId": "fixture-1" }', '{"resourceType":"RESULT","resourceId":"fixture-1"}'],
  ])("forwards canonical signed POST body for %s", async (path, rawBody, expectedBody) => {
    const subjectId = "owner-subject";
    const sessionSecret = "privacy-session-test-secret-32-bytes";
    const signingSecret = "privacy-assertion-test-secret-32-bytes";
    const previous = { session: process.env.PRIVACY_SESSION_SIGNING_SECRET, signing: process.env.PRIVACY_SUBJECT_SIGNING_SECRET, origin: process.env.API_ORIGIN, fetch: globalThis.fetch };
    const calls: Array<{ url: string; init: RequestInit }> = [];
    process.env.PRIVACY_SESSION_SIGNING_SECRET = sessionSecret;
    process.env.PRIVACY_SUBJECT_SIGNING_SECRET = signingSecret;
    process.env.API_ORIGIN = "http://privacy.test";
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => { calls.push({ url: String(url), init: init ?? {} }); return new Response("{}", { headers: { "content-type": "application/json" } }); });
    try {
      const session = createPrivacySessionAssertion({ secret: sessionSecret, subjectId });
      await proxy(new NextRequest(`http://web.test/internal-api/privacy/${path}`, { method: "POST", headers: { cookie: `privacy_session=${session}`, "x-privacy-subject": "victim-subject" }, body: rawBody }), { params: Promise.resolve({ path: path.split("/") }) });
      expect(calls).toHaveLength(1);
      expect(calls[0]?.init.body).toBe(expectedBody);
      const headers = calls[0]?.init.headers as Headers;
      const provider = signedEnvironmentSubjectProvider({ consume: async () => true });
      await expect(provider.resolve({ method: "POST", originalUrl: new URL(calls[0]!.url).pathname, body: JSON.parse(expectedBody), headers: Object.fromEntries(headers.entries()) })).resolves.toMatchObject({ subjectId });
    } finally {
      if (previous.session === undefined) delete process.env.PRIVACY_SESSION_SIGNING_SECRET; else process.env.PRIVACY_SESSION_SIGNING_SECRET = previous.session;
      if (previous.signing === undefined) delete process.env.PRIVACY_SUBJECT_SIGNING_SECRET; else process.env.PRIVACY_SUBJECT_SIGNING_SECRET = previous.signing;
      if (previous.origin === undefined) delete process.env.API_ORIGIN; else process.env.API_ORIGIN = previous.origin;
      globalThis.fetch = previous.fetch;
    }
  });

  it("binds method, path, body and consumes a nonce exactly once", async () => {
    const secret = "privacy-assertion-test-secret-32-bytes";
    process.env.PRIVACY_SUBJECT_SIGNING_SECRET = secret;
    const used = new Set<string>();
    const provider = signedEnvironmentSubjectProvider({ consume: async (nonce) => used.has(nonce) ? false : (used.add(nonce), true) });
    const timestamp = new Date().toISOString(), nonce = randomUUID(), body = "{}", pathname = "/privacy/consent";
    const signature = createPrivacyProxyAssertion({ secret, subjectId: "subject-1", timestamp, nonce, method: "POST", pathname, body });
    const request = { method: "POST", originalUrl: pathname, body: {}, headers: { "x-privacy-subject": "subject-1", "x-privacy-timestamp": timestamp, "x-privacy-nonce": nonce, "x-privacy-signature": signature } };
    await expect(provider.resolve(request)).resolves.toMatchObject({ subjectId: "subject-1" });
    await expect(provider.resolve(request)).resolves.toBeNull();
  });

  it("rejects an assertion replayed against another endpoint or body", async () => {
    const secret = "privacy-assertion-test-secret-32-bytes";
    process.env.PRIVACY_SUBJECT_SIGNING_SECRET = secret;
    const timestamp = new Date().toISOString(), nonce = randomUUID();
    const signature = createPrivacyProxyAssertion({ secret, subjectId: "subject-1", timestamp, nonce, method: "GET", pathname: "/privacy/status", body: "" });
    const provider = signedEnvironmentSubjectProvider({ consume: async () => true });
    await expect(provider.resolve({ method: "POST", originalUrl: "/privacy/withdrawal", body: {}, headers: { "x-privacy-subject": "subject-1", "x-privacy-timestamp": timestamp, "x-privacy-nonce": nonce, "x-privacy-signature": signature } })).resolves.toBeNull();
  });
});
