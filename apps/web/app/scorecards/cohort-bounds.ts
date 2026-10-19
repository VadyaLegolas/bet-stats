type Search = Record<string, string | string[] | undefined>;

const DAY_MS = 24 * 60 * 60 * 1000;
const DERIVED_SPAN_MS = 365 * DAY_MS;
const DAY_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const present = (value: string | string[] | undefined): string | undefined => {
  const scalar = Array.isArray(value) ? value[0] : value;
  return scalar ? scalar : undefined;
};

/** The cohort filter's calendar pickers submit whole UTC days, but the API demands exact
 * instants and rejects a bare day with INVALID_FROM/INVALID_TO. `from` opens the picked day
 * (inclusive) and `to` closes it with the next day's start, so the API's `lt` bound keeps the
 * whole end day inside the cohort — the same reading /fixtures applies to day-shaped params. */
const toApiInstant = (key: "from" | "to", value: string): string => {
  if (!DAY_ONLY.test(value)) return value;
  if (key === "from") return `${value}T00:00:00.000Z`;
  return new Date(new Date(`${value}T00:00:00.000Z`).getTime() + DAY_MS).toISOString();
};

const nowDefaults = (): { from: string; to: string } => ({
  from: new Date(Date.now() - 364 * DAY_MS).toISOString(),
  to: new Date(Date.now() + DAY_MS).toISOString(),
});

export function resolveCohortBounds(search: Search): { from: string; to: string } {
  const rawFrom = present(search.from);
  const rawTo = present(search.to);
  if (rawFrom && rawTo) return { from: toApiInstant("from", rawFrom), to: toApiInstant("to", rawTo) };
  const fallback = nowDefaults();
  if (rawFrom) {
    const parsed = Date.parse(rawFrom);
    return { from: toApiInstant("from", rawFrom), to: Number.isNaN(parsed) ? fallback.to : new Date(parsed + DERIVED_SPAN_MS).toISOString() };
  }
  if (rawTo) {
    const parsed = Date.parse(rawTo);
    return { from: Number.isNaN(parsed) ? fallback.from : new Date(parsed - DERIVED_SPAN_MS).toISOString(), to: toApiInstant("to", rawTo) };
  }
  return fallback;
}
