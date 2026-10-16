type Search = Record<string, string | string[] | undefined>;

const DAY_MS = 24 * 60 * 60 * 1000;
const DERIVED_SPAN_MS = 365 * DAY_MS;

const present = (value: string | string[] | undefined): string | undefined => {
  const scalar = Array.isArray(value) ? value[0] : value;
  return scalar ? scalar : undefined;
};

const nowDefaults = (): { from: string; to: string } => ({
  from: new Date(Date.now() - 364 * DAY_MS).toISOString(),
  to: new Date(Date.now() + DAY_MS).toISOString(),
});

export function resolveCohortBounds(search: Search): { from: string; to: string } {
  const from = present(search.from);
  const to = present(search.to);
  if (from && to) return { from, to };
  const fallback = nowDefaults();
  if (from) {
    const parsed = Date.parse(from);
    return { from, to: Number.isNaN(parsed) ? fallback.to : new Date(parsed + DERIVED_SPAN_MS).toISOString() };
  }
  if (to) {
    const parsed = Date.parse(to);
    return { from: Number.isNaN(parsed) ? fallback.from : new Date(parsed - DERIVED_SPAN_MS).toISOString(), to };
  }
  return fallback;
}
