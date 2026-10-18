/** Human-readable instant in an explicit IANA zone (DISPLAY_TIME_ZONE on the
 * server; client callers receive the zone as a prop). The machine value stays
 * verifiable in the `<time dateTime>` attribute — only the rendered text is
 * localized. An unparsable instant is shown exactly, never silently dropped. */
export function formatInstant(instant: string, timeZone: string): string {
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) return instant;
  return new Intl.DateTimeFormat("ru-RU", { dateStyle: "long", timeStyle: "short", timeZone }).format(date);
}
