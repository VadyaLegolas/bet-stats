type Search = Record<string, string | string[] | undefined>;

export const COHORT_IDENTITY_KEYS = ["modelVersion", "competitionId", "market"] as const;

export type CohortIdentityKey = (typeof COHORT_IDENTITY_KEYS)[number];

const first = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value) || undefined;

/** The evaluation API takes the cohort identity as all three dimensions or none: a partial set
 * answers 400 INCOMPLETE_COHORT_IDENTITY, while a fully absent identity lets the API 308-
 * canonicalize a bare /scorecards onto the largest available cohort. So the distinction here
 * is "mentioned vs. absent", not "filled vs. empty": a dimension the user cleared is an
 * explicit "don't restrict it" and becomes the API's `all` sentinel, while a URL that never
 * carried the identity keeps the canonicalization path (quick 261016-k3w). */
export function resolveCohortIdentity(search: Search): ReadonlyArray<readonly [CohortIdentityKey, string]> {
  const entries = COHORT_IDENTITY_KEYS.map((key) => [key, search[key]] as const);
  if (!entries.some(([, raw]) => raw !== undefined)) return [];
  return entries.map(([key, raw]) => [key, first(raw) ?? "all"] as const);
}
