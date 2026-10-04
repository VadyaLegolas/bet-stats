import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createPrivacySessionAssertion, createTrustedSessionAssertion, proxy } from "./route.js";

const authSecret = "auth-session-test-secret-must-be-32-bytes";
const privacySecret = "privacy-session-test-secret-must-be-32-bytes";
const assertionSecret = "privacy-assertion-test-secret-32-bytes";
const expiresAt = Date.now() + 60_000;
const trusted = (subjectId = "owner-subject", sessionId = "session_abcdefgh") => createTrustedSessionAssertion({ secret: authSecret, subjectId, sessionId, expiresAt });
const privacy = (subjectId = "owner-subject", sessionId = "session_abcdefgh", expiry = expiresAt) => createPrivacySessionAssertion({ secret: privacySecret, subjectId, sessionId, expiresAt: expiry });
const context = (path: string[]) => ({ params: Promise.resolve({ path }) });

describe("privacy proxy trusted session boundary", () => {
  it("issues a short-lived secure privacy cookie only from a trusted authenticated session", async () => {
    process.env.AUTH_SESSION_SIGNING_SECRET = authSecret; process.env.PRIVACY_SESSION_SIGNING_SECRET = privacySecret;
    const response = await proxy(new NextRequest("http://web.test/internal-api/privacy/session", { method: "POST", headers: { cookie: `auth_session=${trusted()}` } }), context(["session"]));
    expect(response.status).toBe(201); expect(response.headers.get("set-cookie")).toContain("HttpOnly"); expect(response.headers.get("set-cookie")).toContain("Secure");
  });
  it.each(["privacy_session=bad", `privacy_session=${privacy("owner-subject", "session_abcdefgh", Date.now() - 1)}`])("rejects invalid or expired privacy credentials", async (cookie) => {
    process.env.AUTH_SESSION_SIGNING_SECRET = authSecret; process.env.PRIVACY_SESSION_SIGNING_SECRET = privacySecret; process.env.PRIVACY_SUBJECT_SIGNING_SECRET = assertionSecret;
    const response = await proxy(new NextRequest("http://web.test/internal-api/privacy/status", { headers: { cookie: `${cookie}; auth_session=${trusted()}` } }), context(["status"])); expect(response.status).toBe(400);
  });
  it("refuses a privacy credential from another authenticated subject/session", async () => {
    process.env.AUTH_SESSION_SIGNING_SECRET = authSecret; process.env.PRIVACY_SESSION_SIGNING_SECRET = privacySecret; process.env.PRIVACY_SUBJECT_SIGNING_SECRET = assertionSecret;
    const response = await proxy(new NextRequest("http://web.test/internal-api/privacy/status", { headers: { cookie: `auth_session=${trusted("victim-subject", "session_victim12")}; privacy_session=${privacy()}` } }), context(["status"])); expect(response.status).toBe(400);
  });
  it("accepts matching trusted and privacy credentials", async () => {
    process.env.AUTH_SESSION_SIGNING_SECRET = authSecret; process.env.PRIVACY_SESSION_SIGNING_SECRET = privacySecret; process.env.PRIVACY_SUBJECT_SIGNING_SECRET = assertionSecret;
    globalThis.fetch = vi.fn(async () => new Response("{}", { headers: { "content-type": "application/json" } }));
    const response = await proxy(new NextRequest("http://web.test/internal-api/privacy/status", { headers: { cookie: `auth_session=${trusted()}; privacy_session=${privacy()}`, "x-privacy-subject": "victim-subject" } }), context(["status"])); expect(response.status).toBe(200); expect(globalThis.fetch).toHaveBeenCalledOnce();
  });
});
