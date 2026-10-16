import { describe, expect, it } from "vitest";

import { evidenceHeading } from "../../apps/web/app/teams/[teamId]/evidence/page.js";

describe("evidenceHeading", () => {
  it("renders the named form when the API supplies a team name", () => {
    expect(evidenceHeading("Arsenal")).toBe("Arsenal: исторические доказательства");
  });

  it("renders the plain form without id or colon for missing names", () => {
    expect(evidenceHeading(null)).toBe("Исторические доказательства");
    expect(evidenceHeading(undefined)).toBe("Исторические доказательства");
    expect(evidenceHeading("")).toBe("Исторические доказательства");
    expect(evidenceHeading("   ")).toBe("Исторические доказательства");
  });

  it("trims the supplied name before composing the heading", () => {
    expect(evidenceHeading("  Arsenal  ")).toBe("Arsenal: исторические доказательства");
  });
});
