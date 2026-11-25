import { describe, expect, it } from "vitest";

import { ALL_MARKET_IDS } from "../../packages/domain/src/markets/registry.js";
import {
  SCANNER_FRESHNESS_V1, SCANNER_LIMIT, SCANNER_MARKET_ORDER, SCANNER_SELECTION_ORDER, SCANNER_WINDOW_DAYS, classifyOddsFreshness,
} from "../../packages/domain/src/value/scanner.js";

describe("scanner freshness classifier (D-06, scanner-freshness-v1)", () => {
  it("FRESH below six hours of age", () => {
    for (const age of [0, 1, 21_599]) expect(classifyOddsFreshness(age)).toBe("FRESH");
  });

  it("AGING from six hours through 24 hours inclusive", () => {
    for (const age of [21_600, 43_200, 86_400]) expect(classifyOddsFreshness(age)).toBe("AGING");
  });

  it("STALE strictly above 24 hours", () => {
    for (const age of [86_401, 1_000_000]) expect(classifyOddsFreshness(age)).toBe("STALE");
  });

  it("a negative age (clock skew) is FRESH", () => {
    expect(classifyOddsFreshness(-5)).toBe("FRESH");
    expect(classifyOddsFreshness(-1_000_000)).toBe("FRESH");
  });

  it("a fractional age is floored before the comparison", () => {
    expect(classifyOddsFreshness(21_599.9)).toBe("FRESH");
    expect(classifyOddsFreshness(21_600.4)).toBe("AGING");
    expect(classifyOddsFreshness(86_400.9)).toBe("AGING");
    expect(classifyOddsFreshness(86_401.1)).toBe("STALE");
  });

  it("the policy constant is the only place hours appear: the literal boundaries follow it", () => {
    const fresh = SCANNER_FRESHNESS_V1.freshMaxHours * 3600;
    const aging = SCANNER_FRESHNESS_V1.agingMaxHours * 3600;
    expect(fresh).toBe(21_600);
    expect(aging).toBe(86_400);
    expect(classifyOddsFreshness(fresh - 1)).toBe("FRESH");
    expect(classifyOddsFreshness(fresh)).toBe("AGING");
    expect(classifyOddsFreshness(aging)).toBe("AGING");
    expect(classifyOddsFreshness(aging + 1)).toBe("STALE");
  });
});

describe("scanner constants (D-06, D-09)", () => {
  it("the freshness policy is frozen and versioned", () => {
    expect(Object.isFrozen(SCANNER_FRESHNESS_V1)).toBe(true);
    expect(SCANNER_FRESHNESS_V1).toEqual({ version: "scanner-freshness-v1", freshMaxHours: 6, agingMaxHours: 24 });
    const mutable = SCANNER_FRESHNESS_V1 as unknown as { freshMaxHours: number; version: string };
    try { mutable.freshMaxHours = 1; } catch { /* strict mode throws on a frozen object */ }
    try { mutable.version = "other"; } catch { /* strict mode throws on a frozen object */ }
    expect(SCANNER_FRESHNESS_V1.freshMaxHours).toBe(6);
    expect(SCANNER_FRESHNESS_V1.version).toBe("scanner-freshness-v1");
  });

  it("the window is seven days and the cap is 200 candidates", () => {
    expect(SCANNER_WINDOW_DAYS).toBe(7);
    expect(SCANNER_LIMIT).toBe(200);
  });

  it("the market order is the D-09 order and differs from the registry order", () => {
    expect([...SCANNER_MARKET_ORDER]).toEqual(["ONE_X_TWO", "OVER_UNDER_2_5", "BTTS", "ASIAN_HANDICAP", "EXACT_SCORE"]);
    expect(Object.isFrozen(SCANNER_MARKET_ORDER)).toBe(true);
    expect(new Set(SCANNER_MARKET_ORDER).size).toBe(SCANNER_MARKET_ORDER.length);
    // The registry lists exact score before the Asian handicap lines; the scanner shows handicap first.
    const registryFamilies = [...new Set(ALL_MARKET_IDS.map((id) => id.split(":")[0]))];
    expect(registryFamilies).not.toEqual([...SCANNER_MARKET_ORDER]);
    expect([...SCANNER_MARKET_ORDER]).not.toEqual(ALL_MARKET_IDS.slice(0, SCANNER_MARKET_ORDER.length));
  });

  it("the selection order is the D-09 order, frozen and free of duplicates", () => {
    expect([...SCANNER_SELECTION_ORDER]).toEqual(["HOME", "DRAW", "AWAY", "OVER_2_5", "UNDER_2_5", "YES", "NO"]);
    expect(Object.isFrozen(SCANNER_SELECTION_ORDER)).toBe(true);
    expect(new Set(SCANNER_SELECTION_ORDER).size).toBe(SCANNER_SELECTION_ORDER.length);
  });

  it("order lists reject in-place mutation", () => {
    const market = SCANNER_MARKET_ORDER as unknown as string[];
    const selection = SCANNER_SELECTION_ORDER as unknown as string[];
    expect(() => market.push("EXTRA")).toThrow();
    expect(() => selection.push("EXTRA")).toThrow();
    expect(SCANNER_MARKET_ORDER).toHaveLength(5);
    expect(SCANNER_SELECTION_ORDER).toHaveLength(7);
  });
});
