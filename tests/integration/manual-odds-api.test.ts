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
const kickoffUtc = "2026-09-10T18:00:00.000Z";
const serverNow = new Date("2026-09-06T12:00:00.000Z");
const fixture = async () => ({ kickoffUtc });

describe("manual odds API", () => {
  it("rejects malformed, derived, draft, duplicate, and incomplete books before repository mutation", async () => {
    const { submitManualOdds } = await import("../../apps/api/src/modules/odds/odds.service.js");
    let mutations = 0;
    const repository = { findFixture: fixture, append: async () => { mutations += 1; throw new Error("unexpected mutation"); } };

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
    const result = await submitManualOdds(input, { findFixture: fixture, append: async (book) => { appended.push(book); return book; } }, serverNow);
    expect(appended).toHaveLength(1);
    expect(result).toMatchObject({ schemaVersion: "manual-odds-v1", normalizationVersion: "multiplicative-v1", sourceLabel: "Local bookmaker" });
    expect(result.selections.reduce((sum, row) => sum + Number(row.noVigProbability), 0)).toBeCloseTo(1, 12);
    expect(Number(result.overround)).toBeCloseTo(result.selections.reduce((sum, row) => sum + Number(row.impliedProbability), 0) - 1, 12);
  });

  it("requires compatible replacement snapshots and preserves the prior row", async () => {
    const { submitManualOdds } = await import("../../apps/api/src/modules/odds/odds.service.js");
    const result = await submitManualOdds({ ...completeBook, oddsSnapshotId: "odds-2", replacementOfOddsSnapshotId: "odds-1" }, {
      findFixture: fixture,
      find: async () => ({ fixtureId: "fixture-1", market: "ONE_X_TWO" }),
      append: async (book) => book,
    }, serverNow);
    expect(result.replacementOfOddsSnapshotId).toBe("odds-1");
  });

  it("includes normalized source and replacement lineage in canonical identity", async () => {
    const { submitManualOdds } = await import("../../apps/api/src/modules/odds/odds.service.js");
    const hashes: string[] = [];
    const repository = { findFixture: fixture, find: async () => ({ fixtureId: "fixture-1", market: "ONE_X_TWO" }), append: async (book: typeof completeBook & { inputHash: string }) => { hashes.push(book.inputHash); return book as never; } };
    await submitManualOdds({ ...completeBook, oddsSnapshotId: "source-a", sourceLabel: "  Book A  " }, repository, serverNow);
    await submitManualOdds({ ...completeBook, oddsSnapshotId: "source-b", sourceLabel: "Book B" }, repository, serverNow);
    await submitManualOdds({ ...completeBook, oddsSnapshotId: "replacement", sourceLabel: "Book A", replacementOfOddsSnapshotId: "prior" }, repository, serverNow);
    expect(new Set(hashes).size).toBe(3);
  });

  it.each([
    ["2026-08-11T17:59:59.999Z", "ODDS_CAPTURE_BEFORE_WINDOW"],
    ["2026-09-10T18:00:00.000Z", "ODDS_CAPTURE_NOT_BEFORE_KICKOFF"],
    ["2026-09-06T12:05:00.001Z", "ODDS_CAPTURE_AFTER_CLOCK_SKEW"],
  ])("rejects capture chronology outside the fixture window: %s", async (capturedAt, code) => {
    const { submitManualOdds } = await import("../../apps/api/src/modules/odds/odds.service.js");
    let mutations = 0;
    await expect(submitManualOdds({ ...completeBook, capturedAt }, { findFixture: fixture, append: async () => { mutations += 1; throw new Error("unexpected mutation"); } }, serverNow)).rejects.toMatchObject({ code });
    expect(mutations).toBe(0);
  });

  it.each([
    ["2026-08-11T18:00:00.000Z", "2026-09-06T12:00:00.000Z"],
    ["2026-09-10T17:59:59.999Z", "2026-09-10T17:55:00.000Z"],
    ["2026-09-06T12:05:00.000Z", "2026-09-06T12:00:00.000Z"],
  ])("accepts capture chronology at an inclusive boundary: %s", async (capturedAt, now) => {
    const { submitManualOdds } = await import("../../apps/api/src/modules/odds/odds.service.js");
    await expect(submitManualOdds({ ...completeBook, capturedAt }, { findFixture: fixture, append: async (book) => book }, new Date(now))).resolves.toMatchObject({ capturedAt });
  });

  it("rejects a missing canonical fixture before append", async () => {
    const { submitManualOdds } = await import("../../apps/api/src/modules/odds/odds.service.js");
    let mutations = 0;
    await expect(submitManualOdds(completeBook, { findFixture: async () => null, append: async () => { mutations += 1; throw new Error("unexpected mutation"); } }, serverNow)).rejects.toMatchObject({ code: "ODDS_FIXTURE_NOT_FOUND" });
    expect(mutations).toBe(0);
  });

  it("scopes immutable odds retrieval to the owning fixture without disclosing cross-fixture IDs", async () => {
    const { getManualOddsSnapshot } = await import("../../apps/api/src/modules/odds/odds.service.js");
    const stored = { oddsSnapshotId: "odds-1", fixtureId: "fixture-1" };
    const repository = { get: async (fixtureId: string, oddsSnapshotId: string) => fixtureId === stored.fixtureId && oddsSnapshotId === stored.oddsSnapshotId ? stored : null };
    await expect(getManualOddsSnapshot("fixture-1", "odds-1", repository as never)).resolves.toEqual(stored);
    await expect(getManualOddsSnapshot("fixture-2", "odds-1", repository as never)).rejects.toMatchObject({ response: { code: "ODDS_SNAPSHOT_NOT_FOUND" } });
    await expect(getManualOddsSnapshot("fixture-1", "missing", repository as never)).rejects.toMatchObject({ response: { code: "ODDS_SNAPSHOT_NOT_FOUND" } });
  });

  it("passes both fixture and snapshot route parameters through the controller", async () => {
    const { OddsController } = await import("../../apps/api/src/modules/odds/odds.controller.js");
    const calls: string[][] = [];
    const controller = new OddsController({ get: async (...args: string[]) => { calls.push(args); return {} as never; } } as never);
    await controller.get("fixture-1", "odds-1");
    expect(calls).toEqual([["fixture-1", "odds-1"]]);
  });
});
