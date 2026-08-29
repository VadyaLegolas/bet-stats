import { describe, expect, it } from "vitest";

async function phase2Evidence(): Promise<Record<string, unknown>> {
  try {
    return await import(/* @vite-ignore */ new URL("../../apps/api/src/modules/evidence/evidence.service.js", import.meta.url).href);
  } catch (error) {
    throw new Error("Missing Phase 2 production symbol: resolveTeamEvidence in apps/api/src/modules/evidence/evidence.service.ts", { cause: error });
  }
}

describe("cutoff-aware evidence API", () => {
  it("D-18 normalizes and echoes the exact requested instant without a latest-state fallback", async () => {
    const { resolveTeamEvidence } = await phase2Evidence() as { resolveTeamEvidence: (input: Record<string, unknown>) => Promise<Record<string, unknown>> };
    const evidence = await resolveTeamEvidence({ teamId: "team-arsenal", asOf: "2026-08-29T12:00:00+02:00" });
    expect(evidence).toMatchObject({ teamId: "team-arsenal", requestedAsOf: "2026-08-29T12:00:00+02:00", resolvedAsOfUtc: "2026-08-29T10:00:00.000Z" });
  });

  it("D-18 rejects an invalid cutoff and never substitutes current evidence", async () => {
    const { resolveTeamEvidence } = await phase2Evidence() as { resolveTeamEvidence: (input: Record<string, unknown>) => Promise<Record<string, unknown>> };
    await expect(resolveTeamEvidence({ teamId: "team-arsenal", asOf: "not-an-instant" })).rejects.toMatchObject({ code: "INVALID_AS_OF" });
  });
});
