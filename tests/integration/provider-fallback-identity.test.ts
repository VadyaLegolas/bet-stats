import { describe, expect, it } from "vitest";
import { createFixtureJobRoute } from "../../workers/data-sync/src/jobs/fixtures.js";
describe("fallback canonical identity boundary", () => {
  it("keeps top-five fallback bounded and UEFA sole-source explicit", () => {
    expect(createFixtureJobRoute({ competition: "PL", season: "2026" }).route.candidates).toEqual(["football-data.org", "api-football"]);
    expect(createFixtureJobRoute({ competition: "EL", season: "2026" }).route).toMatchObject({ candidates: ["api-football"], soleSource: true });
  });
});
