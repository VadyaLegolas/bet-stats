import type { ForecastMarket, ForecastSelection } from "../forecast/model.js";

export interface ValueCommand {
  readonly fixtureId: string;
  readonly forecastSnapshotId: string;
  readonly oddsSnapshotId: string;
  readonly market: ForecastMarket;
  readonly selection: ForecastSelection;
}

const SELECTIONS: Readonly<Record<ForecastMarket, readonly ForecastSelection[]>> = { ONE_X_TWO: ["HOME", "DRAW", "AWAY"], OVER_UNDER_2_5: ["OVER_2_5", "UNDER_2_5"], BTTS: ["YES", "NO"] };

export function parseValueCommand(value: unknown): ValueCommand {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_VALUE_COMMAND");
  const candidate = value as Record<string, unknown>;
  const actual = Object.keys(candidate).sort();
  const expected = ["fixtureId", "forecastSnapshotId", "oddsSnapshotId", "market", "selection"].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new Error("INVALID_VALUE_COMMAND_KEYS");
  if (typeof candidate.fixtureId !== "string" || !candidate.fixtureId || typeof candidate.forecastSnapshotId !== "string" || !candidate.forecastSnapshotId || typeof candidate.oddsSnapshotId !== "string" || !candidate.oddsSnapshotId) throw new Error("INVALID_VALUE_COMMAND_ID");
  if (typeof candidate.market !== "string" || !Object.hasOwn(SELECTIONS, candidate.market)) throw new Error("UNSUPPORTED_VALUE_MARKET");
  if (typeof candidate.selection !== "string" || !SELECTIONS[candidate.market as ForecastMarket].includes(candidate.selection as ForecastSelection)) throw new Error("MARKET_SELECTION_MISMATCH");
  return value as ValueCommand;
}
