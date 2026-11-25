import { normaliseExtendedMarkets, type ExtendedMarketsSlot } from "./extended-markets-model";

export type { ExtendedMarketsSlot };

/**
 * Серверная загрузка расширенных рынков (UI-SPEC, «Data delivery»): страница матча читает вид для каждого
 * снимка из списка прогнозов параллельно, поэтому разделы видны в первом HTML без состояния загрузки и без
 * сдвига раскладки. Модуль без директивы клиента; верстак страницы матча не импортирует.
 *
 * Классификация закрытая (T-14-12):
 * - сеть или не-2xx ответ → { state: "READ_FAILED" } (сбой чтения, отличается от устаревшего снимка);
 * - тело, не прошедшее parseExtendedMarketsView (неизвестная причина, искажённая форма, не JSON) →
 *   { state: "UNAVAILABLE", reason: "UNRECOGNISED" }, то есть общее уведомление без раскладки AVAILABLE.
 */

export interface LoadExtendedMarketsInput {
  readonly apiOrigin: string;
  readonly fixtureId: string;
  readonly forecastIds: readonly string[];
  /** Те же заголовки допуска, что и у загрузки списка прогнозов (свежий штамп решения). */
  readonly headers: Readonly<Record<string, string>>;
  readonly fetchImpl?: typeof fetch;
}

async function loadOne(input: LoadExtendedMarketsInput, forecastId: string): Promise<ExtendedMarketsSlot> {
  const fetcher = input.fetchImpl ?? fetch;
  const url = `${input.apiOrigin}/fixtures/${encodeURIComponent(input.fixtureId)}/forecasts/${encodeURIComponent(forecastId)}/extended-markets`;
  let response: Response;
  try {
    response = await fetcher(url, { headers: { accept: "application/json", ...input.headers }, cache: "no-store" });
  } catch {
    return { state: "READ_FAILED" };
  }
  if (!response.ok) return { state: "READ_FAILED" };
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return normaliseExtendedMarkets(undefined);
  }
  return normaliseExtendedMarkets(body);
}

/** Слот для каждого снимка по его id; один сбой не затрагивает остальные снимки. */
export async function loadExtendedMarkets(input: LoadExtendedMarketsInput): Promise<Record<string, ExtendedMarketsSlot>> {
  const entries = await Promise.all(input.forecastIds.map(async (forecastId) => [forecastId, await loadOne(input, forecastId)] as const));
  return Object.fromEntries(entries);
}
