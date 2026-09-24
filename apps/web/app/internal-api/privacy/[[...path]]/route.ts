import { createHash, createHmac, randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

const privateHeaders = { "cache-control": "private, no-store, max-age=0" };
const SUBJECT = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/;

export function createPrivacyProxyAssertion(input: { secret: string; subjectId: string; timestamp: string; nonce: string; method: string; pathname: string; body: string }) {
  const bodyDigest = createHash("sha256").update(input.body).digest("base64url");
  const canonical = [input.subjectId, input.timestamp, input.nonce, input.method.toUpperCase(), input.pathname, bodyDigest].join("\n");
  return createHmac("sha256", input.secret).update(canonical).digest("base64url");
}

async function proxy(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  const { path = [] } = await context.params;
  if (path.some((segment) => !/^[A-Za-z0-9_-]{1,64}$/.test(segment))) return NextResponse.json({ code: "NOT_FOUND" }, { status: 404, headers: privateHeaders });
  const upstream = new URL(`/privacy/${path.map(encodeURIComponent).join("/")}`, process.env.API_ORIGIN ?? "http://127.0.0.1:3001");
  const subjectId = request.headers.get("x-privacy-subject");
  const secret = process.env.PRIVACY_SUBJECT_SIGNING_SECRET;
  if (!subjectId || !SUBJECT.test(subjectId) || !secret || secret.length < 32) return NextResponse.json({ code: "SUBJECT_IDENTITY_UNAVAILABLE" }, { status: 400, headers: privateHeaders });
  const body = request.method === "POST" ? await request.text() : "";
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
