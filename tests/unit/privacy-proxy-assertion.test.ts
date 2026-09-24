import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { signedEnvironmentSubjectProvider } from "../../apps/api/src/modules/privacy/privacy.service.js";
import { createPrivacyProxyAssertion } from "../../apps/web/app/internal-api/privacy/[[...path]]/route.js";

describe("privacy trusted proxy assertion", () => {
  it("binds method, path, body and consumes a nonce exactly once", async () => {
    const secret = "privacy-assertion-test-secret-32-bytes";
    process.env.PRIVACY_SUBJECT_SIGNING_SECRET = secret;
    const used = new Set<string>();
    const provider = signedEnvironmentSubjectProvider({ consume: async (nonce) => used.has(nonce) ? false : (used.add(nonce), true) });
    const timestamp = new Date().toISOString(), nonce = randomUUID(), body = "{}", pathname = "/privacy/consent";
    const signature = createPrivacyProxyAssertion({ secret, subjectId: "subject-1", timestamp, nonce, method: "POST", pathname, body });
    const request = { method: "POST", originalUrl: pathname, body: {}, headers: { "x-privacy-subject": "subject-1", "x-privacy-timestamp": timestamp, "x-privacy-nonce": nonce, "x-privacy-signature": signature } };
    await expect(provider.resolve(request)).resolves.toMatchObject({ subjectId: "subject-1" });
    await expect(provider.resolve(request)).resolves.toBeNull();
  });

  it("rejects an assertion replayed against another endpoint or body", async () => {
    const secret = "privacy-assertion-test-secret-32-bytes";
    process.env.PRIVACY_SUBJECT_SIGNING_SECRET = secret;
    const timestamp = new Date().toISOString(), nonce = randomUUID();
    const signature = createPrivacyProxyAssertion({ secret, subjectId: "subject-1", timestamp, nonce, method: "GET", pathname: "/privacy/status", body: "" });
    const provider = signedEnvironmentSubjectProvider({ consume: async () => true });
    await expect(provider.resolve({ method: "POST", originalUrl: "/privacy/withdrawal", body: {}, headers: { "x-privacy-subject": "subject-1", "x-privacy-timestamp": timestamp, "x-privacy-nonce": nonce, "x-privacy-signature": signature } })).resolves.toBeNull();
  });
});
