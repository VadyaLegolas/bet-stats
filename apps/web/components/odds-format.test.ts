import { describe, expect, it } from "vitest";

import { formatOdds } from "./odds-format";

describe("formatOdds", () => {
  it("rounds exact snapshot odds to two decimal places", () => {
    expect(formatOdds("2.7095432205682502734926224209581147665")).toBe("2.71");
    expect(formatOdds("2.05525185834709999472451823753385343732")).toBe("2.06");
    expect(formatOdds("3.80057422490048317781453352433443797352")).toBe("3.80");
  });
  it("pads short values to two decimal places", () => {
    expect(formatOdds("2.1")).toBe("2.10");
    expect(formatOdds("10")).toBe("10.00");
    expect(formatOdds("1.5")).toBe("1.50");
  });
  it("returns unparseable input unchanged", () => {
    expect(formatOdds("N/A")).toBe("N/A");
    expect(formatOdds("")).toBe("");
  });
});
