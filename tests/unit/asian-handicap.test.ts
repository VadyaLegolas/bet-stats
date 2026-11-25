import { describe, expect, it } from "vitest";

import { createForecast } from "../../packages/domain/src/forecast/model.js";
import {
  AH_LINES_V1,
  AH_RETURN_SHARES,
  ahBreakdown,
  ahFairOdds,
  ahLineView,
  parseAhLineToken,
  settleAsianHandicap,
} from "../../packages/domain/src/markets/asian-handicap.js";
import { buildScoreMatrixV1 } from "../../packages/domain/src/markets/score-matrix.js";
import type { EvidenceProjectionDto } from "../../packages/domain/src/evidence/contract.js";

const cutoff = "2026-09-13T12:00:00.000Z";

function projection(side: "home" | "away"): EvidenceProjectionDto {
  const source = { observationId: `${side}-observation`, provider: "API_FOOTBALL", providerFixtureId: `${side}-external`, effectiveAt: "2026-09-10T12:00:00.000Z", observedAt: cutoff, payloadHash: `sha256:${side}`, payloadBytes: 42 };
  const component = (kind: string, value: unknown, sampleSize = 10) => ({ kind, value, unit: "test", sampleSize, limitation: null, sourceRefs: [source] });
  return {
    teamId: side, requestedAsOf: cutoff, resolvedAsOfUtc: cutoff, cutoffBoundary: { observedAt: cutoff }, state: "COMPLETE", freshness: "FRESH", buildId: `build-${side}`, publishedAt: cutoff,
    receipt: { requestedAsOf: cutoff, resolvedAsOf: cutoff, configVersion: "evidence-v1", sourceWindow: { requestedFrom: null, requestedTo: cutoff, returnedFrom: source.effectiveAt, returnedTo: source.effectiveAt }, inputs: [source] },
    coverage: { requestedFrom: null, requestedTo: cutoff, returnedFrom: source.effectiveAt, returnedTo: source.effectiveAt },
    components: {
      form5: component("form5", side === "home" ? 2.1 : 1.2, 5), form10: component("form10", side === "home" ? 1.9 : 1.3), elo: component("elo", side === "home" ? 1640 : 1420),
      homeStrength: component("homeStrength", 2.3), awayStrength: component("awayStrength", 0.9),
      goalRates: component("goalRates", side === "home" ? { for: 6, against: 0.2 } : { for: 0.2, against: 6 }),
      restDays: component("restDays", side === "home" ? 20 : 1, 1), h2h: component("h2h", { pointsPerMatch: side === "home" ? 3 : 0, weight: 0.03 }, 4),
    },
  };
}

const forecast = createForecast({ fixtureId: "fixture-1", forecastSnapshotId: "forecast-1", cutoff, canonicalIdentityState: "RESOLVED", home: projection("home"), away: projection("away"), lineupAvailable: false, sourceReliability: 0.8 });
const cells = buildScoreMatrixV1(forecast.scoreMatrix, forecast.retainedMass).cells;

describe("ah-lines-v1 tokens", () => {
  it("lists 21 canonical home lines from -2.5 to +2.5", () => {
    expect(AH_LINES_V1.version).toBe("ah-lines-v1");
    expect(AH_LINES_V1.lines).toHaveLength(21);
    expect(AH_LINES_V1.lines[0]).toBe("-2.5");
    expect(AH_LINES_V1.lines[10]).toBe("0");
    expect(AH_LINES_V1.lines.at(-1)).toBe("+2.5");
    expect(AH_LINES_V1.lines).toEqual(expect.arrayContaining(["-2.25", "-2", "-1.75", "-0.75", "-0.25", "+0.25", "+1", "+1.5"]));
  });

  it("accepts only members of the list, never a numeric parse", () => {
    for (const token of AH_LINES_V1.lines) expect(parseAhLineToken(token)).toBe(token);
    for (const token of ["+1.00", "0.0", "-0", "1e0", "+0", "1", "+2.75", "-3", "", " 0", null, 0, undefined]) expect(parseAhLineToken(token)).toBeNull();
  });
});

