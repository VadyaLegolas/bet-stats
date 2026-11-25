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

/** Parses a timestamp-shaped value; null for anything that is not an ISO-like valid instant. */
function parseIsoInstant(instant: string): Date | null {
  const value = instant.trim();
  if (!ISO_LIKE.test(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Kickoff for the scanner: «сб, 28 ноября, 18:00» in an explicit zone. The platform pattern inserts the word «в», so the
 * parts are joined by hand. Any unparsable input or invalid zone returns the exact input and never throws. */
export function formatKickoffWarsaw(iso: string, timeZone = "Europe/Warsaw"): string {
  const date = parseIsoInstant(iso);
  if (!date) return iso;
  try {
    const parts = new Intl.DateTimeFormat("ru-RU", { weekday: "short", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).formatToParts(date);
    const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
    const [weekday, day, month, hour, minute] = [pick("weekday"), pick("day"), pick("month"), pick("hour"), pick("minute")];
    if (weekday === undefined || day === undefined || month === undefined || hour === undefined || minute === undefined) return iso;
    return `${weekday}, ${day} ${month}, ${hour}:${minute}`;
  } catch {
    return iso;
  }
}

/** Odds capture time for the scanner: «25.11.2026, 14:05» in an explicit zone; the exact input on any failure. */
export function formatCapturedWarsaw(iso: string, timeZone = "Europe/Warsaw"): string {
  const date = parseIsoInstant(iso);
  if (!date) return iso;
  try {
    const parts = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).formatToParts(date);
    const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
    const [day, month, year, hour, minute] = [pick("day"), pick("month"), pick("year"), pick("hour"), pick("minute")];
    if (day === undefined || month === undefined || year === undefined || hour === undefined || minute === undefined) return iso;
    return `${day}.${month}.${year}, ${hour}:${minute}`;
  } catch {
    return iso;
  }
}

/** Presents an integer age from the API: «только что», «{N} мин назад», «{N} ч назад», «{N} сут назад» (floors). It never
 * re-derives freshness. A negative or non-finite value reads as «только что». */
export function formatAge(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 60) return "только что";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} мин назад`;
  if (seconds < 172_800) return `${Math.floor(seconds / 3600)} ч назад`;
  return `${Math.floor(seconds / 86_400)} сут назад`;
}
