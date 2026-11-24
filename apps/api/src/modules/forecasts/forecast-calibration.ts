import type { CalibrationState } from "@bet-stats/database";
import {
  CALIBRATION_CONFIG,
  resolveForecastCalibration,
  unavailableMarketCalibration,
  type CalibratedForecastResponseDto,
  type CalibratorIdentity,
  type ForecastMarket,
  type ForecastResponseDto,
  type MarketCalibrationView,
} from "@bet-stats/domain";

/**
 * Read-time calibration of forecast responses (Phase 12, D-06, D-08, D-11, CALIB-01, CALIB-02, CALIB-04).
 *
 * A forecast keeps every stored field untouched; the response gains one extra key, `marketCalibration`, with per market the
 * raw probabilities and a closed calibration block. The calibrator comes from the forecast's OWN pinned identity
 * (modelVersion, configHash) and is applied by the domain resolver with that same identity, so a calibrator of another
 * model can never be shown as active. A failed read degrades to UNAVAILABLE and never fails the forecast.
 */

/**
 * Read cache of the calibration state (WR-06). The state of one identity needs a full census of its settled outcomes unless every
 * market has a calibrator, and the list/detail endpoints are public. Entries live `ttlMs` milliseconds: a promotion, a rollback or
 * a newly settled outcome becomes visible after at most the TTL and never later. Failed reads are not cached, concurrent reads of one
 * identity share a single in-flight read, and the number of entries is bounded.
 */
export const DEFAULT_CALIBRATION_STATE_CACHE_TTL_MS = 60_000;
export const MAX_CALIBRATION_STATE_CACHE_TTL_MS = 300_000;
const CALIBRATION_STATE_CACHE_MAX_ENTRIES = 32;

/** `CALIBRATION_STATE_CACHE_TTL_MS`: milliseconds, 0 disables the cache; invalid values fall back to the default; capped at 300000. */
export function resolveCalibrationStateCacheTtlMs(env: Readonly<Record<string, string | undefined>>): number {
  const raw = env.CALIBRATION_STATE_CACHE_TTL_MS?.trim();
  if (raw === undefined || raw === "" || !/^[0-9]+$/.test(raw)) return DEFAULT_CALIBRATION_STATE_CACHE_TTL_MS;
  return Math.min(Number(raw), MAX_CALIBRATION_STATE_CACHE_TTL_MS);
}

export function withCalibrationStateCache(
  readState: CalibrationEnrichmentDeps["readState"],
  options: { ttlMs: number; now?: () => number; maxEntries?: number },
): CalibrationEnrichmentDeps["readState"] {
  const now = options.now ?? (() => Date.now());
  const maxEntries = options.maxEntries ?? CALIBRATION_STATE_CACHE_MAX_ENTRIES;
  if (!(options.ttlMs > 0)) return readState;
  const entries = new Map<string, { expiresAt: number; read: Promise<CalibrationState> }>();
  return (identity, asOf) => {
    const key = identityKey(identity);
    const current = now();
    const hit = entries.get(key);
    if (hit && hit.expiresAt > current) return hit.read;
    entries.delete(key);
    for (const [other, entry] of entries) if (entry.expiresAt <= current) entries.delete(other);
    while (entries.size >= maxEntries) entries.delete(entries.keys().next().value as string);
    const read = Promise.resolve().then(() => readState(identity, asOf));
    const entry = { expiresAt: current + options.ttlMs, read };
    entries.set(key, entry);
    read.catch(() => { if (entries.get(key) === entry) entries.delete(key); });
    return read;
  };
}

/** A calibration read or resolve that failed softly (WR-07). Carries a code and the error class, never the message. */
export interface CalibrationReadFailure {
  readonly identity: CalibratorIdentity;
  readonly stage: "READ" | "RESOLVE";
  readonly code: string;
}

function safeToken(value: unknown): string | null {
  return typeof value === "string" && /^[A-Za-z0-9_.-]{1,80}$/.test(value) ? value : null;
}

/**
 * Failure description for the operator: the error's own `code` (Prisma P-codes, repository and domain codes) or else its class
 * name. The message is dropped on purpose: driver messages can carry the query, its parameters or connection details.
 */
export function describeCalibrationError(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    return safeToken((error as { code?: unknown }).code) ?? safeToken((error as { name?: unknown }).name) ?? "UNKNOWN";
  }
  return "UNKNOWN";
}

