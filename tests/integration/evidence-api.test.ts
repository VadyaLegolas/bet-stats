import { describe, expect, it } from "vitest";

async function phase2Evidence() { return import("../../apps/api/src/modules/evidence/evidence.service.js"); }
const receipt = { requestedAsOf: "2026-08-29T12:00:00+02:00", resolvedAsOf: "2026-08-29T10:00:00.000Z", configVersion: "evidence-v1", sourceWindow: { requestedFrom: null, requestedTo: "2026-08-29T10:00:00.000Z", returnedFrom: "2026-08-01T14:00:00.000Z", returnedTo: "2026-08-24T14:00:00.000Z" }, inputs: [{ fixtureId: "fixture-1", effectiveAt: "2026-08-24T14:00:00.000Z", observedAt: "2026-08-24T16:00:00.000Z", sourceUpdatedAt: null, payloadHash: "hash-1", payloadBytes: 123 }] };
const published = (overrides: Record<string, unknown> = {}) => ({ id: "build-1", state: "PUBLISHED", cutoff: receipt.resolvedAsOf, publishedAt: "2026-08-29T10:05:00.000Z", components: [{ component: "receipt", value: receipt, sampleSize: 5, limitation: null, sourceTimes: receipt.inputs }, { component: "form5", value: 2, sampleSize: 5, limitation: null, sourceTimes: receipt.inputs }], ...overrides });

