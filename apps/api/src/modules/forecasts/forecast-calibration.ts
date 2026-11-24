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

export interface CalibrationEnrichmentDeps {
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
 * Enriches forecasts for one response. The state is read once per distinct identity and request (no cache between
 * requests); every forecast is resolved against the state of its own identity. Inputs are never mutated.
 */
export async function attachMarketCalibration<T extends ForecastResponseDto>(
  forecasts: readonly T[],
  deps: CalibrationEnrichmentDeps,
): Promise<Array<T & Pick<CalibratedForecastResponseDto, "marketCalibration">>> {
  if (forecasts.length === 0) return [];
  const asOf = deps.now().toISOString();
  const reads = new Map<string, Promise<CalibrationState | null>>();
  const stateOf = (forecast: T): Promise<CalibrationState | null> => {
    const key = identityKey(forecast);
    let read = reads.get(key);
    if (!read) {
      // A failed read becomes null for every forecast of this identity; the cause is not exposed to the client.
      read = Promise.resolve()
        .then(() => deps.readState({ modelVersion: forecast.modelVersion, configHash: forecast.configHash }, asOf))
        .catch(() => null);
      reads.set(key, read);
    }
    return read;
  };

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
          eligibleSampleSize: { ONE_X_TWO: state.ONE_X_TWO.eligibleSampleSize, OVER_UNDER_2_5: state.OVER_UNDER_2_5.eligibleSampleSize, BTTS: state.BTTS.eligibleSampleSize },
          config: CALIBRATION_CONFIG,
        });
      } catch {
        marketCalibration = unavailableAll(forecast);
      }
    }
    enriched.push({ ...forecast, marketCalibration });
  }
  return enriched;
}
