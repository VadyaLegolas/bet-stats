export const RESULT_LIFECYCLES = ["FINISHED", "POSTPONED", "CANCELLED", "ABANDONED", "VOID"] as const;
export type ResultLifecycle = (typeof RESULT_LIFECYCLES)[number];

export interface SettlementResultSource {
  readonly id: string;
  readonly fixtureId: string;
  readonly status: string;
  readonly revision: number;
  readonly observedAt: string;
}

export interface SettlementForecastSource {
  readonly id: string;
  readonly fixtureId: string;
  readonly kind: string;
  readonly state: string;
  readonly cutoff: string;
  readonly issuedAt: string | null;
}

export interface SettlementCommand {
  readonly result: SettlementResultSource;
  readonly forecastSnapshotId: string;
  readonly forecastCandidates: readonly SettlementForecastSource[];
  readonly fixtureKickoffUtc: string;
  readonly settledAt: string;
}

const COMMAND_KEYS = ["fixtureKickoffUtc", "forecastCandidates", "forecastSnapshotId", "result", "settledAt"];

export function parseSettlementCommand(value: unknown): SettlementCommand {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_SETTLEMENT_COMMAND");
  const candidate = value as Record<string, unknown>;
  const actual = Object.keys(candidate).sort();
  if (actual.length !== COMMAND_KEYS.length || actual.some((key, index) => key !== COMMAND_KEYS[index])) throw new Error("INVALID_SETTLEMENT_COMMAND_KEYS");
  if (typeof candidate.forecastSnapshotId !== "string" || !candidate.forecastSnapshotId) throw new Error("INVALID_FORECAST_SNAPSHOT_ID");
  if (!Array.isArray(candidate.forecastCandidates)) throw new Error("INVALID_FORECAST_CANDIDATES");
  if (!candidate.result || typeof candidate.result !== "object" || Array.isArray(candidate.result)) throw new Error("INVALID_RESULT_SOURCE");
  for (const field of ["fixtureKickoffUtc", "settledAt"] as const) {
    if (typeof candidate[field] !== "string" || Number.isNaN(Date.parse(candidate[field]))) throw new Error(`INVALID_${field === "settledAt" ? "SETTLED_AT" : "FIXTURE_KICKOFF"}`);
  }
  return candidate as unknown as SettlementCommand;
}
