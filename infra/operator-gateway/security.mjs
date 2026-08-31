import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const protectedPrefixes = ["/internal/pipeline/replay", "/internal-api/pipeline/replay"];
const operatorHeaders = new Set(["x-operator-subject", "x-operator-timestamp", "x-operator-signature"]);

export function isProtectedReplayPath(pathname) {
  return protectedPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function equalText(left, right) {
  const leftDigest = createHash("sha256").update(left, "utf8").digest();
  const rightDigest = createHash("sha256").update(right, "utf8").digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

export function authenticateBasic(header, expectedUsername, expectedPassword) {
  if (!header?.startsWith("Basic ") || !expectedUsername || !expectedPassword) return false;
  let decoded;
  try {
    decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  } catch {
    return false;
  }
  const separator = decoded.indexOf(":");
  if (separator < 1) return false;
  return equalText(decoded.slice(0, separator), expectedUsername)
    && equalText(decoded.slice(separator + 1), expectedPassword);
}

export function stripOperatorHeaders(input) {
  const output = new Headers(input);
  for (const name of operatorHeaders) output.delete(name);
  return output;
}

export function signedOperatorHeaders({ subject, secret, method, pathname, search, timestamp }) {
  const pairs = [...new URLSearchParams(search).entries()].sort(([ak, av], [bk, bv]) => ak.localeCompare(bk) || av.localeCompare(bv));
  const queryDigest = createHash("sha256").update(new URLSearchParams(pairs).toString(), "utf8").digest("base64url");
  const payload = `${subject}\n${timestamp}\n${method.toUpperCase()}\n${pathname}\n${queryDigest}`;
  return {
    "x-operator-subject": subject,
    "x-operator-timestamp": timestamp,
    "x-operator-signature": createHmac("sha256", secret).update(payload, "utf8").digest("base64url"),
  };
}
