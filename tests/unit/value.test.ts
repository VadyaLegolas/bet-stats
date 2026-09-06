import { describe, expect, it } from "vitest";

import { createForecast, type ForecastDraft } from "../../packages/domain/src/forecast/model.js";
import { normalizeOddsBook } from "../../packages/domain/src/odds/normalize.js";
import { decideValue, VALUE_POLICY } from "../../packages/domain/src/value/decision.js";
import type { EvidenceProjectionDto } from "../../packages/domain/src/evidence/contract.js";

const cutoff = "2026-09-13T12:00:00.000Z";

function projection(teamId: string): EvidenceProjectionDto {
  const source = { observationId: `${teamId}-obs`, provider: "API_FOOTBALL", providerFixtureId: `${teamId}-ext`, effectiveAt: "2026-09-10T12:00:00.000Z", observedAt: cutoff, payloadHash: `sha256:${teamId}`, payloadBytes: 10 };
  const c = (kind: string, value: unknown, sampleSize = 10) => ({ kind, value, unit: "test", sampleSize, limitation: null, sourceRefs: [source] });
  return { teamId, requestedAsOf: cutoff, resolvedAsOfUtc: cutoff, cutoffBoundary: { observedAt: cutoff }, state: "COMPLETE", freshness: "FRESH", buildId: `build-${teamId}`, publishedAt: cutoff, receipt: { requestedAsOf: cutoff, resolvedAsOf: cutoff, configVersion: "evidence-v1", sourceWindow: { requestedFrom: null, requestedTo: cutoff, returnedFrom: source.effectiveAt, returnedTo: source.effectiveAt }, inputs: [source] }, coverage: { requestedFrom: null, requestedTo: cutoff, returnedFrom: source.effectiveAt, returnedTo: source.effectiveAt }, components: { form5: c("form5", 1.5, 5), form10: c("form10", 1.5), elo: c("elo", 1500), homeStrength: c("homeStrength", 1.5), awayStrength: c("awayStrength", 1.5), goalRates: c("goalRates", { for: 1.4, against: 1.2 }), restDays: c("restDays", 5, 1), h2h: c("h2h", { pointsPerMatch: 1.5, weight: 0.03 }, 4) } };
}

function baseForecast(): ForecastDraft {
  return createForecast({ fixtureId: "fixture-1", forecastSnapshotId: "forecast-1", cutoff, canonicalIdentityState: "RESOLVED", home: projection("home"), away: projection("away"), lineupAvailable: true, sourceReliability: 1 });
}

function equalBtts(fixtureId = "fixture-1") {
  return normalizeOddsBook({ fixtureId, oddsSnapshotId: "odds-1", market: "BTTS", sourceLabel: "book", capturedAt: cutoff, selections: [{ selection: "YES", decimalOdds: "2" }, { selection: "NO", decimalOdds: "2" }] });
}

function withYesProbability(base: ForecastDraft, probability: number, confidence = 1): ForecastDraft {
  return { ...base, confidence: { ...base.confidence, score: confidence }, markets: { ...base.markets, BTTS: [{ selection: "YES", probability, fairOdds: String(1 / probability) }, { selection: "NO", probability: 1 - probability, fairOdds: String(1 / (1 - probability)) }] } };
}

describe("value decision truth table", () => {
  it("locks exact threshold boundaries and receipt versions", () => {
    const result = decideValue({ forecast: withYesProbability(baseForecast(), 0.53, 0.65), odds: equalBtts(), selection: "YES" });
    expect(result.outcome).toBe("VALUE_CANDIDATE");
    expect(result.edge).toBe("0.03");
    expect(result.expectedValue).toBe("0.06");
    expect(result.receipt).toMatchObject({ valuePolicyVersion: VALUE_POLICY.version, thresholds: VALUE_POLICY.thresholds, oddsNormalizationVersion: "multiplicative-v1" });
    expect(result.receipt.gates.every(({ passed }) => passed)).toBe(true);
  });

  it.each([
    ["POLICY_CONFIG_MISMATCH", (f: ForecastDraft) => ({ ...f, configVersion: "bad" })],
    ["UNRESOLVED_CANONICAL_IDENTITY", (f: ForecastDraft) => ({ ...f, limitations: ["UNRESOLVED_CANONICAL_IDENTITY"] })],
    ["CUTOFF_MISMATCH", (f: ForecastDraft) => f],
    ["FIXTURE_MISMATCH", (f: ForecastDraft) => f],
  ])("orders %s before confidence and value gates", (reason, mutate) => {
    const forecast = withYesProbability(mutate(baseForecast()) as ForecastDraft, 0.9, 0.1);
    const odds = reason === "FIXTURE_MISMATCH" ? equalBtts("other") : reason === "CUTOFF_MISMATCH" ? { ...equalBtts(), capturedAt: "2026-09-13T11:59:59.000Z" } : equalBtts();
    const result = decideValue({ forecast, odds, selection: "YES" });
    expect(result.outcome).toBe("INSUFFICIENT_EVIDENCE");
    expect(result.reasons.indexOf(reason)).toBeLessThan(result.reasons.indexOf("CONFIDENCE_BELOW_THRESHOLD"));
    expect(result.expectedValue).toBe("0.8");
  });

  it("does not allow positive EV to bypass a failed edge gate", () => {
    const odds = normalizeOddsBook({ fixtureId: "fixture-1", oddsSnapshotId: "odds-1", market: "BTTS", sourceLabel: "book", capturedAt: cutoff, selections: [{ selection: "YES", decimalOdds: "2.2" }, { selection: "NO", decimalOdds: "10" }] });
    const result = decideValue({ forecast: withYesProbability(baseForecast(), 0.47), odds, selection: "YES" });
    expect(Number(result.expectedValue)).toBeGreaterThan(0);
    expect(result.receipt.gates.find(({ gate }) => gate === "EDGE")?.passed).toBe(false);
    expect(result.outcome).toBe("NO_VALUE");
  });

  it("fails a selection outside the explicitly selected odds market", () => {
    const result = decideValue({ forecast: baseForecast(), odds: equalBtts(), selection: "HOME" });
    expect(result.reasons[0]).toBe("MARKET_SELECTION_MISMATCH");
    expect(result.outcome).toBe("INSUFFICIENT_EVIDENCE");
  });
});
