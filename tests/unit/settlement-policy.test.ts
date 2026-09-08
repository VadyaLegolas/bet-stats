import { describe, expect, it } from "vitest";

import { parseSettlementCommand, resolveSettlement, SETTLEMENT_POLICY_VERSION } from "../../packages/domain/src/index.js";

const kickoffUtc = "2026-09-10T18:00:00.000Z";
const result = { id: "result-1", fixtureId: "fixture-1", status: "FINISHED", revision: 1, observedAt: "2026-09-10T20:00:00.000Z" };
const forecast = { id: "forecast-1", fixtureId: "fixture-1", kind: "PRE_MATCH", state: "ISSUED", cutoff: "2026-09-10T17:00:00.000Z", issuedAt: "2026-09-10T17:00:01.000Z" };

function settle(overrides: Record<string, unknown> = {}) {
  return resolveSettlement({ result, forecastSnapshotId: forecast.id, forecastCandidates: [forecast], fixtureKickoffUtc: kickoffUtc, settledAt: "2026-09-10T20:05:00.000Z", ...overrides });
}

describe("settlement-policy-v1", () => {
  it.each(["PRE_MATCH", "LINEUP_CONFIRMED"] as const)("scores FINISHED against an exact issued %s forecast", (kind) => {
    const receipt = settle({ forecastCandidates: [{ ...forecast, kind }] });
    expect(receipt).toMatchObject({ policyVersion: SETTLEMENT_POLICY_VERSION, resultVersionId: result.id, forecastSnapshotId: forecast.id, lifecycle: "FINISHED", scoreability: "SCOREABLE", financialEligibility: "ELIGIBLE", classOutcome: "SCORED", reason: "RESULT_FINISHED" });
    expect(receipt.policyHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it.each([
    ["POSTPONED", "PENDING", "NOT_ELIGIBLE", "PENDING", "RESULT_POSTPONED"],
    ["CANCELLED", "NON_SCORED", "NON_FINANCIAL", "NON_SCORED", "RESULT_CANCELLED"],
    ["ABANDONED", "NON_SCORED", "NON_FINANCIAL", "NON_SCORED", "RESULT_ABANDONED"],
    ["VOID", "NON_SCORED", "NON_FINANCIAL", "NON_SCORED", "RESULT_VOID"],
  ] as const)("maps %s through the closed lifecycle", (status, scoreability, financialEligibility, classOutcome, reason) => {
    expect(settle({ result: { ...result, status } })).toMatchObject({ lifecycle: status, scoreability, financialEligibility, classOutcome, reason });
  });

  it.each([
    ["INITIAL", "FORECAST_NOT_SCOREABLE"],
    ["BUILDING", "FORECAST_NOT_ISSUED"],
    ["FAILED", "FORECAST_NOT_ISSUED"],
  ] as const)("rejects %s forecast state/kind", (value, reason) => {
    const key = value === "INITIAL" ? "kind" : "state";
    expect(() => settle({ forecastCandidates: [{ ...forecast, [key]: value }] })).toThrow(reason);
  });

  it.each([
    ["missing snapshot", { forecastCandidates: [] }, "FORECAST_NOT_FOUND"],
    ["ambiguous snapshot", { forecastCandidates: [forecast, { ...forecast, id: "forecast-2" }] }, "FORECAST_AMBIGUOUS"],
    ["requested id mismatch", { forecastSnapshotId: "forecast-x" }, "FORECAST_ID_MISMATCH"],
    ["fixture mismatch", { forecastCandidates: [{ ...forecast, fixtureId: "fixture-x" }] }, "FORECAST_FIXTURE_MISMATCH"],
    ["unsupported kind", { forecastCandidates: [{ ...forecast, kind: "IN_PLAY" }] }, "FORECAST_NOT_SCOREABLE"],
    ["cutoff at kickoff", { forecastCandidates: [{ ...forecast, cutoff: kickoffUtc }] }, "FORECAST_AFTER_KICKOFF"],
    ["cutoff after kickoff", { forecastCandidates: [{ ...forecast, cutoff: "2026-09-10T18:00:01.000Z" }] }, "FORECAST_AFTER_KICKOFF"],
  ] as const)("fails closed for %s", (_name, overrides, reason) => {
    expect(() => settle(overrides)).toThrow(reason);
  });

  it("rejects unknown result lifecycle", () => {
    expect(() => settle({ result: { ...result, status: "SUSPENDED" } })).toThrow("UNKNOWN_RESULT_STATUS");
  });

  it("parses only the exact caller-supplied command shape", () => {
    const command = { result, forecastSnapshotId: forecast.id, forecastCandidates: [forecast], fixtureKickoffUtc: kickoffUtc, settledAt: "2026-09-10T20:05:00.000Z" };
    expect(parseSettlementCommand(command)).toEqual(command);
    expect(() => parseSettlementCommand({ ...command, latest: true })).toThrow("INVALID_SETTLEMENT_COMMAND_KEYS");
  });
});
