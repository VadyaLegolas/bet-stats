import { createHash } from "node:crypto";

import { parseSettlementCommand, RESULT_LIFECYCLES, type ResultLifecycle, type SettlementCommand, type SettlementForecastSource } from "./contract.js";

export const SETTLEMENT_POLICY_VERSION = "settlement-policy-v1";

export interface SettlementReceipt {
  readonly policyVersion: typeof SETTLEMENT_POLICY_VERSION;
  readonly policyHash: string;
  readonly fixtureId: string;
  readonly resultVersionId: string;
  readonly forecastSnapshotId: string;
  readonly lifecycle: ResultLifecycle;
  readonly scoreability: "SCOREABLE" | "PENDING" | "NON_SCORED";
  readonly financialEligibility: "ELIGIBLE" | "NOT_ELIGIBLE" | "NON_FINANCIAL";
  readonly classOutcome: "SCORED" | "PENDING" | "NON_SCORED";
  readonly reason: string;
  readonly resultObservedAt: string;
  readonly forecastCutoff: string;
  readonly forecastIssuedAt: string;
  readonly fixtureKickoffUtc: string;
  readonly settledAt: string;
}

const POLICY = {
  eligibleForecastKinds: ["LINEUP_CONFIRMED", "PRE_MATCH"],
  lifecycle: {
    ABANDONED: ["NON_SCORED", "NON_FINANCIAL", "NON_SCORED", "RESULT_ABANDONED"],
    CANCELLED: ["NON_SCORED", "NON_FINANCIAL", "NON_SCORED", "RESULT_CANCELLED"],
    FINISHED: ["SCOREABLE", "ELIGIBLE", "SCORED", "RESULT_FINISHED"],
    POSTPONED: ["PENDING", "NOT_ELIGIBLE", "PENDING", "RESULT_POSTPONED"],
    VOID: ["NON_SCORED", "NON_FINANCIAL", "NON_SCORED", "RESULT_VOID"],
  },
  version: SETTLEMENT_POLICY_VERSION,
} as const;

const POLICY_HASH = createHash("sha256").update(JSON.stringify(POLICY)).digest("hex");

function exactForecast(command: SettlementCommand): SettlementForecastSource {
  if (command.forecastCandidates.length === 0) throw new Error("FORECAST_NOT_FOUND");
  if (command.forecastCandidates.length !== 1) throw new Error("FORECAST_AMBIGUOUS");
  const forecast = command.forecastCandidates[0]!;
  if (forecast.id !== command.forecastSnapshotId) throw new Error("FORECAST_ID_MISMATCH");
  if (forecast.fixtureId !== command.result.fixtureId) throw new Error("FORECAST_FIXTURE_MISMATCH");
  if (forecast.kind === "INITIAL" || !POLICY.eligibleForecastKinds.includes(forecast.kind as "PRE_MATCH" | "LINEUP_CONFIRMED")) throw new Error("FORECAST_NOT_SCOREABLE");
  if (forecast.state !== "ISSUED" || !forecast.issuedAt) throw new Error("FORECAST_NOT_ISSUED");
  if (Number.isNaN(Date.parse(forecast.cutoff)) || Date.parse(forecast.cutoff) >= Date.parse(command.fixtureKickoffUtc)) throw new Error("FORECAST_AFTER_KICKOFF");
  return forecast;
}

export function resolveSettlement(input: unknown): SettlementReceipt {
  const command = parseSettlementCommand(input);
  if (!RESULT_LIFECYCLES.includes(command.result.status as ResultLifecycle)) throw new Error("UNKNOWN_RESULT_STATUS");
  const forecast = exactForecast(command);
  const lifecycle = command.result.status as ResultLifecycle;
  const [scoreability, financialEligibility, classOutcome, reason] = POLICY.lifecycle[lifecycle];
  return {
    policyVersion: SETTLEMENT_POLICY_VERSION,
    policyHash: POLICY_HASH,
    fixtureId: command.result.fixtureId,
    resultVersionId: command.result.id,
    forecastSnapshotId: forecast.id,
    lifecycle,
    scoreability,
    financialEligibility,
    classOutcome,
    reason,
    resultObservedAt: new Date(command.result.observedAt).toISOString(),
    forecastCutoff: new Date(forecast.cutoff).toISOString(),
    forecastIssuedAt: new Date(forecast.issuedAt!).toISOString(),
    fixtureKickoffUtc: new Date(command.fixtureKickoffUtc).toISOString(),
    settledAt: new Date(command.settledAt).toISOString(),
  };
}
