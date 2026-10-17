import { describe, expect, it } from "vitest";

import { formatOdds } from "./odds-format";

describe("formatOdds", () => {
  it("rounds exact snapshot odds to one decimal place", () => {
    expect(formatOdds("2.7095432205682502734926224209581147665")).toBe("2.7");
    expect(formatOdds("2.05525185834709999472451823753385343732")).toBe("2.1");
    expect(formatOdds("3.80057422490048317781453352433443797352")).toBe("3.8");
  });
  it("keeps one decimal place on short values", () => {
    expect(formatOdds("2.1")).toBe("2.1");
    expect(formatOdds("10")).toBe("10.0");
    expect(formatOdds("1.5")).toBe("1.5");
  });
  it("returns unparseable input unchanged", () => {
    expect(formatOdds("N/A")).toBe("N/A");
    expect(formatOdds("")).toBe("");
  });
});
