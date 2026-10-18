/**
 * Display formatting for decimal odds: two decimal places («2.71», «3.40», «10.00»),
 * the precision a bookmaker board shows. Exact values stay untouched in immutable
 * snapshots and receipts — this helper only shapes rendered copy.
 * Unparseable input is returned unchanged so a foreign value is never silently altered.
 */
export function formatOdds(value: string): string {
  if (value.trim() === "") return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toFixed(2) : value;
}
