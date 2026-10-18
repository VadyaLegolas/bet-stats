import { describe, expect, it } from "vitest";

import { formatInstant } from "./time-format";

describe("formatInstant", () => {
  it("renders an instant in the operator's display zone", () => {
    expect(formatInstant("2026-10-18T18:45:00.000Z", "Europe/Warsaw")).toBe("18 октября 2026 г. в 20:45");
  });

  it("applies the seasonal zone offset, not a fixed one", () => {
    expect(formatInstant("2026-01-15T12:00:00.000Z", "Europe/Warsaw")).toBe("15 января 2026 г. в 13:00");
    expect(formatInstant("2026-08-29T14:00:00.000Z", "UTC")).toBe("29 августа 2026 г. в 14:00");
  });

  it("keeps an unparsable value exact instead of dropping it", () => {
    expect(formatInstant("not-an-instant", "Europe/Warsaw")).toBe("not-an-instant");
  });
});