describe("cutoff-aware evidence API", () => {
  it("normalizes and echoes the exact cutoff while selecting only a published build", async () => {
    const { resolveTeamEvidence } = await phase2Evidence();
    const evidence = await resolveTeamEvidence({ teamId: "team-arsenal", asOf: receipt.requestedAsOf }, { findPublished: async () => published({ components: [{ component: "receipt", value: receipt, sampleSize: 1, limitation: null, sourceTimes: receipt.inputs }, { component: "form5", value: 1.7, sampleSize: 1, limitation: "LIMITED_HISTORY", sourceTimes: receipt.inputs }] }) });
    expect(evidence).toMatchObject({ teamId: "team-arsenal", requestedAsOf: receipt.requestedAsOf, resolvedAsOfUtc: receipt.resolvedAsOf, state: "LIMITED", buildId: "build-1" });
    expect(evidence.components.form5).toMatchObject({ value: 1.7, sampleSize: 1, limitation: "LIMITED_HISTORY" });
    expect(evidence.components.form5.sourceRefs[0]).toMatchObject({ observedAt: "2026-08-24T16:00:00.000Z", sourceUpdatedAt: null });
    expect(evidence).not.toHaveProperty("forecast");
    expect(evidence).not.toHaveProperty("odds");
  });

  it("rejects an invalid or absent cutoff without querying latest evidence", async () => {
    const { resolveTeamEvidence } = await phase2Evidence();
    const repository = { findPublished: async () => { throw new Error("must not query"); } };
    await expect(resolveTeamEvidence({ teamId: "team-arsenal", asOf: "not-an-instant" }, repository)).rejects.toMatchObject({ code: "INVALID_AS_OF" });
    await expect(resolveTeamEvidence({ teamId: "team-arsenal" }, repository)).rejects.toMatchObject({ code: "INVALID_AS_OF" });
  });

  it("distinguishes complete, zero-history, stale, pending and missing-provenance states", async () => {
    const { resolveTeamEvidence } = await phase2Evidence();
    const resolve = (row: Record<string, unknown> | null) => resolveTeamEvidence({ teamId: "team", asOf: receipt.requestedAsOf }, { findPublished: async () => row });
    await expect(resolve(published())).resolves.toMatchObject({ state: "COMPLETE" });
    const zero = await resolve(published({ components: [{ component: "receipt", value: { ...receipt, inputs: [] }, sampleSize: 0, limitation: "NO_ELIGIBLE_HISTORY", sourceTimes: [] }, { component: "form5", value: null, sampleSize: 0, limitation: "NO_ELIGIBLE_HISTORY", sourceTimes: [] }] }));
    expect(zero).toMatchObject({ state: "LIMITED", components: { form5: { value: null, sampleSize: 0 } } });
    await expect(resolve(published({ publishedAt: "2026-08-20T00:00:00.000Z" }))).resolves.toMatchObject({ freshness: "STALE" });
    await expect(resolve(null)).resolves.toMatchObject({ state: "PENDING", buildId: null });
    const missing = await resolve(published({ components: [{ component: "receipt", value: receipt, sampleSize: 1, limitation: null, sourceTimes: [] }, { component: "form5", value: 1, sampleSize: 1, limitation: "MISSING_TIMESTAMP", sourceTimes: [] }] }));
    expect(missing).toMatchObject({ state: "LIMITED", components: { form5: { sourceRefs: [], limitation: "MISSING_TIMESTAMP" } } });
  });

  it("does not return a build newer than the requested cutoff", async () => {
    const { resolveTeamEvidence } = await phase2Evidence();
    await expect(resolveTeamEvidence({ teamId: "team", asOf: receipt.requestedAsOf }, { findPublished: async () => published({ id: "future", cutoff: "2026-08-29T10:00:00.001Z" }) })).rejects.toMatchObject({ code: "POST_CUTOFF_BUILD" });
  });

  it.each([
    ["missing receipt input", receipt.inputs, [], true],
    ["missing observedAt", [{ fixtureId: "fixture-1", effectiveAt: receipt.inputs[0]!.effectiveAt }], receipt.inputs, true],
    ["missing effectiveAt", [{ fixtureId: "fixture-1", observedAt: receipt.inputs[0]!.observedAt }], receipt.inputs, true],
    ["missing payload identity", receipt.inputs, [{ ...receipt.inputs[0], payloadHash: "" }], false],
    ["mismatched payload bytes", [{ ...receipt.inputs[0], payloadBytes: 124 }], receipt.inputs, true],
    ["mismatched source", [{ fixtureId: "other", effectiveAt: receipt.inputs[0]!.effectiveAt, observedAt: receipt.inputs[0]!.observedAt }], receipt.inputs, true],
  ])("fails affected provenance closed for %s", async (_case, componentTimes, receiptInputs, validReceipt) => {
    const { resolveTeamEvidence } = await phase2Evidence();
    const sibling = { fixtureId: "fixture-2", effectiveAt: "2026-08-23T14:00:00.000Z", observedAt: "2026-08-23T16:00:00.000Z", sourceUpdatedAt: null, payloadHash: "hash-2", payloadBytes: 124 };
    const result = await resolveTeamEvidence(
      { teamId: "team", asOf: receipt.requestedAsOf },
      { findPublished: async () => published({
        components: [
          { component: "receipt", value: { ...receipt, inputs: [...receiptInputs, sibling] }, sampleSize: 1, limitation: null, sourceTimes: [...receiptInputs, sibling] },
          { component: "form5", value: 2.1, sampleSize: 1, limitation: null, sourceTimes: componentTimes },
          { component: "elo", value: 1512, sampleSize: 1, limitation: null, sourceTimes: [sibling] },
        ],
      }) },
    );
    expect(result).toMatchObject({
      state: "LIMITED",
      components: {
        form5: { value: null, limitation: "MISSING_TIMESTAMP", sourceRefs: [] },
        elo: validReceipt ? { value: 1512, limitation: null } : { value: null, limitation: "MISSING_TIMESTAMP" },
      },
    });
  });

  it("does not cross-join corrections that share the same temporal tuple", async () => {
    const { resolveTeamEvidence } = await phase2Evidence();
    const correction = { ...receipt.inputs[0], payloadHash: "hash-correction", payloadBytes: 321 };
    const result = await resolveTeamEvidence(
      { teamId: "team", asOf: receipt.requestedAsOf },
      { findPublished: async () => published({
        components: [
          { component: "receipt", value: { ...receipt, inputs: [receipt.inputs[0], correction] }, sampleSize: 2, limitation: null, sourceTimes: [receipt.inputs[0], correction] },
          { component: "form5", value: 2.1, sampleSize: 1, limitation: null, sourceTimes: [correction] },
          { component: "elo", value: 1512, sampleSize: 1, limitation: null, sourceTimes: [{ ...correction, payloadHash: "unknown-hash" }] },
        ],
      }) },
    );

    expect(result).toMatchObject({
      state: "LIMITED",
      components: {
        form5: { value: 2.1, sourceRefs: [correction] },
        elo: { value: null, limitation: "MISSING_TIMESTAMP", sourceRefs: [] },
      },
    });
  });

  it.each([
    ["mixed valid and malformed inputs", { ...receipt, inputs: [...receipt.inputs, { ...receipt.inputs[0], payloadBytes: -1 }] }],
    ["unexpected receipt members", { ...receipt, repaired: true }],
    ["incoherent source window", { ...receipt, sourceWindow: { ...receipt.sourceWindow, returnedFrom: "2026-08-25T00:00:00.000Z", returnedTo: "2026-08-24T00:00:00.000Z" } }],
    ["invalid source update instant", { ...receipt, inputs: [{ ...receipt.inputs[0], sourceUpdatedAt: "not-an-instant" }] }],
  ])("rejects the entire immutable receipt for %s", async (_case, malformedReceipt) => {
    const { resolveTeamEvidence } = await phase2Evidence();
    const result = await resolveTeamEvidence(
      { teamId: "team", asOf: receipt.requestedAsOf },
      { findPublished: async () => published({
        components: [
          { component: "receipt", value: malformedReceipt, sampleSize: 1, limitation: null, sourceTimes: receipt.inputs },
          { component: "form5", value: 2.4, sampleSize: 1, limitation: null, sourceTimes: receipt.inputs },
        ],
      }) },
    );

    expect(result).toMatchObject({
      state: "LIMITED",
      receipt: null,
      coverage: null,
      components: { form5: { value: null, limitation: "MISSING_TIMESTAMP", sourceRefs: [] } },
    });
  });
});