/** Structured, secret-free log record of a soft failure. */
export function calibrationFailureLogRecord(failure: CalibrationReadFailure): Readonly<Record<string, string>> {
  return {
    event: "calibration.read_failed",
    stage: failure.stage,
    modelVersion: failure.identity.modelVersion,
    configHash: failure.identity.configHash,
    code: failure.code,
  };
}

export interface CalibrationEnrichmentDeps {
  /** Called once per failed identity and request with a failure that is safe to log. Its own errors are swallowed. */
  onError?(failure: CalibrationReadFailure): void;
  /** State of the exact forecast identity at `asOf` (ISO-8601 UTC): active calibrator and eligible outcomes per market. */
  readState(identity: CalibratorIdentity, asOf: string): Promise<CalibrationState>;
  now(): Date;
}

function identityKey(forecast: Pick<ForecastResponseDto, "modelVersion" | "configHash">): string {
  return `${forecast.modelVersion}\u001f${forecast.configHash}`;
}

function unavailableAll(forecast: ForecastResponseDto): Readonly<Record<ForecastMarket, MarketCalibrationView>> {
  const view = (market: ForecastMarket) => unavailableMarketCalibration({ forecast, market, reasonCode: "CALIBRATION_READ_FAILED" });
  return { ONE_X_TWO: view("ONE_X_TWO"), OVER_UNDER_2_5: view("OVER_UNDER_2_5"), BTTS: view("BTTS") };
}

/**
 * Enriches forecasts for one response. The state is read once per distinct identity and request, all identities in parallel;
 * any cache between requests belongs to `deps.readState` (see `withCalibrationStateCache`). Every forecast is resolved against
 * the state of its own identity. Inputs are never mutated.
 */
export async function attachMarketCalibration<T extends ForecastResponseDto>(
  forecasts: readonly T[],
  deps: CalibrationEnrichmentDeps,
): Promise<Array<T & Pick<CalibratedForecastResponseDto, "marketCalibration">>> {
  if (forecasts.length === 0) return [];
  const asOf = deps.now().toISOString();
  const reads = new Map<string, Promise<CalibrationState | null>>();
  const report = (failure: CalibrationReadFailure): void => {
    try {
      deps.onError?.(failure);
    } catch {
      // Observability must never turn a soft failure into a request failure.
    }
  };
  const stateOf = (forecast: T): Promise<CalibrationState | null> => {
    const key = identityKey(forecast);
    let read = reads.get(key);
    if (!read) {
      // A failed read becomes null for every forecast of this identity; the cause is not exposed to the client.
      read = Promise.resolve()
        .then(() => deps.readState({ modelVersion: forecast.modelVersion, configHash: forecast.configHash }, asOf))
        .catch((error: unknown) => {
          report({ identity: { modelVersion: forecast.modelVersion, configHash: forecast.configHash }, stage: "READ", code: describeCalibrationError(error) });
          return null;
        });
      reads.set(key, read);
    }
    return read;
  };

  // Start every distinct identity's read before awaiting any: the reads run in parallel (WR-06).
  for (const forecast of forecasts) void stateOf(forecast);

  const enriched: Array<T & Pick<CalibratedForecastResponseDto, "marketCalibration">> = [];
  for (const forecast of forecasts) {
    const state = await stateOf(forecast);
    let marketCalibration: Readonly<Record<ForecastMarket, MarketCalibrationView>>;
    if (state === null) {
      marketCalibration = unavailableAll(forecast);
    } else {
      try {
        marketCalibration = resolveForecastCalibration({
          // The forecast itself carries the identity the calibrator is checked against.
          forecast,
          active: { ONE_X_TWO: state.ONE_X_TWO.active, OVER_UNDER_2_5: state.OVER_UNDER_2_5.active, BTTS: state.BTTS.active },
          // Null (not computed) only for a market with an active calibrator, where the count is never read.
          eligibleSampleSize: { ONE_X_TWO: state.ONE_X_TWO.eligibleSampleSize ?? 0, OVER_UNDER_2_5: state.OVER_UNDER_2_5.eligibleSampleSize ?? 0, BTTS: state.BTTS.eligibleSampleSize ?? 0 },
          config: CALIBRATION_CONFIG,
        });
      } catch (error) {
        report({ identity: { modelVersion: forecast.modelVersion, configHash: forecast.configHash }, stage: "RESOLVE", code: describeCalibrationError(error) });
        marketCalibration = unavailableAll(forecast);
      }
    }
    enriched.push({ ...forecast, marketCalibration });
  }
  return enriched;
}
