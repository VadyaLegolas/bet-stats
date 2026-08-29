import { describe, expect, it } from "vitest";

async function replayPlanner(): Promise<Record<string, unknown>> {
  try {
    return await import(/* @vite-ignore */ new URL("../../workers/data-sync/src/replay/planner.js", import.meta.url).href);
  } catch (error) {
    throw new Error("Missing Phase 2 production symbol: previewReplay in workers/data-sync/src/replay/planner.ts", { cause: error });
  }
}

describe("bounded historical replay", () => {
  it("D-15 defaults to dry-run and preserves the original logical identities", async () => {
    const { previewReplay } = await replayPlanner() as { previewReplay: (input: Record<string, unknown>) => Promise<Record<string, unknown>> };
    const preview = await previewReplay({ provider: "football-data.org", competitionId: "PL", seasonId: "2026", endpointFamily: "RESULTS", from: "2026-08-01T00:00:00.000Z", to: "2026-08-03T00:00:00.000Z" });
    expect(preview).toMatchObject({ dryRun: true, queued: false, bounded: true });
    expect(preview).toHaveProperty("logicalJobIds");
  });

  it("D-15 rejects stale previews and requires an explicit reason for a new revision", async () => {
    const { queueReplay } = await replayPlanner() as { queueReplay: (input: Record<string, unknown>) => Promise<Record<string, unknown>> };
    await expect(queueReplay({ previewId: "stale-preview", previewVersion: 1, currentVersion: 2 })).rejects.toMatchObject({ code: "STALE_PREVIEW" });
    await expect(queueReplay({ previewId: "preview-1", newRevision: true, reason: "" })).rejects.toMatchObject({ code: "REVISION_REASON_REQUIRED" });
  });

  it("D-16 repairs current truth without mutation or any observation deletion path", async () => {
    const { queueReplay } = await replayPlanner() as { queueReplay: (input: Record<string, unknown>) => Promise<Record<string, unknown>> };
    const result = await queueReplay({ previewId: "preview-1", preserveObservationIds: true, recomputeEvidence: true });
    expect(result).toMatchObject({ immutableObservations: true, predictionSnapshotsMutated: false });
    expect(result).not.toHaveProperty("deletedObservationIds");
  });
});
