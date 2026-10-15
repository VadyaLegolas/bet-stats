import { describe, expect, it } from "vitest";

import { formatCountdown, formatRequests, pluralRu } from "./quota-format";

describe("pluralRu", () => {
  it("picks the one form", () => {
    expect(pluralRu(1, ["запрос", "запроса", "запросов"])).toBe("запрос");
    expect(pluralRu(21, ["запрос", "запроса", "запросов"])).toBe("запрос");
    expect(pluralRu(101, ["запрос", "запроса", "запросов"])).toBe("запрос");
  });
  it("picks the few form", () => {
    expect(pluralRu(2, ["запрос", "запроса", "запросов"])).toBe("запроса");
    expect(pluralRu(4, ["запрос", "запроса", "запросов"])).toBe("запроса");
    expect(pluralRu(22, ["запрос", "запроса", "запросов"])).toBe("запроса");
  });
  it("picks the many form", () => {
    expect(pluralRu(5, ["запрос", "запроса", "запросов"])).toBe("запросов");
    expect(pluralRu(11, ["запрос", "запроса", "запросов"])).toBe("запросов");
    expect(pluralRu(14, ["запрос", "запроса", "запросов"])).toBe("запросов");
    expect(pluralRu(0, ["запрос", "запроса", "запросов"])).toBe("запросов");
  });
});

describe("formatRequests", () => {
  it("formats used and remaining counts", () => {
    expect(formatRequests(88)).toBe("88 запросов");
    expect(formatRequests(1)).toBe("1 запрос");
    expect(formatRequests(3)).toBe("3 запроса");
  });
});

describe("formatCountdown", () => {
  it("clamps at zero", () => {
    expect(formatCountdown(0)).toBe("0 с");
    expect(formatCountdown(-5000)).toBe("0 с");
  });
  it("counts seconds below a minute", () => {
    expect(formatCountdown(1)).toBe("1 с");
    expect(formatCountdown(45_000)).toBe("45 с");
    expect(formatCountdown(59_000)).toBe("59 с");
  });
  it("counts minutes below an hour", () => {
    expect(formatCountdown(60_000)).toBe("1 мин");
    expect(formatCountdown(150_000)).toBe("2 мин");
    expect(formatCountdown(180_000)).toBe("3 мин");
  });
  it("counts hours and minutes", () => {
    expect(formatCountdown(3_600_000)).toBe("1 ч");
    expect(formatCountdown(5 * 3_600_000 + 27 * 60_000)).toBe("5 ч 27 мин");
    expect(formatCountdown(24 * 3_600_000 - 1_000)).toBe("23 ч 59 мин");
  });
});
