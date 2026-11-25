import type { ForecastMarket, ForecastSelection } from "../forecast/model.js";
import { AH_LINES_V1, parseAhLineToken, type AhLineToken } from "./ah-lines.js";
import { EXACT_SCORE_BUCKETS_V1, type ExactScoreSelection } from "./exact-score.js";

/**
 * The single market registry (D-11). Every layer that needs "which markets exist and which selections
 * does a market have" asks this module, so the tables cannot drift apart. A market is identified by a
 * canonical id: one of the three core markets, `EXACT_SCORE`, or `ASIAN_HANDICAP:<line token>` with the token
 * taken from the 21-entry whitelist `ah-lines-v1`. Anything else is not a market.
 *
 * Pure: no I/O. It imports the forecast model only as a type, so it adds no runtime cycle.
 */

export const MARKET_FAMILIES = ["ONE_X_TWO", "OVER_UNDER_2_5", "BTTS", "ASIAN_HANDICAP", "EXACT_SCORE"] as const;
export type MarketFamily = (typeof MARKET_FAMILIES)[number];

const AH_PREFIX = "ASIAN_HANDICAP:" as const;
export type AhMarketId = `${typeof AH_PREFIX}${AhLineToken}`;
export type MarketId = ForecastMarket | "EXACT_SCORE" | AhMarketId;
export type SelectionId = ForecastSelection | ExactScoreSelection;

/** The only definition of the frozen table of the three core markets (content and key order must never change). */
export const CORE_MARKET_SELECTIONS: Readonly<Record<ForecastMarket, readonly ForecastSelection[]>> = Object.freeze({
  ONE_X_TWO: Object.freeze(["HOME", "DRAW", "AWAY"] as const),
  OVER_UNDER_2_5: Object.freeze(["OVER_2_5", "UNDER_2_5"] as const),
  BTTS: Object.freeze(["YES", "NO"] as const),
});

const AH_SELECTIONS: readonly SelectionId[] = Object.freeze(["HOME", "AWAY"] as const);

export interface ParsedMarketId {
  readonly family: MarketFamily;
  readonly line?: AhLineToken;
}

function isCoreId(id: string): id is ForecastMarket {
  return Object.hasOwn(CORE_MARKET_SELECTIONS, id);
}

/** Whitelist parse of a market id; `null` for anything that is not one of the 25 canonical ids. */
export function parseMarketId(id: unknown): ParsedMarketId | null {
  if (typeof id !== "string") return null;
  if (isCoreId(id)) return { family: id };
  if (id === "EXACT_SCORE") return { family: "EXACT_SCORE" };
  if (id.startsWith(AH_PREFIX)) {
    const line = parseAhLineToken(id.slice(AH_PREFIX.length));
    return line === null ? null : { family: "ASIAN_HANDICAP", line };
  }
  return null;
}

export function marketFamilyOf(id: unknown): MarketFamily | null {
  return parseMarketId(id)?.family ?? null;
}

/** True for the three markets of the frozen forecast (the only ones carrying stored probabilities). */
export function isCoreMarket(id: unknown): id is ForecastMarket {
  return typeof id === "string" && isCoreId(id);
}

/** Selections of a market in registry order, or `null` for an unknown market. */
export function selectionsFor(id: unknown): readonly SelectionId[] | null {
  const parsed = parseMarketId(id);
  if (parsed === null) return null;
  switch (parsed.family) {
    case "ASIAN_HANDICAP":
      return AH_SELECTIONS;
    case "EXACT_SCORE":
      return EXACT_SCORE_BUCKETS_V1.selections;
    default:
      return CORE_MARKET_SELECTIONS[parsed.family];
  }
}

/** All 25 market ids: three core, exact score, then 21 Asian handicap lines by ascending home line. */
export const ALL_MARKET_IDS: readonly MarketId[] = Object.freeze([
  ...(Object.keys(CORE_MARKET_SELECTIONS) as ForecastMarket[]),
  "EXACT_SCORE" as const,
  ...AH_LINES_V1.lines.map((line) => `${AH_PREFIX}${line}` as AhMarketId),
]);
