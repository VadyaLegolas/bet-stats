/**
 * Pure contract of the 7-day value scanner (Phase 15): policy constants, the freshness classifier and the DTO types of
 * `GET /value/scanner`. No runtime imports: the page may reference the types, never this module's values on the client.
 *
 * Stored numbers (edge, expected value, probabilities, odds) travel as the strings the database holds. Nothing in this
 * contract parses, rounds or reorders by them.
 */

// Pure annotations on the frozen constants: client files import the barrel, and an unannotated call stays in their chunk.
/** Versioned freshness policy (D-06): the age is measured from the odds snapshot's own `submittedAt`. */
export const SCANNER_FRESHNESS_V1 = /*#__PURE__*/ Object.freeze({ version: "scanner-freshness-v1", freshMaxHours: 6, agingMaxHours: 24 } as const);

/** Kickoff window length in days: `[now, now + 7 days)`. */
export const SCANNER_WINDOW_DAYS = 7;

/** Cap on listed candidates; truncation always happens on a fixture boundary. */
export const SCANNER_LIMIT = 200;

/** Market family order of D-09; deliberately not the order of the market registry. */
export const SCANNER_MARKET_ORDER = /*#__PURE__*/ Object.freeze(["ONE_X_TWO", "OVER_UNDER_2_5", "BTTS", "ASIAN_HANDICAP", "EXACT_SCORE"] as const);

/** Selection order within a market (D-09); unknown selections sort after these, then alphabetically. */
export const SCANNER_SELECTION_ORDER = /*#__PURE__*/ Object.freeze(["HOME", "DRAW", "AWAY", "OVER_2_5", "UNDER_2_5", "YES", "NO"] as const);

export type OddsFreshness = "FRESH" | "AGING" | "STALE";

export interface ScannerItem {
  readonly receiptId: string;
  readonly fixtureId: string;
  readonly forecastSnapshotId: string;
  readonly oddsSnapshotId: string;
  readonly market: string;
  readonly selection: string;
  /** ISO instant, UTC. */
  readonly kickoffAt: string;
  readonly homeTeam: string;
  readonly awayTeam: string;
  /** League name: there is no separate competition table. */
  readonly competition: string;
  readonly oddsSource: string | null;
  /** ISO instant, UTC: when the odds snapshot was stored. The freshness age is measured from here. */
  readonly oddsSubmittedAt: string;
  /** Informational only: the observation time the user typed with the book. It never feeds the age. */
  readonly oddsCapturedAt: string | null;
  readonly oddsAgeSeconds: number;
  readonly freshness: OddsFreshness;
  readonly forecastNewerAvailable: boolean;
  /** Stored strings, copied without any numeric conversion. */
  readonly edge: string | null;
  readonly expectedValue: string | null;
  readonly modelProbability: string | null;
  readonly noVigProbability: string | null;
  readonly fairOdds: string | null;
  readonly decimalOdds: string | null;
  readonly valuePolicyVersion: string | null;
  /** Asian handicap receipts only. */
  readonly edgeDefinition: string | null;
  /** Asian handicap receipts only; the exact-score extended block carries no such field. */
  readonly evPolicyVersion: string | null;
}

export interface ScannerResponse {
  /** UNAVAILABLE is decided by the page, never by the API. */
  readonly state: "AVAILABLE" | "EMPTY";
  /** One instant for every age in the payload. */
  readonly generatedAt: string;
  readonly window: { readonly from: string; readonly to: string };
  readonly limit: number;
  readonly truncated: boolean;
  readonly freshnessPolicy: typeof SCANNER_FRESHNESS_V1;
  readonly checkedCount: number;
  readonly outcomeCounts: Readonly<Record<string, number>>;
  /** Candidates before truncation. */
  readonly totalCandidates: number;
  readonly allPolicyConfigMismatch: boolean;
  /** Already in display order (D-09); consumers must not sort. */
  readonly items: readonly ScannerItem[];
}

/** FRESH below 6 h, AGING from 6 h through 24 h inclusive, STALE above 24 h. A negative age (clock skew) counts as 0. */
export function classifyOddsFreshness(ageSeconds: number): OddsFreshness {
  const age = Math.max(0, Math.floor(ageSeconds));
  if (age < SCANNER_FRESHNESS_V1.freshMaxHours * 3600) return "FRESH";
  if (age <= SCANNER_FRESHNESS_V1.agingMaxHours * 3600) return "AGING";
  return "STALE";
}
