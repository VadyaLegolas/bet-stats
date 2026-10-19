import { describe, expect, it } from "vitest";

import { resolveCohortIdentity } from "../../apps/web/app/scorecards/cohort-identity.js";

/** The cohort form speaks in five plain fields, but the evaluation API accepts the identity
 * either complete (all three dimensions) or absent (which triggers its 308 canonicalization)
 * and rejects a partial set with 400 INCOMPLETE_COHORT_IDENTITY — an empty string would also
 * fail scalar() with INVALID_*. These cases pin the web-side completion rule. */
describe("resolveCohortIdentity", () => {
  it("keeps a fully absent identity absent so bare /scorecards still canonicalizes via 308", () => {
    expect(resolveCohortIdentity({})).toEqual([]);
    expect(resolveCohortIdentity({ from: "2026-01-01T00:00:00.000Z", to: "2026-02-01T00:00:00.000Z" })).toEqual([]);
  });

  it("completes a partially cleared identity with the all sentinel instead of sending a partial set", () => {
    expect(resolveCohortIdentity({ modelVersion: "", competitionId: "premier-league", market: "ONE_X_TWO" })).toEqual([
      ["modelVersion", "all"],
      ["competitionId", "premier-league"],
      ["market", "ONE_X_TWO"],
    ]);
  });

  it("turns a fully cleared identity into all/all/all rather than an empty scalar", () => {
    expect(resolveCohortIdentity({ modelVersion: "", competitionId: "", market: "" })).toEqual([
      ["modelVersion", "all"],
      ["competitionId", "all"],
      ["market", "all"],
    ]);
  });

  it("passes an explicit identity through byte-identical", () => {
    expect(resolveCohortIdentity({ modelVersion: "poisson-ensemble-v1", competitionId: "Serie A", market: "BTTS" })).toEqual([
      ["modelVersion", "poisson-ensemble-v1"],
      ["competitionId", "Serie A"],
      ["market", "BTTS"],
    ]);
  });

  it("completes a single mentioned dimension so a hand-edited URL never reaches the API partial", () => {
    expect(resolveCohortIdentity({ market: "OVER_UNDER_2_5" })).toEqual([
      ["modelVersion", "all"],
      ["competitionId", "all"],
      ["market", "OVER_UNDER_2_5"],
    ]);
  });
});
