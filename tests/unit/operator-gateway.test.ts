import { describe, expect, it } from "vitest";
import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  authenticateBasic,
  isProtectedReplayPath,
  signedOperatorHeaders,
  stripOperatorHeaders,
} from "../../infra/operator-gateway/security.mjs";

describe("operator gateway security", () => {
  it.each([
    "/internal/pipeline/replay",
    "/internal/pipeline/replay/abc",
    "/internal-api/pipeline/replay/preview",
  ])("protects %s", (path) => expect(isProtectedReplayPath(path)).toBe(true));

  it.each([
    "/",
    "/fixtures",
    "/teams/t/evidence",
    "/internal/reconciliation",
    "/internal/pipeline/replayer",
    "/internal-api/pipeline/replay-preview",
  ])(
    "leaves %s public",
    (path) => expect(isProtectedReplayPath(path)).toBe(false),
  );

  it("accepts only the exact Basic credentials", () => {
    const valid = `Basic ${Buffer.from("operator:correct horse battery staple").toString("base64")}`;
    const wrong = `Basic ${Buffer.from("operator:wrong").toString("base64")}`;
    expect(authenticateBasic(valid, "operator", "correct horse battery staple")).toBe(true);
    expect(authenticateBasic(wrong, "operator", "correct horse battery staple")).toBe(false);
    expect(authenticateBasic(undefined, "operator", "correct horse battery staple")).toBe(false);
  });

  it("strips spoofed identity and emits the exact Next verifier signature", () => {
    const stripped = stripOperatorHeaders(new Headers({
      "x-operator-subject": "attacker",
      "x-operator-timestamp": "attacker-timestamp",
      "x-operator-signature": "attacker-signature",
      accept: "application/json",
    }));
    expect(stripped.get("x-operator-subject")).toBeNull();
    expect(stripped.get("x-operator-timestamp")).toBeNull();
    expect(stripped.get("x-operator-signature")).toBeNull();
    expect(stripped.get("accept")).toBe("application/json");
    const timestamp = "2026-08-31T12:00:00.000Z";
    const query = new URLSearchParams([["a", "1"], ["z", "2"]]).toString();
    const digest = createHash("sha256").update(query).digest("base64url");
    const payload = `local-test-operator\n${timestamp}\nPOST\n/internal-api/pipeline/replay/preview\n${digest}`;
    expect(signedOperatorHeaders({ subject: "local-test-operator", secret: "x".repeat(32), method: "POST", pathname: "/internal-api/pipeline/replay/preview", search: "?z=2&a=1", timestamp })).toEqual({
      "x-operator-subject": "local-test-operator",
      "x-operator-timestamp": timestamp,
      "x-operator-signature": createHmac("sha256", "x".repeat(32)).update(payload).digest("base64url"),
    });
  });

  it("compares the complete Basic credential pair with one constant-time operation", () => {
    const source = readFileSync(resolve("infra/operator-gateway/security.mjs"), "utf8");
    expect(source).toContain("return equalText(decoded, `${expectedUsername}:${expectedPassword}`);");
    expect(source).not.toContain("equalText(decoded.slice(0, separator)");
  });
});
