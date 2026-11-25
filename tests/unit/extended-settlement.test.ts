import { describe, expect, it } from "vitest";

import { AH_LINES_V1, AH_RETURN_SHARES, settleAsianHandicap, type AhResult } from "../../packages/domain/src/markets/asian-handicap.js";
import { ALL_MARKET_IDS, marketFamilyOf, selectionsFor, type MarketId } from "../../packages/domain/src/markets/registry.js";
import {
  AH_SETTLEMENT_VERSION,
  EXACT_SCORE_SETTLEMENT_VERSION,
  SETTLEMENT_RULES,
  settleExactScore,
  settleExtendedMarket,
  settlementPolicyFor,
} from "../../packages/domain/src/markets/settlement.js";

const GOALS = Array.from({ length: 11 }, (_, goals) => goals);

describe("settlement rule versions", () => {
  it("pins both rule versions", () => {
    expect(AH_SETTLEMENT_VERSION).toBe("ah-settlement-v1");
    expect(EXACT_SCORE_SETTLEMENT_VERSION).toBe("exact-score-settlement-v1");
  });
});

describe("settleAsianHandicap outcome table (D-15)", () => {
  it.each([
    ["-1", "HOME", 2, 0, "WIN"],
    ["-1", "HOME", 1, 0, "PUSH"],
    ["-1", "HOME", 0, 0, "LOSS"],
    ["-0.5", "HOME", 1, 0, "WIN"],
    ["-0.5", "HOME", 0, 0, "LOSS"],
    ["-0.75", "HOME", 2, 0, "WIN"],
    ["-0.75", "HOME", 1, 0, "HALF_WIN"],
    ["-0.75", "HOME", 0, 0, "LOSS"],
    ["-0.25", "HOME", 1, 0, "WIN"],
    ["-0.25", "HOME", 0, 0, "HALF_LOSS"],
    ["+0.25", "HOME", 0, 0, "HALF_WIN"],
    ["+0.25", "HOME", 0, 1, "LOSS"],
    ["+0.75", "HOME", 0, 1, "HALF_LOSS"],
    ["+0.75", "HOME", 0, 2, "LOSS"],
    ["+0.75", "HOME", 0, 0, "WIN"],
  ] as const)("line %s %s %i-%i is %s", (line, side, home, away, expected) => {
    expect(settleAsianHandicap(line, side, home, away).result).toBe(expected);
  });

  it("returns the share of the odds and the flat refund share of the result", () => {
    for (const result of ["WIN", "HALF_WIN", "PUSH", "HALF_LOSS", "LOSS"] as const) {
      const sample = { WIN: ["-0.5", 1, 0], HALF_WIN: ["-0.75", 1, 0], PUSH: ["-1", 1, 0], HALF_LOSS: ["-0.25", 0, 0], LOSS: ["-0.5", 0, 0] } as const;
      const [line, home, away] = sample[result];
      const settled = settleAsianHandicap(line, "HOME", home, away);
      expect(settled.result).toBe(result);
      expect(settled.shares).toEqual(AH_RETURN_SHARES[result]);
    }
  });
});

/** Odds-share and refund-share of the stake on a single (non-split) line. */
function returnOn(line: string, side: "HOME" | "AWAY", home: number, away: number): { oddsShare: number; refundShare: number } {
  return settleAsianHandicap(line, side, home, away).shares;
}

describe("quarter lines average the two adjacent lines (D-15, D-22)", () => {
  const adjacent: Readonly<Record<string, readonly [string, string]>> = {
    "-2.25": ["-2", "-2.5"], "-1.75": ["-1.5", "-2"], "-1.25": ["-1", "-1.5"], "-0.75": ["-0.5", "-1"], "-0.25": ["0", "-0.5"],
    "+0.25": ["0", "+0.5"], "+0.75": ["+0.5", "+1"], "+1.25": ["+1", "+1.5"], "+1.75": ["+1.5", "+2"], "+2.25": ["+2", "+2.5"],
  };

  it.each(Object.keys(adjacent))("line %s on every score 0..10 x 0..10 and both sides", (line) => {
    const [first, second] = adjacent[line]!;
    // A line token is always home-perspective; the side only selects whose margin is used, so the same neighbours apply.
    for (const side of ["HOME", "AWAY"] as const) {
      for (const home of GOALS) {
        for (const away of GOALS) {
          const shares = returnOn(line, side, home, away);
          const a = returnOn(first, side, home, away);
          const b = returnOn(second, side, home, away);
          expect(shares.oddsShare).toBeCloseTo((a.oddsShare + b.oddsShare) / 2, 12);
          expect(shares.refundShare).toBeCloseTo((a.refundShare + b.refundShare) / 2, 12);
        }
      }
    }
  });
});

describe("settleAsianHandicap properties (D-22)", () => {
  const result = (line: string, side: "HOME" | "AWAY", home: number, away: number): AhResult => settleAsianHandicap(line, side, home, away).result;
  const swap: Readonly<Record<AhResult, AhResult>> = { WIN: "LOSS", LOSS: "WIN", HALF_WIN: "HALF_LOSS", HALF_LOSS: "HALF_WIN", PUSH: "PUSH" };

  it.each(AH_LINES_V1.lines)("the away side of line %s mirrors the home side", (line) => {
    for (const home of GOALS) {
      for (const away of GOALS) {
        expect(result(line, "AWAY", home, away)).toBe(swap[result(line, "HOME", home, away)]);
      }
    }
  });

  it("the level line pushes exactly on a draw", () => {
    for (const home of GOALS) for (const away of GOALS) expect(result("0", "HOME", home, away) === "PUSH").toBe(home === away);
  });

  it("whole lines push exactly on the margin", () => {
    for (const [line, margin] of [["-1", 1], ["-2", 2], ["+1", -1], ["+2", -2]] as const) {
      for (const home of GOALS) for (const away of GOALS) expect(result(line, "HOME", home, away) === "PUSH").toBe(home - away === margin);
    }
  });
});

