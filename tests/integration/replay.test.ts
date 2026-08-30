import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

async function replayPlanner(): Promise<Record<string, unknown>> {
  try {
    return await import(/* @vite-ignore */ new URL("../../workers/data-sync/src/replay/service.js", import.meta.url).href);
  } catch (error) {
    throw new Error("Missing Phase 2 production symbol: previewReplay in workers/data-sync/src/replay/service.ts", { cause: error });
  }
}

describe("bounded historical replay", () => {
  it("D-15 defaults to dry-run and preserves the original logical identities", async () => {
    const { previewReplay } = await replayPlanner() as { previewReplay: (input: Record<string, unknown>) => Promise<Record<string, unknown>> };
    const preview = await previewReplay({ provider: "football-data.org", competitionId: "PL", seasonId: "2026", endpointFamily: "RESULTS", from: "2026-08-01T00:00:00.000Z", to: "2026-08-03T00:00:00.000Z" });
    expect(preview).toMatchObject({ dryRun: true, queued: false, bounded: true });
    expect(preview).toMatchObject({ calls: 3, builds: 3 });
    expect(preview).toHaveProperty("logicalJobIds");
  });

  it("D-15 rejects stale previews and requires an explicit reason for a new revision", async () => {
    const { previewReplay, queueReplay } = await replayPlanner() as { previewReplay: (input: Record<string, unknown>) => Promise<Record<string, unknown>>; queueReplay: (input: Record<string, unknown>) => Promise<Record<string, unknown>> };
    const preview = await previewReplay({ provider: "football-data.org", competitionId: "PL", seasonId: "2026", endpointFamily: "RESULTS", from: "2026-08-01T00:00:00.000Z", to: "2026-08-02T00:00:00.000Z" });
    await expect(queueReplay({ previewId: preview.previewId, previewVersion: "stale" })).rejects.toMatchObject({ code: "STALE_PREVIEW" });
    await expect(queueReplay({ previewId: preview.previewId, previewVersion: preview.previewVersion, newRevision: true, reason: "" })).rejects.toMatchObject({ code: "REVISION_REASON_REQUIRED" });
  });

  it("D-16 repairs current truth without mutation or any observation deletion path", async () => {
    const { previewReplay, queueReplay } = await replayPlanner() as { previewReplay: (input: Record<string, unknown>) => Promise<Record<string, unknown>>; queueReplay: (input: Record<string, unknown>) => Promise<Record<string, unknown>> };
    const preview = await previewReplay({ provider: "football-data.org", competitionId: "PL", seasonId: "2026", endpointFamily: "RESULTS", from: "2026-08-01T00:00:00.000Z", to: "2026-08-02T00:00:00.000Z" });
    const result = await queueReplay({ previewId: preview.previewId, previewVersion: preview.previewVersion, preserveObservationIds: true, recomputeEvidence: true });
    expect(result).toMatchObject({ immutableObservations: true, predictionSnapshotsMutated: false });
    expect(result).not.toHaveProperty("deletedObservationIds");
    await expect(queueReplay({ previewId: preview.previewId, previewVersion: preview.previewVersion })).resolves.toMatchObject({ duplicate: true });
  });
});

async function replayApi() { return import("../../apps/api/src/modules/replay/replay.service.js"); }

describe("protected replay API contract", () => {
  const request = { provider: "football-data.org", competitionId: "PL", seasonId: "2026", endpointFamily: "RESULTS", from: "2026-08-01T00:00:00.000Z", to: "2026-08-03T00:00:00.000Z" };

  it("protects every replay route with the inherited operator guard", () => {
    const controller = readFileSync("apps/api/src/modules/replay/replay.controller.ts", "utf8");
    expect(controller).toContain("@UseGuards(OperatorGuard)");
    expect(controller).not.toMatch(/url|queueName|laneName/i);
  });

  it("returns a bounded safe preview with immutable effects and headroom", async () => {
    const { createReplayService } = await replayApi();
    const api = createReplayService();
    const preview = await api.preview(request);
    expect(preview).toMatchObject({ dryRun: true, calls: 3, builds: 3, lane: "standard", headroom: { available: true }, effects: { immutableObservations: true, predictionSnapshotsMutated: false } });
    expect(preview).not.toHaveProperty("url");
    expect(preview).not.toHaveProperty("queueName");
  });

  it("maps stale confirmation to conflict and freezes duplicate submissions", async () => {
    const { createReplayService } = await replayApi();
    const api = createReplayService();
    const preview = await api.preview(request);
    await expect(api.queue({ previewId: preview.previewId, previewVersion: "stale" })).rejects.toMatchObject({ status: 409, code: "STALE_PREVIEW" });
    const queued = await api.queue({ previewId: preview.previewId, previewVersion: preview.previewVersion });
    expect(queued).toMatchObject({ queued: true, duplicate: false });
    await expect(api.queue({ previewId: preview.previewId, previewVersion: preview.previewVersion })).resolves.toMatchObject({ queued: false, duplicate: true, replayPlanId: queued.replayPlanId });
  });

  it("rejects zero-unit previews and forced revisions without an explicit reason", async () => {
    const { createReplayService } = await replayApi();
    const noHeadroom = createReplayService({ availableCalls: 0 });
    await expect(noHeadroom.preview(request)).rejects.toMatchObject({ code: "NO_HEADROOM" });
    const api = createReplayService();
    const preview = await api.preview(request);
    await expect(api.queue({ previewId: preview.previewId, previewVersion: preview.previewVersion, newRevision: true, reason: "" })).rejects.toMatchObject({ code: "REVISION_REASON_REQUIRED" });
  });

  it("exposes classified status without raw errors or secrets", async () => {
    const { createReplayService } = await replayApi();
    const api = createReplayService();
    const preview = await api.preview(request);
    const queued = await api.queue({ previewId: preview.previewId, previewVersion: preview.previewVersion });
    const status = await api.status(queued.replayPlanId);
    expect(status).toMatchObject({ state: "QUEUED", outcome: "PENDING", provider: { circuit: "CLOSED", quota: "AVAILABLE" } });
    expect(JSON.stringify(status)).not.toMatch(/credential|stack|exception|secret/i);
  });
});
