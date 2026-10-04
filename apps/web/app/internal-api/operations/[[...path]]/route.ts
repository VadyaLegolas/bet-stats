import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

const PATH_PREFIX = "/internal-api/operations";
const MAX_AGE_MS = 5 * 60_000;
const MAX_FUTURE_SKEW_MS = 30_000;
const SUBJECT = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/;
const SIGNATURE = /^[A-Za-z0-9_-]{43}$/;
const privateHeaders = { "cache-control": "private, no-store, max-age=0" };

function normalizeSubject(value: string): string | null {
  const normalized = value.normalize("NFKC").trim();
  return normalized === value && SUBJECT.test(normalized) ? normalized : null;
}

function authorizedSubjects(raw: string | undefined): ReadonlySet<string> {
  return new Set((raw ?? "").split(",").map(normalizeSubject).filter((value): value is string => value !== null));
}

function queryDigest(search: string): string {
  const pairs = [...new URLSearchParams(search).entries()].sort(([leftKey, leftValue], [rightKey, rightValue]) => leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue));
  return createHash("sha256").update(new URLSearchParams(pairs).toString(), "utf8").digest("base64url");
}

export function verifyIngressOperationsRequest(request: NextRequest, now = Date.now()): { subject: string } | null {
  const secret = process.env.OPERATOR_PROXY_SIGNING_SECRET;
  const rawSubject = request.headers.get("x-operator-subject");
  const timestamp = request.headers.get("x-operator-timestamp");
  const signature = request.headers.get("x-operator-signature");
  if (!secret || secret.length < 32 || !rawSubject || !timestamp || !signature || !SIGNATURE.test(signature)) return null;
  const subject = normalizeSubject(rawSubject); const instant = Date.parse(timestamp);
  if (!subject || !Number.isFinite(instant) || now - instant > MAX_AGE_MS || instant - now > MAX_FUTURE_SKEW_MS || !authorizedSubjects(process.env.OPERATOR_AUTHORIZED_SUBJECTS).has(subject)) return null;
  const pathname = request.nextUrl.pathname;
  if (pathname !== PATH_PREFIX && !pathname.startsWith(`${PATH_PREFIX}/`)) return null;
  const canonical = `${subject}\n${timestamp}\n${request.method.toUpperCase()}\n${pathname}\n${queryDigest(request.nextUrl.search)}`;
  const expected = Buffer.from(createHmac("sha256", secret).update(canonical, "utf8").digest("base64url"));
  const presented = Buffer.from(signature);
  return expected.length === presented.length && timingSafeEqual(expected, presented) ? { subject } : null;
}

async function proxy(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  const authorization = verifyIngressOperationsRequest(request);
  const credential = process.env.OPERATOR_CREDENTIAL;
  if (!authorization || !credential) return NextResponse.json({ message: "Not found" }, { status: 404, headers: privateHeaders });
  const { path = [] } = await context.params;
  if (path.some((segment) => !/^[A-Za-z0-9_-]{1,64}$/.test(segment))) return NextResponse.json({ message: "Not found" }, { status: 404, headers: privateHeaders });
  const upstream = new URL(`/internal/operations/${path.map(encodeURIComponent).join("/")}`, process.env.API_ORIGIN ?? "http://127.0.0.1:3001");
  upstream.search = request.nextUrl.search;
  const response = await fetch(upstream, { method: "GET", headers: { "x-operator-credential": credential, "x-operator-actor": authorization.subject }, cache: "no-store" });
  return new NextResponse(response.body, { status: response.status, headers: { "content-type": response.headers.get("content-type") === "application/json; charset=utf-8" ? "application/json; charset=utf-8" : "application/json", ...privateHeaders } });
}

export const GET = proxy;