describe("settleAsianHandicap (ah-settlement-v1)", () => {
  it("settles the level line: 1-1 PUSH, 2-1 WIN, 0-1 LOSS", () => {
    expect(settleAsianHandicap("0", "HOME", 1, 1).result).toBe("PUSH");
    expect(settleAsianHandicap("0", "HOME", 2, 1).result).toBe("WIN");
    expect(settleAsianHandicap("0", "HOME", 0, 1).result).toBe("LOSS");
    expect(settleAsianHandicap("0", "AWAY", 0, 1).result).toBe("WIN");
  });

  it("uses only WIN, PUSH and LOSS on whole and half lines", () => {
    for (const line of AH_LINES_V1.lines.filter((token) => Number(token) % 0.5 === 0)) {
      for (const side of ["HOME", "AWAY"] as const) {
        for (let home = 0; home <= 7; home += 1) for (let away = 0; away <= 7; away += 1) expect(["WIN", "PUSH", "LOSS"]).toContain(settleAsianHandicap(line, side, home, away).result);
      }
    }
  });

  it("splits quarter lines over the two adjacent lines", () => {
    expect(settleAsianHandicap("-0.25", "HOME", 1, 1).result).toBe("HALF_LOSS");
    expect(settleAsianHandicap("+0.25", "HOME", 1, 1).result).toBe("HALF_WIN");
    expect(settleAsianHandicap("-0.75", "HOME", 1, 0).result).toBe("HALF_WIN");
    expect(settleAsianHandicap("-0.75", "HOME", 2, 0).result).toBe("WIN");
    expect(settleAsianHandicap("+0.75", "HOME", 0, 1).result).toBe("HALF_LOSS");
    expect(settleAsianHandicap("-1.25", "HOME", 1, 0).result).toBe("HALF_LOSS");
  });

  it("mirrors the line for the away side", () => {
    for (const line of AH_LINES_V1.lines) {
      const mirrored = line === "0" ? "0" : line.startsWith("-") ? `+${line.slice(1)}` : `-${line.slice(1)}`;
      for (let home = 0; home <= 4; home += 1) for (let away = 0; away <= 4; away += 1) {
        expect(settleAsianHandicap(line, "AWAY", home, away).result).toBe(settleAsianHandicap(mirrored, "HOME", away, home).result);
      }
    }
  });

  it("rejects a line outside the list", () => {
    expect(() => settleAsianHandicap("+1.00", "HOME", 1, 0)).toThrow("INVALID_AH_LINE");
  });

  it("pins the return shares per unit stake (D-15)", () => {
    expect(AH_RETURN_SHARES).toEqual({
      WIN: { oddsShare: 1, refundShare: 0 },
      HALF_WIN: { oddsShare: 0.5, refundShare: 0.5 },
      PUSH: { oddsShare: 0, refundShare: 1 },
      HALF_LOSS: { oddsShare: 0, refundShare: 0.5 },
      LOSS: { oddsShare: 0, refundShare: 0 },
    });
    expect(settleAsianHandicap("-0.25", "HOME", 1, 1).shares).toBe(AH_RETURN_SHARES.HALF_LOSS);
  });
});

describe("ahBreakdown and fair odds on a createForecast matrix", () => {
  it.each(AH_LINES_V1.lines)("sums the five outcomes to one on line %s for both sides", (line) => {
    for (const side of ["HOME", "AWAY"] as const) {
      const breakdown = ahBreakdown(cells, line, side);
      const total = breakdown.WIN + breakdown.HALF_WIN + breakdown.PUSH + breakdown.HALF_LOSS + breakdown.LOSS;
      expect(Math.abs(total - 1)).toBeLessThanOrEqual(1e-12);
    }
  });

  it("gives home and away complementary outcomes on the same line", () => {
    const home = ahBreakdown(cells, "-0.75", "HOME");
    const away = ahBreakdown(cells, "-0.75", "AWAY");
    expect(away.WIN).toBeCloseTo(home.LOSS, 12);
    expect(away.HALF_WIN).toBeCloseTo(home.HALF_LOSS, 12);
    expect(away.PUSH).toBeCloseTo(home.PUSH, 12);
  });

  it("makes the expected value of a stake at the fair odds zero", () => {
    for (const line of ["0", "-0.25", "-0.5", "-0.75", "+1.25"]) {
      const breakdown = ahBreakdown(cells, line, "HOME");
      const fair = ahFairOdds(breakdown);
      expect(fair.status).toBe("AVAILABLE");
      if (fair.status !== "AVAILABLE") continue;
      const odds = Number(fair.odds);
      let expectedReturn = 0;
      for (const result of ["WIN", "HALF_WIN", "PUSH", "HALF_LOSS", "LOSS"] as const) expectedReturn += breakdown[result] * (AH_RETURN_SHARES[result].oddsShare * odds + AH_RETURN_SHARES[result].refundShare);
      expect(expectedReturn).toBeCloseTo(1, 9);
    }
  });

  it("reports fair odds unavailable instead of Infinity or NaN when the stake can never win", () => {
    const never = { WIN: 0, HALF_WIN: 0, PUSH: 0.2, HALF_LOSS: 0.3, LOSS: 0.5 };
    expect(ahFairOdds(never)).toEqual({ status: "UNAVAILABLE", reason: "NO_WIN_PROBABILITY" });
  });

  it("builds the view of line 0 for both sides", () => {
    const view = ahLineView(cells, "0");
    expect(view.line).toBe("0");
    expect(view.home.effectiveWinProbability).toBeCloseTo(view.home.breakdown.WIN, 15);
    expect(view.home.fairOdds.status).toBe("AVAILABLE");
    expect(view.home.breakdown.HALF_WIN).toBe(0);
    expect(() => ahLineView(cells, "0.0")).toThrow("INVALID_AH_LINE");
  });
});
