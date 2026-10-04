import { describe, expect, it, vi } from "vitest";

import { parseOddsBook } from "../../packages/domain/src/odds/contract.js";
import { normalizeOddsBook } from "../../packages/domain/src/odds/normalize.js";
import { clearOddsDraftAfterSubmission, parseOddsDraft, serializeOddsDraft } from "../../packages/domain/src/odds/draft.js";

const cutoff = "2026-09-13T12:00:00.000Z";

describe("complete manual odds books", () => {
  it.each([
    ["ONE_X_TWO", [["HOME", "2.4"], ["DRAW", "3.4"], ["AWAY", "3.1"]], "0.0333649588867805187"],
    ["OVER_UNDER_2_5", [["OVER_2_5", "1.9"], ["UNDER_2_5", "2.05"]], "0.0141206675224646983"],
    ["BTTS", [["YES", "1.8"], ["NO", "2.1"]], "0.031746031746031746"],
  ] as const)("normalizes %s multiplicatively", (market, entries, expectedOverround) => {
    const result = normalizeOddsBook({ fixtureId: "fixture-1", oddsSnapshotId: "odds-1", market, sourceLabel: "book", capturedAt: cutoff, selections: entries.map(([selection, decimalOdds]) => ({ selection, decimalOdds })) });
    expect(result.normalizationVersion).toBe("multiplicative-v1");
    expect(result.selections.reduce((sum, row) => sum + Number(row.noVigProbability), 0)).toBeCloseTo(1, 12);
    expect(result.overround).toBe(expectedOverround);
  });

  it.each([
    ["INCOMPLETE_ODDS_BOOK", [{ selection: "YES", decimalOdds: "2" }]],
    ["DUPLICATE_ODDS_SELECTION", [{ selection: "YES", decimalOdds: "2" }, { selection: "YES", decimalOdds: "2.1" }]],
    ["INVALID_DECIMAL_ODDS", [{ selection: "YES", decimalOdds: "NaN" }, { selection: "NO", decimalOdds: "2" }]],
    ["INVALID_DECIMAL_ODDS", [{ selection: "YES", decimalOdds: "Infinity" }, { selection: "NO", decimalOdds: "2" }]],
    ["INVALID_DECIMAL_ODDS", [{ selection: "YES", decimalOdds: "1" }, { selection: "NO", decimalOdds: "2" }]],
  ])("rejects invalid books with stable code %s", (code, selections) => {
    expect(() => normalizeOddsBook({ fixtureId: "fixture-1", oddsSnapshotId: "odds-1", market: "BTTS", sourceLabel: "book", capturedAt: cutoff, selections: selections as never })).toThrow(code);
  });
});

describe("local partial odds drafts", () => {
  const draft = { schemaVersion: "manual-odds-draft-v1" as const, analyzable: false as const, fixtureId: "fixture-1", market: "ONE_X_TWO" as const, sourceLabel: "local book", fields: [{ selection: "HOME" as const, decimalOdds: "2." }, { selection: "DRAW" as const, decimalOdds: "" }] };

  it("round-trips only entered strings and remains non-analyzable", () => {
    const parsed = parseOddsDraft(serializeOddsDraft(draft));
    expect(parsed).toEqual(draft);
    expect(parsed.analyzable).toBe(false);
    expect(parsed).not.toHaveProperty("oddsSnapshotId");
    expect(parsed).not.toHaveProperty("normalizedProbabilities");
    expect(parsed).not.toHaveProperty("result");
    expect(() => parseOddsBook(parsed)).toThrow("INVALID_ODDS_BOOK_KEYS");
  });

  it("clears only after a successful immutable submission", () => {
    const storage = { removeItem: vi.fn() };
    expect(clearOddsDraftAfterSubmission(storage, "draft:key", { status: "FAILED" })).toBe(false);
    expect(storage.removeItem).not.toHaveBeenCalled();
    expect(clearOddsDraftAfterSubmission(storage, "draft:key", { status: "SUBMITTED", oddsSnapshotId: "odds-1" })).toBe(true);
    expect(storage.removeItem).toHaveBeenCalledWith("draft:key");
  });
});
