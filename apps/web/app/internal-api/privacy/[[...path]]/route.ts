import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

const privateHeaders = { "cache-control": "private, no-store, max-age=0" };
const SUBJECT = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/;

export function createPrivacyProxyAssertion(input: { secret: string; subjectId: string; timestamp: string; nonce: string; method: string; pathname: string; body: string }) {
  const bodyDigest = createHash("sha256").update(input.body).digest("base64url");
  const canonical = [input.subjectId, input.timestamp, input.nonce, input.method.toUpperCase(), input.pathname, bodyDigest].join("\n");
  return createHmac("sha256", input.secret).update(canonical).digest("base64url");
}

type SessionClaims = Readonly<{ subjectId: string; sessionId: string; version: number; expiresAt: number }>;

function signedSession(input: { secret: string; claims: SessionClaims; purpose: string }): string {
  const payload = Buffer.from(JSON.stringify(input.claims)).toString("base64url");
  const signature = createHmac("sha256", input.secret).update(`${input.purpose}\n${payload}`).digest("base64url");
  return `${payload}.${signature}`;
}

function parseSignedSession(input: { cookieHeader: string | undefined; name: string; secret: string; purpose: string; now?: number }): SessionClaims | null {
  const cookie = input.cookieHeader?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${input.name}=`));
  const value = cookie?.slice(`${input.name}=`.length);
  const separator = value?.lastIndexOf(".") ?? -1;
  if (!value || separator <= 0) return null;
  const payload = value.slice(0, separator), signature = value.slice(separator + 1);
  if (!/^[A-Za-z0-9_-]+$/.test(payload) || !/^[A-Za-z0-9_-]{43}$/.test(signature)) return null;
  const expected = Buffer.from(createHmac("sha256", input.secret).update(`${input.purpose}\n${payload}`).digest("base64url"));
  const presented = Buffer.from(signature);
  if (expected.length !== presented.length || !timingSafeEqual(expected, presented)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as SessionClaims;
    return SUBJECT.test(claims.subjectId) && /^[A-Za-z0-9_-]{8,128}$/.test(claims.sessionId) && Number.isInteger(claims.version) && claims.version >= 0 && Number.isFinite(claims.expiresAt) && claims.expiresAt > (input.now ?? Date.now()) ? claims : null;
  } catch { return null; }
}

/** Used by the authenticated session boundary; never accept a caller header as identity. */
export function createTrustedSessionAssertion(input: { secret: string; subjectId: string; sessionId: string; version?: number; expiresAt: number }): string {
  return signedSession({ secret: input.secret, purpose: "trusted-session", claims: { subjectId: input.subjectId, sessionId: input.sessionId, version: input.version ?? 0, expiresAt: input.expiresAt } });
}

export function createPrivacySessionAssertion(input: { secret: string; subjectId: string; sessionId: string; version?: number; expiresAt: number }): string {
  return signedSession({ secret: input.secret, purpose: "privacy-session", claims: { subjectId: input.subjectId, sessionId: input.sessionId, version: input.version ?? 0, expiresAt: input.expiresAt } });
}

export function resolvePrivacySessionSubject(cookieHeader: string | undefined, secret: string, trusted?: SessionClaims): string | null {
  const cookie = cookieHeader?.split(";").map((part) => part.trim()).find((part) => part.startsWith("privacy_session="));
  const claims = parseSignedSession({ cookieHeader, name: "privacy_session", secret, purpose: "privacy-session" });
  return claims && (!trusted || (claims.subjectId === trusted.subjectId && claims.sessionId === trusted.sessionId && claims.version === trusted.version)) ? claims.subjectId : null;
}

export function privacySessionCookie(value: string, expiresAt: number): string {
  return `privacy_session=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.max(0, Math.floor((expiresAt - Date.now()) / 1000))}`;
}

export function canonicalPrivacyRequestBody(rawBody: string): string | null {
  if (rawBody.trim() === "") return "{}";
  try {
    const parsed: unknown = JSON.parse(rawBody);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? JSON.stringify(parsed) : null;
  } catch {
    return null;
  }
}

export async function proxy(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  const { path = [] } = await context.params;
  if (path.some((segment) => !/^[A-Za-z0-9_-]{1,64}$/.test(segment))) return NextResponse.json({ code: "NOT_FOUND" }, { status: 404, headers: privateHeaders });
  const upstream = new URL(`/privacy/${path.map(encodeURIComponent).join("/")}`, process.env.API_ORIGIN ?? "http://127.0.0.1:3001");
  const sessionSecret = process.env.PRIVACY_SESSION_SIGNING_SECRET;
  const authSessionSecret = process.env.AUTH_SESSION_SIGNING_SECRET;
  const secret = process.env.PRIVACY_SUBJECT_SIGNING_SECRET;
  const cookieHeader = request.headers.get("cookie") ?? undefined;
  const trusted = authSessionSecret && authSessionSecret.length >= 32 ? parseSignedSession({ cookieHeader, name: "auth_session", secret: authSessionSecret, purpose: "trusted-session" }) : null;
  if (path.length === 1 && path[0] === "session" && request.method === "POST" && trusted && sessionSecret && sessionSecret.length >= 32) {
    const expiresAt = Math.min(trusted.expiresAt, Date.now() + 15 * 60_000);
    const value = createPrivacySessionAssertion({ secret: sessionSecret, ...trusted, expiresAt });
    return NextResponse.json({ expiresAt: new Date(expiresAt).toISOString() }, { status: 201, headers: { ...privateHeaders, "set-cookie": privacySessionCookie(value, expiresAt) } });
  }
  const subjectId = sessionSecret && sessionSecret.length >= 32 && trusted ? resolvePrivacySessionSubject(cookieHeader, sessionSecret, trusted) : null;
  if (!subjectId || !secret || secret.length < 32) return NextResponse.json({ code: "SUBJECT_IDENTITY_UNAVAILABLE" }, { status: 400, headers: privateHeaders });
  const body = request.method === "POST" ? canonicalPrivacyRequestBody(await request.text()) : "";
  if (body === null) return NextResponse.json({ code: "INVALID_PRIVACY_BODY" }, { status: 400, headers: privateHeaders });
  const timestamp = new Date().toISOString();
  const nonce = randomUUID();
  const headers = new Headers({
    "content-type": "application/json",
    "x-privacy-subject": subjectId,
    "x-privacy-timestamp": timestamp,
    "x-privacy-nonce": nonce,
    "x-privacy-signature": createPrivacyProxyAssertion({ secret, subjectId, timestamp, nonce, method: request.method, pathname: upstream.pathname, body }),
  });
  const response = await fetch(upstream, { method: request.method, headers, ...(request.method === "POST" ? { body } : {}), cache: "no-store" });
  return new NextResponse(response.body, { status: response.status, headers: { "content-type": response.headers.get("content-type") ?? "application/json", ...privateHeaders } });
}

export const GET = proxy;
export const POST = proxy;
