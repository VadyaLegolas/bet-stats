import { describe, expect, it } from "vitest";

import { formatAge, formatCapturedWarsaw, formatInstant, formatKickoffWarsaw } from "./time-format";

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

  it("renders a calendar date without inventing a time or shifting the day", () => {
    expect(formatInstant("2026-09-20", "Europe/Warsaw")).toBe("20 сентября 2026 г.");
  });

  it("never mangles id-shaped values that merely look numeric", () => {
    expect(formatInstant("2026", "Europe/Warsaw")).toBe("2026");
    expect(formatInstant("PL", "Europe/Warsaw")).toBe("PL");
  });

  it("falls back to the exact input when the display zone is invalid", () => {
    expect(formatInstant("2026-10-18T18:45:00.000Z", "no-such/zone")).toBe("2026-10-18T18:45:00.000Z");
  });
});

describe("formatKickoffWarsaw", () => {
  it("renders weekday, day, month and time without the word «в»", () => {
    expect(formatKickoffWarsaw("2026-11-28T17:00:00Z")).toBe("сб, 28 ноября, 18:00");
  });

  it("rolls the day over in Warsaw", () => {
    expect(formatKickoffWarsaw("2026-11-28T23:30:00Z")).toBe("вс, 29 ноября, 00:30");
  });

  it("applies the summer offset", () => {
    expect(formatKickoffWarsaw("2026-07-01T10:00:00Z")).toBe("ср, 1 июля, 12:00");
  });

  it("shows midnight as 00, never 24", () => {
    expect(formatKickoffWarsaw("2026-11-28T23:00:00Z")).toBe("вс, 29 ноября, 00:00");
  });

  it("returns the input for an invalid zone, an invalid date and a non-ISO value", () => {
    expect(formatKickoffWarsaw("2026-11-28T17:00:00Z", "no-such/zone")).toBe("2026-11-28T17:00:00Z");
    expect(formatKickoffWarsaw("2026-13-45T99:00:00Z")).toBe("2026-13-45T99:00:00Z");
    expect(formatKickoffWarsaw("PL")).toBe("PL");
  });
});

describe("formatCapturedWarsaw", () => {
  it("renders dd.mm.yyyy, hh:mm in Warsaw", () => {
    expect(formatCapturedWarsaw("2026-11-25T13:05:00Z")).toBe("25.11.2026, 14:05");
  });

  it("shows midnight as 00, never 24", () => {
    expect(formatCapturedWarsaw("2026-11-25T23:00:00Z")).toBe("26.11.2026, 00:00");
  });

  it("returns the input for an invalid zone, an invalid date and a non-ISO value", () => {
    expect(formatCapturedWarsaw("2026-11-25T13:05:00Z", "no-such/zone")).toBe("2026-11-25T13:05:00Z");
    expect(formatCapturedWarsaw("2026-13-45T99:00:00Z")).toBe("2026-13-45T99:00:00Z");
    expect(formatCapturedWarsaw("not-an-instant")).toBe("not-an-instant");
  });
});

describe("formatAge", () => {
  it.each([
    [0, "только что"],
    [59, "только что"],
    [60, "1 мин назад"],
    [719, "11 мин назад"],
    [3599, "59 мин назад"],
    [3600, "1 ч назад"],
    [25_200, "7 ч назад"],
    [172_799, "47 ч назад"],
    [172_800, "2 сут назад"],
    [259_200, "3 сут назад"],
    [-5, "только что"],
    [Number.NaN, "только что"],
  ])("%s seconds reads as %s", (seconds, expected) => {
    expect(formatAge(seconds)).toBe(expected);
  });
});
