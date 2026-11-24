import { describe, expect, it } from "vitest";

import { closingObservationId, validateClosingOddsBook, type ClosingOddsBookInput, type ClosingOddsContext } from "../../packages/domain/src/evaluation/closing-odds.js";

const kickoff = "2026-12-01T20:00:00.000Z";
const context: ClosingOddsContext = { kickoffUtc: kickoff, nowUtc: "2026-12-01T19:00:00.000Z", fixtureSettled: false };
const book: ClosingOddsBookInput = {
  fixtureId: "fixture-1",
  market: "ONE_X_TWO",
  sourceConvention: "pinnacle",
  observedAt: "2026-12-01T18:55:00.000Z",
  selections: [{ selection: "HOME", decimalOdds: "2.10" }, { selection: "DRAW", decimalOdds: "3.40" }, { selection: "AWAY", decimalOdds: "3.60" }],
};

const code = (input: ClosingOddsBookInput, ctx: ClosingOddsContext = context) => {
  const result = validateClosingOddsBook(input, ctx);
  return result.ok ? "OK" : result.code;
};

describe("validateClosingOddsBook (CLV-01)", () => {
  it("accepts a complete pre-kickoff set and returns canonical MARKET_CLOSE rows in market order", () => {
    const result = validateClosingOddsBook(book, context);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows.map((row) => row.selection)).toEqual(["HOME", "DRAW", "AWAY"]);
    expect(result.rows.map((row) => row.decimalOdds)).toEqual(["2.1", "3.4", "3.6"]);
    expect(new Set(result.rows.map((row) => row.observationKind))).toEqual(new Set(["MARKET_CLOSE"]));
    expect(new Set(result.rows.map((row) => row.oddsFormat))).toEqual(new Set(["DECIMAL"]));
  });

  it.each([
    ["UNSUPPORTED_MARKET", { ...book, market: "ASIAN_HANDICAP" }],
    ["INVALID_SOURCE_CONVENTION", { ...book, sourceConvention: "  " }],
    ["INVALID_SOURCE_CONVENTION", { ...book, sourceConvention: " pinnacle" }],
    ["INVALID_OBSERVED_AT", { ...book, observedAt: "2026-12-01T18:55:00Z" }],
    ["INVALID_OBSERVED_AT", { ...book, observedAt: "not-a-date" }],
    ["DUPLICATE_SELECTION", { ...book, selections: [book.selections[0]!, book.selections[0]!, book.selections[2]!] }],
    ["INCOMPLETE_MARKET_SET", { ...book, selections: book.selections.slice(0, 2) }],
    ["INCOMPLETE_MARKET_SET", { ...book, selections: [{ selection: "OVER_2_5", decimalOdds: "1.9" }, { selection: "UNDER_2_5", decimalOdds: "1.9" }, { selection: "HOME", decimalOdds: "2" }] }],
    ["INVALID_ODDS", { ...book, selections: [{ selection: "HOME", decimalOdds: "1" }, book.selections[1]!, book.selections[2]!] }],
    ["INVALID_ODDS", { ...book, selections: [{ selection: "HOME", decimalOdds: "abc" }, book.selections[1]!, book.selections[2]!] }],
  ] as const)("rejects with %s", (expected, input) => {
    expect(code(input as ClosingOddsBookInput)).toBe(expected);
  });

  it("refuses chronology violations decided from the supplied clock, not the client", () => {
    expect(code(book, { ...context, fixtureSettled: true })).toBe("FIXTURE_ALREADY_SETTLED");
    expect(code(book, { ...context, nowUtc: kickoff })).toBe("RECORDED_AFTER_KICKOFF");
    expect(code(book, { ...context, nowUtc: "2026-12-01T20:30:00.000Z" })).toBe("RECORDED_AFTER_KICKOFF");
    expect(code({ ...book, observedAt: kickoff })).toBe("OBSERVED_AT_NOT_PRE_KICKOFF");
    expect(code({ ...book, observedAt: "2026-12-01T19:30:00.000Z" })).toBe("OBSERVED_AT_IN_FUTURE");
  });

  it("fixes the check order: structure, then settlement, then recorded-after-kickoff, then observedAt", () => {
    const late = { ...context, nowUtc: "2026-12-01T21:00:00.000Z", fixtureSettled: true };
    expect(code({ ...book, selections: book.selections.slice(0, 2) }, late)).toBe("INCOMPLETE_MARKET_SET");
    expect(code(book, late)).toBe("FIXTURE_ALREADY_SETTLED");
    expect(code({ ...book, observedAt: kickoff }, { ...late, fixtureSettled: false })).toBe("RECORDED_AFTER_KICKOFF");
  });

  it("derives a deterministic id from the five key fields and not from the odds value", () => {
    const first = validateClosingOddsBook(book, context);
    const again = validateClosingOddsBook(book, context);
    const otherOdds = validateClosingOddsBook({ ...book, selections: [{ selection: "HOME", decimalOdds: "2.50" }, book.selections[1]!, book.selections[2]!] }, context);
    const otherTime = validateClosingOddsBook({ ...book, observedAt: "2026-12-01T18:56:00.000Z" }, context);
    if (!first.ok || !again.ok || !otherOdds.ok || !otherTime.ok) throw new Error("expected valid books");
    expect(first.rows.map((row) => row.id)).toEqual(again.rows.map((row) => row.id));
    expect(otherOdds.rows[0]!.id).toBe(first.rows[0]!.id);
    expect(otherTime.rows[0]!.id).not.toBe(first.rows[0]!.id);
    expect(new Set(first.rows.map((row) => row.id)).size).toBe(3);
    expect(first.rows[0]!.id).toBe(closingObservationId({ fixtureId: "fixture-1", market: "ONE_X_TWO", selection: "HOME", sourceConvention: "pinnacle", observedAt: book.observedAt }));
  });
});
