import { describe, expect, it } from "vitest";

import { closingObservationId, validateClosingOddsBook, type ClosingOddsBookInput, type ClosingOddsContext } from "../../packages/domain/src/evaluation/closing-odds.js";

const KICKOFF = "2026-12-01T20:00:00.000Z";
const OBSERVED = "2026-12-01T19:55:00.000Z";
const NOW = "2026-12-01T19:58:00.000Z";

const context: ClosingOddsContext = { kickoffUtc: KICKOFF, nowUtc: NOW, fixtureSettled: false };
const book: ClosingOddsBookInput = {
  fixtureId: "fixture-1",
  market: "ONE_X_TWO",
  sourceConvention: "manual-source-a",
  observedAt: OBSERVED,
  selections: [
    { selection: "AWAY", decimalOdds: "4.20" },
    { selection: "HOME", decimalOdds: "1.90" },
    { selection: "DRAW", decimalOdds: "3.60" },
  ],
};

function withBook(patch: Partial<ClosingOddsBookInput>): ClosingOddsBookInput {
  return { ...book, ...patch };
}

describe("validateClosingOddsBook", () => {
  it("accepts a complete 1X2 set and returns canonical rows in market order", () => {
    const result = validateClosingOddsBook(book, context);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows.map((row) => row.selection)).toEqual(["HOME", "DRAW", "AWAY"]);
    expect(result.rows.map((row) => row.decimalOdds)).toEqual(["1.9", "3.6", "4.2"]);
    for (const row of result.rows) {
      expect(row.fixtureId).toBe("fixture-1");
      expect(row.market).toBe("ONE_X_TWO");
      expect(row.sourceConvention).toBe("manual-source-a");
      expect(row.observedAt).toBe(OBSERVED);
      expect(row.observationKind).toBe("MARKET_CLOSE");
      expect(row.oddsFormat).toBe("DECIMAL");
    }
  });

  it("accepts complete totals and BTTS sets", () => {
    const totals = validateClosingOddsBook(withBook({ market: "OVER_UNDER_2_5", selections: [{ selection: "UNDER_2_5", decimalOdds: "1.95" }, { selection: "OVER_2_5", decimalOdds: "1.85" }] }), context);
    expect(totals.ok && totals.rows.map((row) => row.selection)).toEqual(["OVER_2_5", "UNDER_2_5"]);
    const btts = validateClosingOddsBook(withBook({ market: "BTTS", selections: [{ selection: "NO", decimalOdds: "2.1" }, { selection: "YES", decimalOdds: "1.75" }] }), context);
    expect(btts.ok && btts.rows.map((row) => row.selection)).toEqual(["YES", "NO"]);
  });

  const rejections: ReadonlyArray<readonly [string, ClosingOddsBookInput, ClosingOddsContext, string]> = [
    ["UNSUPPORTED_MARKET", withBook({ market: "ASIAN_HANDICAP" as never }), context, "UNSUPPORTED_MARKET"],
    ["INVALID_SOURCE_CONVENTION (empty)", withBook({ sourceConvention: "" }), context, "INVALID_SOURCE_CONVENTION"],
    ["INVALID_SOURCE_CONVENTION (blank)", withBook({ sourceConvention: "   " }), context, "INVALID_SOURCE_CONVENTION"],
    ["INVALID_SOURCE_CONVENTION (not a string)", withBook({ sourceConvention: 7 as never }), context, "INVALID_SOURCE_CONVENTION"],
    ["INVALID_OBSERVED_AT (no milliseconds)", withBook({ observedAt: "2026-12-01T19:55:00Z" }), context, "INVALID_OBSERVED_AT"],
    ["INVALID_OBSERVED_AT (offset)", withBook({ observedAt: "2026-12-01T19:55:00.000+01:00" }), context, "INVALID_OBSERVED_AT"],
    ["INVALID_OBSERVED_AT (impossible date)", withBook({ observedAt: "2026-02-31T19:55:00.000Z" }), context, "INVALID_OBSERVED_AT"],
    ["OBSERVED_AT_NOT_PRE_KICKOFF (equal)", withBook({ observedAt: KICKOFF }), { ...context, nowUtc: "2026-12-01T20:00:00.000Z" }, "OBSERVED_AT_NOT_PRE_KICKOFF"],
    ["OBSERVED_AT_NOT_PRE_KICKOFF (after)", withBook({ observedAt: "2026-12-01T20:05:00.000Z" }), context, "OBSERVED_AT_NOT_PRE_KICKOFF"],
    ["OBSERVED_AT_IN_FUTURE", withBook({ observedAt: "2026-12-01T19:59:00.000Z" }), context, "OBSERVED_AT_IN_FUTURE"],
    ["RECORDED_AFTER_KICKOFF", book, { ...context, nowUtc: "2026-12-01T20:00:00.000Z" }, "RECORDED_AFTER_KICKOFF"],
    ["RECORDED_AFTER_KICKOFF (later)", book, { ...context, nowUtc: "2026-12-01T22:00:00.000Z" }, "RECORDED_AFTER_KICKOFF"],
    ["FIXTURE_ALREADY_SETTLED", book, { ...context, fixtureSettled: true }, "FIXTURE_ALREADY_SETTLED"],
    ["DUPLICATE_SELECTION", withBook({ selections: [{ selection: "HOME", decimalOdds: "1.9" }, { selection: "HOME", decimalOdds: "1.9" }, { selection: "DRAW", decimalOdds: "3.6" }] }), context, "DUPLICATE_SELECTION"],
    ["INCOMPLETE_MARKET_SET (missing)", withBook({ selections: [{ selection: "HOME", decimalOdds: "1.9" }, { selection: "DRAW", decimalOdds: "3.6" }] }), context, "INCOMPLETE_MARKET_SET"],
    ["INCOMPLETE_MARKET_SET (empty)", withBook({ selections: [] }), context, "INCOMPLETE_MARKET_SET"],
    ["INCOMPLETE_MARKET_SET (foreign selection)", withBook({ selections: [{ selection: "HOME", decimalOdds: "1.9" }, { selection: "DRAW", decimalOdds: "3.6" }, { selection: "OVER_2_5", decimalOdds: "1.9" }] }), context, "INCOMPLETE_MARKET_SET"],
    ["INCOMPLETE_MARKET_SET (extra)", withBook({ selections: [...book.selections, { selection: "YES", decimalOdds: "1.9" }] }), context, "INCOMPLETE_MARKET_SET"],
    ["INCOMPLETE_MARKET_SET (not an array)", withBook({ selections: null as never }), context, "INCOMPLETE_MARKET_SET"],
    ["INVALID_ODDS (equal to 1)", withBook({ selections: [{ selection: "HOME", decimalOdds: "1" }, { selection: "DRAW", decimalOdds: "3.6" }, { selection: "AWAY", decimalOdds: "4.2" }] }), context, "INVALID_ODDS"],
    ["INVALID_ODDS (below 1)", withBook({ selections: [{ selection: "HOME", decimalOdds: "0.9" }, { selection: "DRAW", decimalOdds: "3.6" }, { selection: "AWAY", decimalOdds: "4.2" }] }), context, "INVALID_ODDS"],
    ["INVALID_ODDS (not decimal)", withBook({ selections: [{ selection: "HOME", decimalOdds: "1e1" }, { selection: "DRAW", decimalOdds: "3.6" }, { selection: "AWAY", decimalOdds: "4.2" }] }), context, "INVALID_ODDS"],
    ["INVALID_ODDS (not a string)", withBook({ selections: [{ selection: "HOME", decimalOdds: 1.9 as never }, { selection: "DRAW", decimalOdds: "3.6" }, { selection: "AWAY", decimalOdds: "4.2" }] }), context, "INVALID_ODDS"],
  ];

  it.each(rejections)("rejects %s", (_label, input, ctx, code) => {
    expect(validateClosingOddsBook(input, ctx)).toEqual({ ok: false, code });
  });

  describe("check order is fixed", () => {
    const badEverything = withBook({ market: "ASIAN_HANDICAP" as never, sourceConvention: "", observedAt: "bad", selections: [] });
    const lateEverything: ClosingOddsContext = { kickoffUtc: KICKOFF, nowUtc: "2026-12-01T21:00:00.000Z", fixtureSettled: true };

    it("market is checked before source convention", () => {
      expect(validateClosingOddsBook(badEverything, lateEverything)).toEqual({ ok: false, code: "UNSUPPORTED_MARKET" });
    });
    it("source convention is checked before observedAt format", () => {
      expect(validateClosingOddsBook({ ...badEverything, market: "ONE_X_TWO" }, lateEverything)).toEqual({ ok: false, code: "INVALID_SOURCE_CONVENTION" });
    });
    it("observedAt format is checked before kickoff and clock checks", () => {
      expect(validateClosingOddsBook({ ...badEverything, market: "ONE_X_TWO", sourceConvention: "s" }, lateEverything)).toEqual({ ok: false, code: "INVALID_OBSERVED_AT" });
    });
    it("observedAt not pre-kickoff is checked before observedAt in future", () => {
      const input = withBook({ observedAt: "2026-12-01T20:30:00.000Z", selections: [] });
      expect(validateClosingOddsBook(input, { ...context, nowUtc: "2026-12-01T19:00:00.000Z" })).toEqual({ ok: false, code: "OBSERVED_AT_NOT_PRE_KICKOFF" });
    });
    it("observedAt in future is checked before recorded-after-kickoff", () => {
      const input = withBook({ observedAt: "2026-12-01T19:59:59.000Z", selections: [] });
      expect(validateClosingOddsBook(input, { ...context, nowUtc: "2026-12-01T19:00:00.000Z" })).toEqual({ ok: false, code: "OBSERVED_AT_IN_FUTURE" });
    });
    it("recorded-after-kickoff is checked before fixture-already-settled", () => {
      expect(validateClosingOddsBook(withBook({ selections: [] }), { ...context, nowUtc: "2026-12-01T20:10:00.000Z", fixtureSettled: true })).toEqual({ ok: false, code: "RECORDED_AFTER_KICKOFF" });
    });
    it("fixture-already-settled is checked before selection-set checks", () => {
      expect(validateClosingOddsBook(withBook({ selections: [] }), { ...context, fixtureSettled: true })).toEqual({ ok: false, code: "FIXTURE_ALREADY_SETTLED" });
    });
    it("duplicate selection is checked before incomplete set", () => {
      expect(validateClosingOddsBook(withBook({ selections: [{ selection: "HOME", decimalOdds: "1" }, { selection: "HOME", decimalOdds: "1" }] }), context)).toEqual({ ok: false, code: "DUPLICATE_SELECTION" });
    });
    it("incomplete set is checked before odds validity", () => {
      expect(validateClosingOddsBook(withBook({ selections: [{ selection: "HOME", decimalOdds: "0.5" }] }), context)).toEqual({ ok: false, code: "INCOMPLETE_MARKET_SET" });
    });
  });

  it("is a pure function of its arguments: repeated calls return equal results", () => {
    expect(validateClosingOddsBook(book, context)).toEqual(validateClosingOddsBook(book, context));
  });

  it("does not mutate its input", () => {
    const snapshot = JSON.stringify(book);
    validateClosingOddsBook(book, context);
    expect(JSON.stringify(book)).toBe(snapshot);
  });
});