describe("settleExactScore (exact-score-settlement-v1)", () => {
  it("a listed score wins only on that exact score", () => {
    expect(settleExactScore("2-1", 2, 1)).toEqual({ result: "WIN", shares: AH_RETURN_SHARES.WIN });
    for (const [home, away] of [[1, 2], [2, 2], [2, 0], [3, 1], [5, 5]] as const) expect(settleExactScore("2-1", home, away).result).toBe("LOSS");
  });

  it("OTHER wins when either side scored above three and loses on every listed score", () => {
    for (const home of GOALS) {
      for (const away of GOALS) expect(settleExactScore("OTHER", home, away).result).toBe(home > 3 || away > 3 ? "WIN" : "LOSS");
    }
  });

  it("any score above three goals is settled as OTHER, never as a listed cell", () => {
    expect(settleExactScore("3-3", 4, 3).result).toBe("LOSS");
    expect(settleExactScore("0-0", 0, 4).result).toBe("LOSS");
    expect(settleExactScore("OTHER", 0, 4).result).toBe("WIN");
  });

  it.each([[-1, 0], [0, -1], [1.5, 0], [0, 0.5], [Number.NaN, 0], [Number.POSITIVE_INFINITY, 0]])("rejects the final score %s-%s", (home, away) => {
    expect(() => settleExactScore("0-0", home, away)).toThrow("INVALID_FINAL_SCORE");
  });

  it("rejects a selection outside the closed list", () => {
    expect(() => settleExactScore("4-0", 4, 0)).toThrow("INVALID_EXACT_SCORE_SELECTION");
  });
});

describe("registry exhaustiveness of settlement rules (D-17)", () => {
  it("every one of the 25 registered markets has a settlement policy", () => {
    expect(ALL_MARKET_IDS).toHaveLength(25);
    for (const market of ALL_MARKET_IDS) {
      const family = marketFamilyOf(market);
      expect(family).not.toBeNull();
      const policy = settlementPolicyFor(market);
      expect(policy).toBe(family === "ASIAN_HANDICAP" || family === "EXACT_SCORE" ? "flat-one-unit-v2" : "flat-one-unit-v1");
      expect(SETTLEMENT_RULES[family!].policy).toBe(policy);
    }
  });

  it("the three core markets stay on flat-one-unit-v1 and are not settled by the extended rules", () => {
    for (const market of ["ONE_X_TWO", "OVER_UNDER_2_5", "BTTS"] as const) {
      expect(settlementPolicyFor(market)).toBe("flat-one-unit-v1");
      expect(() => settleExtendedMarket({ market, selection: selectionsFor(market)![0]!, homeGoals: 1, awayGoals: 0 })).toThrow("NOT_AN_EXTENDED_MARKET");
    }
  });

  it("every extended market settles every one of its selections", () => {
    const extended = ALL_MARKET_IDS.filter((market: MarketId) => settlementPolicyFor(market) === "flat-one-unit-v2");
    expect(extended).toHaveLength(22);
    for (const market of extended) {
      for (const selection of selectionsFor(market)!) {
        const settled = settleExtendedMarket({ market, selection, homeGoals: 2, awayGoals: 1 });
        expect(["WIN", "HALF_WIN", "PUSH", "HALF_LOSS", "LOSS"]).toContain(settled.result);
        expect(settled.shares).toEqual(AH_RETURN_SHARES[settled.result]);
      }
    }
  });

  it("an extended Asian handicap market delegates to the single settlement function", () => {
    expect(settleExtendedMarket({ market: "ASIAN_HANDICAP:-0.75", selection: "HOME", homeGoals: 1, awayGoals: 0 }).result).toBe("HALF_WIN");
    expect(settleExtendedMarket({ market: "ASIAN_HANDICAP:-0.75", selection: "AWAY", homeGoals: 1, awayGoals: 0 }).result).toBe("HALF_LOSS");
    expect(settleExtendedMarket({ market: "EXACT_SCORE", selection: "1-0", homeGoals: 1, awayGoals: 0 }).result).toBe("WIN");
  });

  it("an unknown market fails with UNSETTLEABLE_MARKET at runtime", () => {
    expect(() => settlementPolicyFor("ASIAN_HANDICAP:-3" as MarketId)).toThrow("UNSETTLEABLE_MARKET");
    expect(() => settleExtendedMarket({ market: "CORNERS" as MarketId, selection: "HOME", homeGoals: 0, awayGoals: 0 })).toThrow("UNSETTLEABLE_MARKET");
  });

  it("rejects a selection that does not belong to the market", () => {
    expect(() => settleExtendedMarket({ market: "ASIAN_HANDICAP:-0.75", selection: "DRAW", homeGoals: 1, awayGoals: 0 })).toThrow("INVALID_SELECTION");
    expect(() => settleExtendedMarket({ market: "EXACT_SCORE", selection: "HOME", homeGoals: 1, awayGoals: 0 })).toThrow("INVALID_SELECTION");
  });
});
