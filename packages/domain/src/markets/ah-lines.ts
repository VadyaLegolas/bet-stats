/**
 * The versioned Asian handicap line list `ah-lines-v1` and its whitelist token grammar (D-05, D-11).
 *
 * Deliberately dependency-free: the market registry (and through it the odds contract) imports this module,
 * and importing the forecast configuration there would install its global decimal precision as a side effect
 * for every consumer of the odds modules. `asian-handicap.ts` re-exports everything defined here.
 */

export const AH_LINES_VERSION = "ah-lines-v1" as const;

/** The 21 canonical home-perspective tokens of `ah-lines-v1`, ascending; the closed type behind every market id. */
export type AhLineToken =
  | "-2.5" | "-2.25" | "-2" | "-1.75" | "-1.5" | "-1.25" | "-1" | "-0.75" | "-0.5" | "-0.25"
  | "0"
  | "+0.25" | "+0.5" | "+0.75" | "+1" | "+1.25" | "+1.5" | "+1.75" | "+2" | "+2.25" | "+2.5";

/** Home-perspective lines in quarter steps; quarter units keep every value exactly representable. */
const QUARTER_UNITS = Array.from({ length: 21 }, (_, index) => index - 10);

/** Canonical token of a value expressed in quarter units; the caller guarantees it lies on the list. */
export function tokenOf(quarters: number): AhLineToken {
  if (quarters === 0) return "0";
  const value = String(quarters / 4);
  return (quarters > 0 ? `+${value}` : value) as AhLineToken;
}

/** The versioned config `ah-lines-v1`: 21 home lines from -2.5 to +2.5, canonical tokens, mirrored for the away side. */
export const AH_LINES_V1 = Object.freeze({
  version: AH_LINES_VERSION,
  step: 0.25,
  lines: Object.freeze(QUARTER_UNITS.map(tokenOf)) as readonly AhLineToken[],
});

/** Home-perspective quarter units of every whitelisted token (used by the settlement function). */
export const AH_QUARTERS_BY_TOKEN: ReadonlyMap<string, number> = new Map(QUARTER_UNITS.map((quarters) => [tokenOf(quarters), quarters]));

/** Whitelist membership, never a numeric parse: `+1.00`, `0.0`, `-0`, `1e0` are all rejected. */
export function parseAhLineToken(token: unknown): AhLineToken | null {
  return typeof token === "string" && AH_QUARTERS_BY_TOKEN.has(token) ? (token as AhLineToken) : null;
}
