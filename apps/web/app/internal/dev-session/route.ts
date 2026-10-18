import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server.js";

import {
  createPrivacySessionAssertion,
  createTrustedSessionAssertion,
} from "../../internal-api/privacy/[[...path]]/route";

/** Development-only issuer for the authenticated session boundary. The privacy
 * page (/privacy) requires an HMAC-signed auth_session normally issued by an
 * account system, and the MVP ships no account system — so without this route
 * the page can only answer «Хранение истории недоступно» and the privacy proxy
 * 400s on every load (the phase-06 review finding "no demonstrated issuer for
 * the required trusted credential"). An operator opts in per run with
 * DEV_TRUSTED_SESSION_ISSUER=1 plus both signing secrets in the environment;
 * without the flag this route is a plain 404, exactly like an unknown path, so
 * a deployment that never sets the variable exposes nothing. Identity is never
 * taken from the request — the subject is a fixed dev constant, so the route
 * cannot be used to impersonate any account. Each visit mints a fresh dev
 * identity (dev-local-subject-<random>): withdrawal permanently locks a
 * retention subject by design — exactly as in production — so a fresh subject
 * keeps local experimentation working without weakening that rule. Both dev
 * cookies share one long 30-day lifetime on purpose: the production
 * POST /internal-api/privacy/session deliberately caps the privacy credential
 * at 15 minutes and re-minting it belongs to the account layer the MVP lacks,
 * so the dev issuer keeps the pair alive long enough to never interrupt local
 * work (the proxy validates the privacy claims against the trusted session,
 * not their relative expiries). */
const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60_000;
const privateHeaders = { "cache-control": "private, no-store, max-age=0" };

export async function GET(request: NextRequest) {
  if (process.env.DEV_TRUSTED_SESSION_ISSUER !== "1") {
    return NextResponse.json({ code: "NOT_FOUND" }, { status: 404, headers: privateHeaders });
  }
  const authSecret = process.env.AUTH_SESSION_SIGNING_SECRET;
  const privacySecret = process.env.PRIVACY_SESSION_SIGNING_SECRET;
  const missing: string[] = [];
  if (!authSecret || authSecret.length < 32) missing.push("AUTH_SESSION_SIGNING_SECRET");
  if (!privacySecret || privacySecret.length < 32) missing.push("PRIVACY_SESSION_SIGNING_SECRET");
  if (missing.length > 0) {
    return NextResponse.json({ code: "DEV_ISSUER_MISCONFIGURED", missing }, { status: 503, headers: privateHeaders });
  }
  const issuedAt = Date.now();
  const expiresAt = issuedAt + SESSION_LIFETIME_MS;
  const subjectId = `dev-local-subject-${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const sessionId = `session_dev_${randomUUID().replace(/-/g, "")}`;
  const response = NextResponse.redirect(new URL("/privacy", request.url), 302);
  const cookieOptions = { httpOnly: true, secure: true, sameSite: "lax", path: "/" } as const;
  const maxAge = Math.floor(SESSION_LIFETIME_MS / 1000);
  response.cookies.set("auth_session", createTrustedSessionAssertion({ secret: authSecret!, subjectId, sessionId, expiresAt }), { ...cookieOptions, maxAge });
  response.cookies.set("privacy_session", createPrivacySessionAssertion({ secret: privacySecret!, subjectId, sessionId, expiresAt }), { ...cookieOptions, maxAge });
  return response;
}

export const dynamic = "force-dynamic";
