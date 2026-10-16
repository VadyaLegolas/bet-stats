import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveCohortBounds } from "../../apps/web/app/scorecards/cohort-bounds.js";

const EXACT_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_PERIOD_MS = 366 * DAY_MS;

afterEach(() => {
  vi.useRealTimers();
});

describe("resolveCohortBounds", () => {
  it("fills both missing bounds around a pinned now with exact-UTC values inside the API period ceiling", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-16T12:00:00.000Z"));
    const bounds = resolveCohortBounds({});
    expect(bounds.from).toBe("2025-10-17T12:00:00.000Z");
    expect(bounds.to).toBe("2026-10-17T12:00:00.000Z");
    expect(bounds.from).toMatch(EXACT_UTC);
    expect(bounds.to).toMatch(EXACT_UTC);
    const duration = Date.parse(bounds.to) - Date.parse(bounds.from);
    expect(duration).toBeGreaterThan(0);
    expect(duration).toBeLessThanOrEqual(MAX_PERIOD_MS);
  });

  it("returns explicit from and to byte-identical because explicit bounds always win", () => {
    const bounds = resolveCohortBounds({ from: "2026-01-01T00:00:00.000Z", to: "2026-02-01T00:00:00.000Z" });
    expect(bounds.from).toBe("2026-01-01T00:00:00.000Z");
    expect(bounds.to).toBe("2026-02-01T00:00:00.000Z");
  });

  it("derives a parseable lone from at exactly +365 days so any explicit age keeps a valid period", () => {
    const bounds = resolveCohortBounds({ from: "2020-01-01T00:00:00.000Z" });
    expect(bounds.from).toBe("2020-01-01T00:00:00.000Z");
    expect(bounds.to).toBe("2020-12-31T00:00:00.000Z");
    expect(bounds.to).toMatch(EXACT_UTC);
    expect(Date.parse(bounds.to) - Date.parse(bounds.from)).toBe(365 * DAY_MS);
  });

  it("derives a parseable lone to at exactly -365 days", () => {
    const bounds = resolveCohortBounds({ to: "2021-06-15T08:30:00.000Z" });
    expect(bounds.from).toBe("2020-06-15T08:30:00.000Z");
    expect(bounds.to).toBe("2021-06-15T08:30:00.000Z");
    expect(bounds.from).toMatch(EXACT_UTC);
    expect(Date.parse(bounds.to) - Date.parse(bounds.from)).toBe(365 * DAY_MS);
  });

  it("treats empty strings as absent and reads the first element of array values", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-16T12:00:00.000Z"));
    const empties = resolveCohortBounds({ from: "", to: "" });
    expect(empties.from).toBe("2025-10-17T12:00:00.000Z");
    expect(empties.to).toBe("2026-10-17T12:00:00.000Z");
    const arrayed = resolveCohortBounds({ from: ["2026-01-01T00:00:00.000Z"], to: ["2026-02-01T00:00:00.000Z"] });
    expect(arrayed.from).toBe("2026-01-01T00:00:00.000Z");
    expect(arrayed.to).toBe("2026-02-01T00:00:00.000Z");
  });

  it("never throws on an unparseable explicit bound and still defaults the missing key", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-16T12:00:00.000Z"));
    const bounds = resolveCohortBounds({ from: "not-a-date" });
    expect(bounds.from).toBe("not-a-date");
    expect(bounds.to).toBe("2026-10-17T12:00:00.000Z");
    expect(bounds.to).toMatch(EXACT_UTC);
  });
});
