/** Russian plural agreement for counters: 1 запрос, 2 запроса, 5 запросов, 11 запросов. */
export function pluralRu(count: number, forms: readonly [one: string, few: string, many: string]): string {
  const mod10 = Math.abs(count) % 10;
  const mod100 = Math.abs(count) % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}

/** "88 запросов" with correct Russian agreement. */
export function formatRequests(count: number): string {
  return `${count} ${pluralRu(count, ["запрос", "запроса", "запросов"])}`;
}

/** At or below this remaining share the quota meter turns from accent to warm. */
export const QUOTA_LOW_REMAINING_RATIO = 0.2;

/** Remaining share of the daily allowance as a whole percent, clamped to 0-100 (0 without an allowance). */
export function quotaRemainingPercent(remaining: number, allowance: number): number {
  if (allowance <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((remaining / allowance) * 100)));
}

/** True when 20% or less of the allowance is left (boundary inclusive); an empty allowance counts as low. */
export function isQuotaLow(remaining: number, allowance: number): boolean {
  if (allowance <= 0) return true;
  return remaining / allowance <= QUOTA_LOW_REMAINING_RATIO;
}

/** Live reset countdown: seconds below a minute, minutes below an hour, then hours+minutes. */
export function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds} с`;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) return minutes === 0 ? `${hours} ч` : `${hours} ч ${minutes} мин`;
  return `${minutes} мин`;
}
