import { describe, expect, it } from "vitest";

import { resolveCohortBounds } from "../../apps/web/app/scorecards/cohort-bounds.js";

const EXACT_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** The cohort filter's calendar pickers submit whole UTC days («2026-02-01»). The API rejects
 * a bare day with INVALID_FROM/INVALID_TO, so the server converts a day into an instant before
 * the request crosses the evaluation boundary. These cases pin that contract down. */
describe("resolveCohortBounds day-shaped bounds", () => {
  it("opens an explicit from-day at midnight UTC of that day", () => {
    const bounds = resolveCohortBounds({ from: "2026-02-01", to: "2026-02-28" });
    expect(bounds.from).toBe("2026-02-01T00:00:00.000Z");
    expect(bounds.from).toMatch(EXACT_UTC);
  });

  it("closes an exclusive to-day at the next day's midnight so the picked end day stays whole", () => {
    const bounds = resolveCohortBounds({ from: "2026-02-01", to: "2026-02-28" });
    expect(bounds.to).toBe("2026-03-01T00:00:00.000Z");
    expect(bounds.to).toMatch(EXACT_UTC);
  });

  it("keeps a mixed pair intact: an instant passes through while the day is converted", () => {
    const bounds = resolveCohortBounds({ from: "2026-01-01T00:00:00.000Z", to: "2026-02-28" });
    expect(bounds.from).toBe("2026-01-01T00:00:00.000Z");
    expect(bounds.to).toBe("2026-03-01T00:00:00.000Z");
  });

  it("still derives a missing bound from a lone day at exactly +365 days", () => {
    const bounds = resolveCohortBounds({ from: "2026-02-01" });
    expect(bounds.from).toBe("2026-02-01T00:00:00.000Z");
    expect(Date.parse(bounds.to) - Date.parse(bounds.from)).toBe(365 * 24 * 60 * 60 * 1000);
    expect(bounds.to).toMatch(EXACT_UTC);
  });
});
