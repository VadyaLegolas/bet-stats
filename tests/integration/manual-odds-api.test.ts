import { describe, expect, it } from "vitest";

const completeBook = {
  fixtureId: "fixture-1",
  oddsSnapshotId: "odds-1",
  market: "ONE_X_TWO",
  sourceLabel: "Local bookmaker",
  capturedAt: "2026-09-06T12:00:00.000Z",
  selections: [
    { selection: "HOME", decimalOdds: "2.2" },
    { selection: "DRAW", decimalOdds: "3.4" },
    { selection: "AWAY", decimalOdds: "3.6" },
  ],
};

describe("manual odds API", () => {
  it("rejects malformed, derived, draft, duplicate, and incomplete books before repository mutation", async () => {
    const { submitManualOdds } = await import("../../apps/api/src/modules/odds/odds.service.js");
    let mutations = 0;
    const repository = { append: async () => { mutations += 1; throw new Error("unexpected mutation"); } };

    await expect(submitManualOdds({ ...completeBook, draft: true }, repository)).rejects.toMatchObject({ code: "INVALID_ODDS_BOOK_KEYS" });
    await expect(submitManualOdds({ ...completeBook, overround: "0.1" }, repository)).rejects.toMatchObject({ code: "INVALID_ODDS_BOOK_KEYS" });
    await expect(submitManualOdds({ ...completeBook, selections: completeBook.selections.slice(0, 2) }, repository)).rejects.toMatchObject({ code: "INCOMPLETE_ODDS_BOOK" });
    await expect(submitManualOdds({ ...completeBook, selections: [completeBook.selections[0], completeBook.selections[0], completeBook.selections[2]] }, repository)).rejects.toMatchObject({ code: "DUPLICATE_ODDS_SELECTION" });
    await expect(submitManualOdds({ ...completeBook, selections: [{ selection: "HOME", decimalOdds: "NaN" }, ...completeBook.selections.slice(1)] }, repository)).rejects.toMatchObject({ code: "INVALID_DECIMAL_ODDS" });
    for (const decimalOdds of ["1e100", "+2.1", "2.123456789012345678901", "9".repeat(129)]) {
      await expect(submitManualOdds({ ...completeBook, selections: [{ selection: "HOME", decimalOdds }, ...completeBook.selections.slice(1)] }, repository)).rejects.toMatchObject({ code: "INVALID_DECIMAL_ODDS", response: expect.objectContaining({ field: "selections.decimalOdds" }) });
    }
    await expect(submitManualOdds({ ...completeBook, capturedAt: "2026-09-06T12:00:00Z" }, repository)).rejects.toMatchObject({ code: "INVALID_ODDS_CAPTURED_AT" });
    expect(mutations).toBe(0);
  });

  it.each([
    ["ONE_X_TWO", ["HOME", "DRAW", "AWAY"]],
    ["OVER_UNDER_2_5", ["OVER_2_5", "UNDER_2_5"]],
    ["BTTS", ["YES", "NO"]],
  ] as const)("normalizes and appends a complete %s book", async (market, selections) => {
    const { submitManualOdds } = await import("../../apps/api/src/modules/odds/odds.service.js");
    const appended: unknown[] = [];
    const input = { ...completeBook, market, selections: selections.map((selection, index) => ({ selection, decimalOdds: String(2 + index) })) };
    const result = await submitManualOdds(input, { append: async (book) => { appended.push(book); return book; } });
    expect(appended).toHaveLength(1);
    expect(result).toMatchObject({ schemaVersion: "manual-odds-v1", normalizationVersion: "multiplicative-v1", sourceLabel: "Local bookmaker" });
    expect(result.selections.reduce((sum, row) => sum + Number(row.noVigProbability), 0)).toBeCloseTo(1, 12);
    expect(Number(result.overround)).toBeCloseTo(result.selections.reduce((sum, row) => sum + Number(row.impliedProbability), 0) - 1, 12);
  });

  it("requires compatible replacement snapshots and preserves the prior row", async () => {
    const { submitManualOdds } = await import("../../apps/api/src/modules/odds/odds.service.js");
    const result = await submitManualOdds({ ...completeBook, oddsSnapshotId: "odds-2", replacementOfOddsSnapshotId: "odds-1" }, {
      find: async () => ({ fixtureId: "fixture-1", market: "ONE_X_TWO" }),
      append: async (book) => book,
    });
    expect(result.replacementOfOddsSnapshotId).toBe("odds-1");
  });
});
