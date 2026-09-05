import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import type { NextRequest } from "next/server";

const REPLAY_PATH_PREFIX = "/internal-api/pipeline/replay";
const MAX_INGRESS_AGE_MS = 5 * 60_000;
const MAX_FUTURE_SKEW_MS = 30_000;
const SUBJECT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/;
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function normalizeSubject(value: string): string | null {
  const normalized = value.normalize("NFKC").trim();
  return normalized === value && SUBJECT_PATTERN.test(normalized) ? normalized : null;
}

function authorizedSubjects(value: string | undefined): ReadonlySet<string> {
  if (!value) return new Set();
  return new Set(value.split(",").map((subject) => normalizeSubject(subject)).filter((subject): subject is string => subject !== null));
}

function canonicalQueryDigest(search: string): string {
  const pairs = [...new URLSearchParams(search).entries()].sort(([leftKey, leftValue], [rightKey, rightValue]) => leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue));
  return createHash("sha256").update(new URLSearchParams(pairs).toString(), "utf8").digest("base64url");
}

function privateDisabledResponse(): null {
  return null;
}

export type VerifiedIngressOperator = Readonly<{ subject: string }>;

export function verifyIngressReplayRequest(request: NextRequest, now = Date.now()): VerifiedIngressOperator | null {
  const signingSecret = process.env.OPERATOR_PROXY_SIGNING_SECRET;
  const rawSubject = request.headers.get("x-operator-subject");
  const timestamp = request.headers.get("x-operator-timestamp");
  const signature = request.headers.get("x-operator-signature");
  if (!signingSecret || signingSecret.length < 32 || !rawSubject || !timestamp || !signature || !SIGNATURE_PATTERN.test(signature)) return privateDisabledResponse();

  const subject = normalizeSubject(rawSubject);
  const parsedTimestamp = Date.parse(timestamp);
  if (!subject || !Number.isFinite(parsedTimestamp) || now - parsedTimestamp > MAX_INGRESS_AGE_MS || parsedTimestamp - now > MAX_FUTURE_SKEW_MS || !authorizedSubjects(process.env.OPERATOR_AUTHORIZED_SUBJECTS).has(subject)) return privateDisabledResponse();

  const pathname = request.nextUrl.pathname;
  if (!pathname.startsWith(`${REPLAY_PATH_PREFIX}/`) && pathname !== REPLAY_PATH_PREFIX) return privateDisabledResponse();
  const payload = `${subject}\n${timestamp}\n${request.method.toUpperCase()}\n${pathname}\n${canonicalQueryDigest(request.nextUrl.search)}`;
  const expected = Buffer.from(createHmac("sha256", signingSecret).update(payload, "utf8").digest("base64url"), "utf8");
  const presented = Buffer.from(signature, "utf8");
  if (expected.length !== presented.length || !timingSafeEqual(expected, presented)) return privateDisabledResponse();
  return { subject };
}
