import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { parseEvidenceProjection } from "@bet-stats/domain";
import { renderEvidenceComponentFields } from "../../apps/web/app/teams/[teamId]/evidence/page.js";

const pagePath = resolve(import.meta.dirname, "../../apps/web/app/teams/[teamId]/evidence/page.tsx");
const resourcePath = resolve(import.meta.dirname, "../../apps/web/app/internal-api/teams/[teamId]/evidence/route.ts");

describe("production evidence browser boundary contract", () => {
  it("keeps the team page on a direct no-store resource with cutoff, receipt, and limitation rendering", () => {
    expect(existsSync(resourcePath)).toBe(true);
    const page = readFileSync(pagePath, "utf8");
    const resource = readFileSync(resourcePath, "utf8");

    expect(page).toContain("/internal-api/teams/${encodeURIComponent(params.teamId)}/evidence?asOf=${encodeURIComponent(asOf)}");
    expect(page).toContain('cache: "no-store"');
    expect(page).toContain("parseEvidenceProjection(body)");
    expect(page).toContain("Requested cutoff");
    expect(page).toContain("Resolved cutoff (UTC)");
    expect(page).toContain("Reproduction receipt");
    expect(page).toContain("component.limitation");
    expect(resource).toContain("/teams/${encodeURIComponent(teamId)}/evidence");
    expect(resource).toContain('cache: "no-store"');
    expect(resource).not.toMatch(/mock|fixture|intercept/i);
  });

  it("uses the shared evidence DTO before rendering explicit unavailable values", () => {
    const projection = parseEvidenceProjection({
      teamId: "team-1",
      requestedAsOf: "2026-08-29T10:00:00.000Z",
      resolvedAsOfUtc: "2026-08-29T10:00:00.000Z",
      cutoffBoundary: { observedAt: "2026-08-29T10:00:00.000Z" },
      state: "LIMITED",
      freshness: "FRESH",
      buildId: "build-1",
      publishedAt: "2026-08-29T10:01:00.000Z",
      receipt: null,
      coverage: null,
      components: {
        form5: { kind: "form5", value: null, unit: "points-per-match", sampleSize: 0, limitation: "NO_ELIGIBLE_HISTORY", sourceRefs: [] },
      },
    });

    expect(renderEvidenceComponentFields(projection.components.form5!)).toEqual([{ label: "Value", value: "Not available" }]);
  });
});
