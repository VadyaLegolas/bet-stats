import { selectionsFor } from "../markets/registry.js";
import type { OddsMarket, OddsSelection } from "../odds/contract.js";

export interface ValueCommand {
  readonly fixtureId: string;
  readonly forecastSnapshotId: string;
  readonly oddsSnapshotId: string;
  readonly market: OddsMarket;
  readonly selection: OddsSelection;
}

export function parseValueCommand(value: unknown): ValueCommand {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_VALUE_COMMAND");
  const candidate = value as Record<string, unknown>;
  const actual = Object.keys(candidate).sort();
  const expected = ["fixtureId", "forecastSnapshotId", "oddsSnapshotId", "market", "selection"].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new Error("INVALID_VALUE_COMMAND_KEYS");
  if (typeof candidate.fixtureId !== "string" || !candidate.fixtureId || typeof candidate.forecastSnapshotId !== "string" || !candidate.forecastSnapshotId || typeof candidate.oddsSnapshotId !== "string" || !candidate.oddsSnapshotId) throw new Error("INVALID_VALUE_COMMAND_ID");
  const selections = selectionsFor(candidate.market);
  if (typeof candidate.market !== "string" || selections === null) throw new Error("UNSUPPORTED_VALUE_MARKET");
  if (typeof candidate.selection !== "string" || !selections.includes(candidate.selection as OddsSelection)) throw new Error("MARKET_SELECTION_MISMATCH");
  return value as ValueCommand;
}