describe("closingObservationId", () => {
  const key = { fixtureId: "fixture-1", market: "ONE_X_TWO", selection: "HOME", sourceConvention: "manual-source-a", observedAt: OBSERVED } as const;

  it("is deterministic across calls", () => {
    expect(closingObservationId(key)).toBe(closingObservationId({ ...key }));
  });

  it("is a 64-char sha256 hex digest with a stable prefix", () => {
    expect(closingObservationId(key)).toMatch(/^closing_[0-9a-f]{64}$/);
  });

  it("does not depend on the odds value", () => {
    const first = validateClosingOddsBook(book, context);
    const second = validateClosingOddsBook(withBook({ selections: book.selections.map((item) => ({ ...item, decimalOdds: "9.99" })) }), context);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.rows.map((row) => row.id)).toEqual(first.rows.map((row) => row.id));
    expect(second.rows.map((row) => row.decimalOdds)).not.toEqual(first.rows.map((row) => row.decimalOdds));
  });

  it("is deterministic across identical validation calls", () => {
    const first = validateClosingOddsBook(book, context);
    const second = validateClosingOddsBook(book, context);
    expect(first.ok && second.ok && first.rows.map((row) => row.id)).toEqual(second.ok && second.rows.map((row) => row.id));
  });

  it("row ids equal closingObservationId of the key fields", () => {
    const result = validateClosingOddsBook(book, context);
    expect(result.ok && result.rows.map((row) => row.id)).toEqual(["HOME", "DRAW", "AWAY"].map((selection) => closingObservationId({ ...key, selection })));
  });

  it.each([
    ["observedAt", { observedAt: "2026-12-01T19:56:00.000Z" }],
    ["fixtureId", { fixtureId: "fixture-2" }],
    ["market", { market: "BTTS" }],
    ["selection", { selection: "DRAW" }],
    ["sourceConvention", { sourceConvention: "manual-source-b" }],
  ])("changes when %s changes", (_field, patch) => {
    expect(closingObservationId({ ...key, ...patch })).not.toBe(closingObservationId(key));
  });

  it("is not ambiguous across field boundaries", () => {
    expect(closingObservationId({ ...key, fixtureId: "a", market: "bc" })).not.toBe(closingObservationId({ ...key, fixtureId: "ab", market: "c" }));
  });
});
