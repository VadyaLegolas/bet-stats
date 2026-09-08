import { Decimal } from "decimal.js";

export type OddsMarket = "ONE_X_TWO" | "OVER_UNDER_2_5" | "BTTS";
export type OddsSelection = "HOME" | "DRAW" | "AWAY" | "OVER_2_5" | "UNDER_2_5" | "YES" | "NO";

export interface OddsBookInput {
  readonly fixtureId: string;
  readonly oddsSnapshotId: string;
  readonly market: OddsMarket;
  readonly sourceLabel: string;
  readonly capturedAt: string;
  readonly selections: readonly Readonly<{ selection: OddsSelection; decimalOdds: string }>[];
}

export const MARKET_SELECTIONS: Readonly<Record<OddsMarket, readonly OddsSelection[]>> = { ONE_X_TWO: ["HOME", "DRAW", "AWAY"], OVER_UNDER_2_5: ["OVER_2_5", "UNDER_2_5"], BTTS: ["YES", "NO"] };
export const MAX_DECIMAL_ODDS_SCALE = 20;
export const MAX_DECIMAL_ODDS_INTEGER_DIGITS = 107;
export const MAX_DECIMAL_ODDS_LENGTH = 128;
export const ODDS_CAPTURE_WINDOW_DAYS = 30;
export const ODDS_CAPTURE_CLOCK_SKEW_MS = 5 * 60 * 1000;
export const CANONICAL_UTC_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const PLAIN_DECIMAL_ODDS_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

function exactKeys(value: object, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return actual.length === sorted.length && actual.every((key, index) => key === sorted[index]);
}

export function parseOddsBook(value: unknown): OddsBookInput {
  if (!value || typeof value !== "object" || Array.isArray(value) || !exactKeys(value, ["fixtureId", "oddsSnapshotId", "market", "sourceLabel", "capturedAt", "selections"])) throw new Error("INVALID_ODDS_BOOK_KEYS");
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.fixtureId !== "string" || !candidate.fixtureId || typeof candidate.oddsSnapshotId !== "string" || !candidate.oddsSnapshotId) throw new Error("INVALID_ODDS_BOOK_ID");
  if (typeof candidate.market !== "string" || !Object.hasOwn(MARKET_SELECTIONS, candidate.market)) throw new Error("UNSUPPORTED_ODDS_MARKET");
  if (typeof candidate.sourceLabel !== "string" || !candidate.sourceLabel.trim()) throw new Error("INVALID_ODDS_SOURCE_LABEL");
  if (typeof candidate.capturedAt !== "string" || !CANONICAL_UTC_INSTANT_PATTERN.test(candidate.capturedAt) || new Date(candidate.capturedAt).toISOString() !== candidate.capturedAt) throw new Error("INVALID_ODDS_CAPTURED_AT");
  if (!Array.isArray(candidate.selections)) throw new Error("INVALID_ODDS_SELECTIONS");
  const selections = candidate.selections.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item) || !exactKeys(item, ["selection", "decimalOdds"])) throw new Error("INVALID_ODDS_SELECTION_KEYS");
    const record = item as Record<string, unknown>;
    if (typeof record.selection !== "string" || typeof record.decimalOdds !== "string") throw new Error("INVALID_ODDS_SELECTION");
    return { selection: record.selection as OddsSelection, decimalOdds: canonicalizeDecimalOdds(record.decimalOdds) };
  });
  const expected = MARKET_SELECTIONS[candidate.market as OddsMarket];
  const actual = selections.map(({ selection }) => selection);
  if (new Set(actual).size !== actual.length) throw new Error("DUPLICATE_ODDS_SELECTION");
  if (actual.length !== expected.length || expected.some((selection) => !actual.includes(selection))) throw new Error("INCOMPLETE_ODDS_BOOK");
  return { fixtureId: candidate.fixtureId, oddsSnapshotId: candidate.oddsSnapshotId, market: candidate.market as OddsMarket, sourceLabel: candidate.sourceLabel, capturedAt: candidate.capturedAt, selections };
}

/** Validates bounded plain-decimal syntax before Decimal construction. */
export function canonicalizeDecimalOdds(value: string): string {
  if (value.length > MAX_DECIMAL_ODDS_LENGTH || !PLAIN_DECIMAL_ODDS_PATTERN.test(value)) throw new Error("INVALID_DECIMAL_ODDS");
  const [integer, fraction = ""] = value.split(".");
  if (integer!.length > MAX_DECIMAL_ODDS_INTEGER_DIGITS || fraction.length > MAX_DECIMAL_ODDS_SCALE) throw new Error("INVALID_DECIMAL_ODDS");
  const odds = new Decimal(value);
  if (!odds.isFinite() || odds.lte(1)) throw new Error("INVALID_DECIMAL_ODDS");
  return odds.toString();
}

/** D-09 capture policy: [kickoff - 30 days, kickoff) and no later than serverNow + 5 minutes. */
export function validateOddsCaptureChronology(capturedAt: string, kickoffUtc: string, serverNow: Date): void {
  const capturedMs = new Date(capturedAt).getTime();
  const kickoffMs = new Date(kickoffUtc).getTime();
  if (capturedMs < kickoffMs - ODDS_CAPTURE_WINDOW_DAYS * 24 * 60 * 60 * 1000) throw new Error("ODDS_CAPTURE_BEFORE_WINDOW");
  if (capturedMs >= kickoffMs) throw new Error("ODDS_CAPTURE_NOT_BEFORE_KICKOFF");
  if (capturedMs > serverNow.getTime() + ODDS_CAPTURE_CLOCK_SKEW_MS) throw new Error("ODDS_CAPTURE_AFTER_CLOCK_SKEW");
}
