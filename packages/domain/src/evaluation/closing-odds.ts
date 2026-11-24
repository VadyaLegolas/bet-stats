import { createHash } from "node:crypto";

import {
  canonicalizeDecimalOdds,
  CANONICAL_UTC_INSTANT_PATTERN,
  MARKET_SELECTIONS,
  type OddsMarket,
  type OddsSelection,
} from "../odds/contract.js";

export type ClosingOddsRejection =
  | "UNSUPPORTED_MARKET"
  | "INVALID_SOURCE_CONVENTION"
  | "INVALID_OBSERVED_AT"
  | "DUPLICATE_SELECTION"
  | "INCOMPLETE_MARKET_SET"
  | "INVALID_ODDS"
  | "FIXTURE_ALREADY_SETTLED"
  | "RECORDED_AFTER_KICKOFF"
  | "OBSERVED_AT_NOT_PRE_KICKOFF"
  | "OBSERVED_AT_IN_FUTURE";

export interface ClosingOddsBookInput {
  readonly fixtureId: string;
  readonly market: string;
  readonly sourceConvention: string;
  readonly observedAt: string;
  readonly selections: readonly Readonly<{ selection: string; decimalOdds: string }>[];
}

export interface ClosingOddsContext {
  readonly kickoffUtc: string;
  readonly nowUtc: string;
  readonly fixtureSettled: boolean;
}

export interface ClosingOddsRow {
  readonly id: string;
  readonly fixtureId: string;
  readonly market: OddsMarket;
  readonly selection: OddsSelection;
  readonly decimalOdds: string;
  readonly oddsFormat: "DECIMAL";
  readonly sourceConvention: string;
  readonly observationKind: "MARKET_CLOSE";
  readonly observedAt: string;
}

export type ClosingOddsValidation =
  | Readonly<{ ok: true; rows: readonly ClosingOddsRow[] }>
  | Readonly<{ ok: false; code: ClosingOddsRejection }>;

function canonicalInstant(value: unknown): value is string {
  return typeof value === "string" && CANONICAL_UTC_INSTANT_PATTERN.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;
}

/** Deterministic id: the odds value is NOT part of it, so a replay with other odds collides and is reported as a conflict. */
export function closingObservationId(key: Readonly<{ fixtureId: string; market: string; selection: string; sourceConvention: string; observedAt: string }>): string {
  const material = JSON.stringify([key.fixtureId, key.market, key.selection, key.sourceConvention, key.observedAt]);
  return `closing:${createHash("sha256").update(material).digest("hex")}`;
}

/**
 * Validates one complete selection set of one market (D-01, D-02). Pure: time arrives through the context.
 * Check order is part of the contract (tested): structure first, then settlement, then chronology.
 */
export function validateClosingOddsBook(input: ClosingOddsBookInput, context: ClosingOddsContext): ClosingOddsValidation {
  const fail = (code: ClosingOddsRejection): ClosingOddsValidation => ({ ok: false, code });
  if (typeof input.market !== "string" || !Object.hasOwn(MARKET_SELECTIONS, input.market)) return fail("UNSUPPORTED_MARKET");
  const market = input.market as OddsMarket;
  if (typeof input.sourceConvention !== "string" || !input.sourceConvention.trim() || input.sourceConvention !== input.sourceConvention.trim()) return fail("INVALID_SOURCE_CONVENTION");
  if (!canonicalInstant(input.observedAt)) return fail("INVALID_OBSERVED_AT");
  if (!Array.isArray(input.selections)) return fail("INCOMPLETE_MARKET_SET");
  const expected = MARKET_SELECTIONS[market];
  const names = input.selections.map((item) => item?.selection);
  if (new Set(names).size !== names.length) return fail("DUPLICATE_SELECTION");
  if (names.length !== expected.length || expected.some((selection) => !names.includes(selection))) return fail("INCOMPLETE_MARKET_SET");
  const canonical = new Map<string, string>();
  for (const item of input.selections) {
    try { canonical.set(item.selection, canonicalizeDecimalOdds(item.decimalOdds)); } catch { return fail("INVALID_ODDS"); }
  }
  if (context.fixtureSettled) return fail("FIXTURE_ALREADY_SETTLED");
  const kickoff = Date.parse(context.kickoffUtc);
  const now = Date.parse(context.nowUtc);
  const observed = Date.parse(input.observedAt);
  if (now >= kickoff) return fail("RECORDED_AFTER_KICKOFF");
  if (observed >= kickoff) return fail("OBSERVED_AT_NOT_PRE_KICKOFF");
  if (observed > now) return fail("OBSERVED_AT_IN_FUTURE");
  return {
    ok: true,
    rows: expected.map((selection) => ({
      id: closingObservationId({ fixtureId: input.fixtureId, market, selection, sourceConvention: input.sourceConvention, observedAt: input.observedAt }),
      fixtureId: input.fixtureId,
      market,
      selection,
      decimalOdds: canonical.get(selection)!,
      oddsFormat: "DECIMAL" as const,
      sourceConvention: input.sourceConvention,
      observationKind: "MARKET_CLOSE" as const,
      observedAt: input.observedAt,
    })),
  };
}
