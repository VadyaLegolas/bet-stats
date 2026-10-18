import { createHmac } from "node:crypto";

import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { GET } from "./route.js";

const authSecret = "dev-issuer-auth-secret-must-be-32-bytes";
const privacySecret = "dev-issuer-privacy-secret-must-be-32-bytes";

const cookieValue = (setCookie: string, name: string) => setCookie.slice(`${name}=`.length).split(";")[0]!;
const splitSigned = (value: string) => ({ payload: value.slice(0, value.lastIndexOf(".")), signature: value.slice(value.lastIndexOf(".") + 1) });
const verify = (value: string, secret: string, purpose: string) => {
  const { payload, signature } = splitSigned(value);
  const expected = createHmac("sha256", secret).update(`${purpose}\n${payload}`).digest("base64url");
  expect(signature).toBe(expected);
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
};
const request = () => new NextRequest("http://web.test/internal/dev-session");

describe("development trusted-session issuer", () => {
  it("stays a plain 404 unless the operator opts in for the run", async () => {
    delete process.env.DEV_TRUSTED_SESSION_ISSUER;
    const response = await GET(request());
    expect(response.status).toBe(404);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("names the missing signing secrets when opted in without an environment", async () => {
    process.env.DEV_TRUSTED_SESSION_ISSUER = "1";
    delete process.env.AUTH_SESSION_SIGNING_SECRET;
    delete process.env.PRIVACY_SESSION_SIGNING_SECRET;
    const response = await GET(request());
    expect(response.status).toBe(503);
    const payload = await response.json() as { code: string; missing: string[] };
    expect(payload.code).toBe("DEV_ISSUER_MISCONFIGURED");
    expect(payload.missing).toEqual(expect.arrayContaining(["AUTH_SESSION_SIGNING_SECRET", "PRIVACY_SESSION_SIGNING_SECRET"]));
  });

  it("issues matching signed session cookies for the fixed dev subject and redirects to /privacy", async () => {
    process.env.DEV_TRUSTED_SESSION_ISSUER = "1";
    process.env.AUTH_SESSION_SIGNING_SECRET = authSecret;
    process.env.PRIVACY_SESSION_SIGNING_SECRET = privacySecret;
    const response = await GET(request());
    expect(response.status).toBe(302);
    expect(new URL(response.headers.get("location")!).pathname).toBe("/privacy");
    const setCookies = response.headers.getSetCookie();
    const authCookie = setCookies.find((cookie) => cookie.startsWith("auth_session="));
    const privacyCookie = setCookies.find((cookie) => cookie.startsWith("privacy_session="));
    for (const cookie of [authCookie, privacyCookie]) {
      expect(cookie).toContain("HttpOnly");
      expect(cookie).toContain("Secure");
      expect(cookie).toContain("SameSite=lax");
    }
    const trusted = verify(cookieValue(authCookie!, "auth_session"), authSecret, "trusted-session");
    const privacy = verify(cookieValue(privacyCookie!, "privacy_session"), privacySecret, "privacy-session");
    expect(trusted.subjectId).toBe("dev-local-subject");
    // The proxy rejects a privacy credential whose claims diverge from the trusted
    // session, so both cookies must carry the same subject, session and version.
    expect(privacy.subjectId).toBe(trusted.subjectId);
    expect(privacy.sessionId).toBe(trusted.sessionId);
    expect(privacy.version).toBe(trusted.version);
    expect(Number(trusted.expiresAt)).toBeGreaterThan(Date.now());
    expect(Number(privacy.expiresAt)).toBeLessThanOrEqual(Number(trusted.expiresAt));
  });
});
