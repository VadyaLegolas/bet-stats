import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

const privateHeaders = { "cache-control": "private, no-store, max-age=0" };
const SUBJECT = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/;

export function createPrivacyProxyAssertion(input: { secret: string; subjectId: string; timestamp: string; nonce: string; method: string; pathname: string; body: string }) {
  const bodyDigest = createHash("sha256").update(input.body).digest("base64url");
  const canonical = [input.subjectId, input.timestamp, input.nonce, input.method.toUpperCase(), input.pathname, bodyDigest].join("\n");
  return createHmac("sha256", input.secret).update(canonical).digest("base64url");
}

/**
 * The authentication provider owns issuing this cookie after authenticating the
 * browser. The proxy only verifies it; a request header is never an identity.
 */
export function createPrivacySessionAssertion(input: { secret: string; subjectId: string }): string {
  const signature = createHmac("sha256", input.secret).update(`privacy-session\n${input.subjectId}`).digest("base64url");
  return `${input.subjectId}.${signature}`;
}

export function resolvePrivacySessionSubject(cookieHeader: string | undefined, secret: string): string | null {
  const cookie = cookieHeader?.split(";").map((part) => part.trim()).find((part) => part.startsWith("privacy_session="));
  const value = cookie?.slice("privacy_session=".length);
  if (!value) return null;
  const separator = value.lastIndexOf(".");
  const subjectId = separator > 0 ? value.slice(0, separator) : "";
  const signature = separator > 0 ? value.slice(separator + 1) : "";
  if (!SUBJECT.test(subjectId) || !/^[A-Za-z0-9_-]{43}$/.test(signature)) return null;
  const expected = Buffer.from(createPrivacySessionAssertion({ secret, subjectId }).slice(separator + 1));
  const presented = Buffer.from(signature);
  return expected.length === presented.length && timingSafeEqual(expected, presented) ? subjectId : null;
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
  const secret = process.env.PRIVACY_SUBJECT_SIGNING_SECRET;
  const subjectId = sessionSecret && sessionSecret.length >= 32 ? resolvePrivacySessionSubject(request.headers.get("cookie") ?? undefined, sessionSecret) : null;
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
