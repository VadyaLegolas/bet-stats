import { createHash } from "node:crypto";

import { canonicalizeDecimalOdds, CANONICAL_UTC_INSTANT_PATTERN, MARKET_SELECTIONS, type OddsMarket, type OddsSelection } from "../odds/contract.js";

export interface ClosingOddsBookInput {
  readonly fixtureId: string;
  readonly market: OddsMarket;
  readonly sourceConvention: string;
  readonly observedAt: string;
  readonly selections: readonly Readonly<{ selection: OddsSelection; decimalOdds: string }>[];
}

export interface ClosingOddsContext {
  readonly kickoffUtc: string;
  readonly nowUtc: string;
  readonly fixtureSettled: boolean;
}

export type ClosingOddsRejection =
  | "INCOMPLETE_MARKET_SET"
  | "DUPLICATE_SELECTION"
  | "UNSUPPORTED_MARKET"
  | "INVALID_OBSERVED_AT"
  | "OBSERVED_AT_NOT_PRE_KICKOFF"
  | "OBSERVED_AT_IN_FUTURE"
  | "RECORDED_AFTER_KICKOFF"
  | "FIXTURE_ALREADY_SETTLED"
  | "INVALID_ODDS"
  | "INVALID_SOURCE_CONVENTION";

export interface ClosingObservationKey {
  readonly fixtureId: string;
  readonly market: string;
  readonly selection: string;
  readonly sourceConvention: string;
  readonly observedAt: string;
}

export interface ClosingObservationRow extends ClosingObservationKey {
  readonly id: string;
  readonly market: OddsMarket;
  readonly selection: OddsSelection;
  readonly oddsFormat: "DECIMAL";
  readonly observationKind: "MARKET_CLOSE";
  readonly decimalOdds: string;
}

export type ClosingOddsValidation =
  | Readonly<{ ok: true; rows: readonly ClosingObservationRow[] }>
  | Readonly<{ ok: false; code: ClosingOddsRejection }>;

function canonicalInstant(value: unknown): value is string {
  return typeof value === "string" && CANONICAL_UTC_INSTANT_PATTERN.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;
}

function reject(code: ClosingOddsRejection): ClosingOddsValidation {
  return { ok: false, code };
}

/**
 * D-03: deterministic observation id over (fixtureId, market, selection, sourceConvention, observedAt).
 * The odds value is deliberately NOT part of the key, so a replay with different odds collides on id
 * (the service layer turns that into CLOSING_OBSERVATION_CONFLICT). JSON array encoding keeps field
 * boundaries unambiguous.
 */
export function closingObservationId(key: ClosingObservationKey): string {
  const material = JSON.stringify([key.fixtureId, key.market, key.selection, key.sourceConvention, key.observedAt]);
  return `closing_${createHash("sha256").update(material).digest("hex")}`;
}

/**
 * D-02 validation of ONE complete closing-odds set (one market, one source convention, one observedAt).
 * Pure: time arrives through `context`. Check order is part of the contract (pinned by tests):
 * market, source convention, observedAt format, observedAt pre-kickoff, observedAt not in the future,
 * write not after kickoff, fixture not settled, duplicate selection, complete set, odds validity.
 * `context.kickoffUtc` / `context.nowUtc` are trusted system values; a non-canonical one is a caller bug and throws.
 */
export function validateClosingOddsBook(input: ClosingOddsBookInput, context: ClosingOddsContext): ClosingOddsValidation {
  if (!canonicalInstant(context.kickoffUtc) || !canonicalInstant(context.nowUtc)) throw new Error("INVALID_CLOSING_ODDS_CONTEXT");
  if (typeof input.market !== "string" || !Object.hasOwn(MARKET_SELECTIONS, input.market)) return reject("UNSUPPORTED_MARKET");
  if (typeof input.sourceConvention !== "string" || !input.sourceConvention.trim()) return reject("INVALID_SOURCE_CONVENTION");
  if (!canonicalInstant(input.observedAt)) return reject("INVALID_OBSERVED_AT");

  const kickoffMs = Date.parse(context.kickoffUtc);
  const nowMs = Date.parse(context.nowUtc);
  const observedMs = Date.parse(input.observedAt);
  if (observedMs >= kickoffMs) return reject("OBSERVED_AT_NOT_PRE_KICKOFF");
  if (observedMs > nowMs) return reject("OBSERVED_AT_IN_FUTURE");
  if (nowMs >= kickoffMs) return reject("RECORDED_AFTER_KICKOFF");
  if (context.fixtureSettled) return reject("FIXTURE_ALREADY_SETTLED");

  if (!Array.isArray(input.selections)) return reject("INCOMPLETE_MARKET_SET");
  const names = input.selections.map((item) => (item && typeof item === "object" ? item.selection : undefined));
  if (new Set(names).size !== names.length) return reject("DUPLICATE_SELECTION");
  const expected = MARKET_SELECTIONS[input.market];
  if (names.length !== expected.length || expected.some((selection) => !names.includes(selection))) return reject("INCOMPLETE_MARKET_SET");

  const rows: ClosingObservationRow[] = [];
  for (const selection of expected) {
    const item = input.selections.find((candidate) => candidate.selection === selection)!;
    let decimalOdds: string;
    try {
      if (typeof item.decimalOdds !== "string") throw new Error("INVALID_DECIMAL_ODDS");
      decimalOdds = canonicalizeDecimalOdds(item.decimalOdds);
    } catch {
      return reject("INVALID_ODDS");
    }
    rows.push({
      id: closingObservationId({ fixtureId: input.fixtureId, market: input.market, selection, sourceConvention: input.sourceConvention, observedAt: input.observedAt }),
      fixtureId: input.fixtureId,
      market: input.market,
      selection,
      sourceConvention: input.sourceConvention,
      observedAt: input.observedAt,
      oddsFormat: "DECIMAL",
      observationKind: "MARKET_CLOSE",
      decimalOdds,
    });
  }
  return { ok: true, rows };
}
