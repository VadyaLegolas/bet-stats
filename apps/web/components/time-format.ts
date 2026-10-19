/** Only timestamp-shaped values are ever formatted: full ISO instants and plain
 * calendar dates (2026-09-20). Ids like «2026» or «PL» pass through untouched —
 * display formatting must never mangle data. */
const ISO_LIKE = /^\d{4}-\d{2}-\d{2}([Tt ].*)?$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Human-readable instant in an explicit IANA zone (DISPLAY_TIME_ZONE on the
 * server; client callers receive the zone explicitly). The machine value stays
 * verifiable in the `<time dateTime>` attribute — only the rendered text is
 * localized. A calendar date renders as a date without inventing a time or
 * shifting the day; an unparsable value or an invalid zone falls back to the
 * exact input instead of throwing. */
export function formatInstant(instant: string, timeZone: string): string {
  const value = instant.trim();
  if (!ISO_LIKE.test(value)) return instant;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return instant;
  try {
    if (DATE_ONLY.test(value)) return new Intl.DateTimeFormat("ru-RU", { dateStyle: "long", timeZone: "UTC" }).format(date);
    return new Intl.DateTimeFormat("ru-RU", { dateStyle: "long", timeStyle: "short", timeZone }).format(date);
  } catch {
    return instant;
  }
}
