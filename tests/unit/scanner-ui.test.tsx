import { describe, expect, it } from "vitest";

import { loadScanner, type ScannerRepository, type ScannerRow } from "../../apps/api/src/modules/value/scanner.service.js";
import { parseScannerResponse, type ScannerItem, type ScannerPayload } from "../../apps/web/app/scanner/scanner-types.js";

/* ------------------------------------------------------------------ builders */

const EDGE = "0.0432109876543210987654321";
const EV = "1.2e-7";
const PROBABILITY = "0.1000";
const ODDS = "1.2345678901234567890123456789012345678901";

export function item(overrides: Partial<ScannerItem> = {}): ScannerItem {
  return {
    receiptId: "receipt-1",
    fixtureId: "fixture-1",
    forecastSnapshotId: "snapshot-1",
    oddsSnapshotId: "odds-1",
    market: "ONE_X_TWO",
    selection: "HOME",
    kickoffAt: "2026-11-28T17:00:00.000Z",
    homeTeam: "Арсенал",
    awayTeam: "Челси",
    competition: "Премьер-лига",
    oddsSource: "Pinnacle",
    oddsSubmittedAt: "2026-11-25T13:05:00.000Z",
    oddsCapturedAt: "2026-11-25T13:00:00.000Z",
    oddsAgeSeconds: 7200,
    freshness: "FRESH",
    forecastNewerAvailable: false,
    edge: EDGE,
    expectedValue: EV,
    modelProbability: PROBABILITY,
    noVigProbability: "0.4800",
    fairOdds: "2.0833",
    decimalOdds: ODDS,
    valuePolicyVersion: "value-policy-v1",
    edgeDefinition: null,
    evPolicyVersion: null,
    ...overrides,
  };
}

export function response(items: readonly ScannerItem[], overrides: Partial<ScannerPayload> = {}): ScannerPayload {
  return {
    state: items.length > 0 ? "AVAILABLE" : "EMPTY",
    generatedAt: "2026-11-25T14:05:00.000Z",
    window: { from: "2026-11-25T14:05:00.000Z", to: "2026-12-02T14:05:00.000Z" },
    limit: 200,
    truncated: false,
    freshnessPolicy: { version: "scanner-freshness-v1", freshMaxHours: 6, agingMaxHours: 24 },
    checkedCount: items.length,
    outcomeCounts: items.length > 0 ? { VALUE_CANDIDATE: items.length } : {},
    totalCandidates: items.length,
    allPolicyConfigMismatch: false,
    items,
    ...overrides,
  };
}

const row = (overrides: Partial<ScannerRow> = {}): ScannerRow => ({
  checked: 1,
  outcomeCounts: { VALUE_CANDIDATE: 1 },
  allPolicyMismatch: false,
  ord: 1,
  receiptId: "receipt-1",
  fixtureId: "fixture-1",
  forecastSnapshotId: "snapshot-1",
  oddsSnapshotId: "odds-1",
  market: "ONE_X_TWO",
  selection: "HOME",
  edge: EDGE,
  expectedValue: EV,
  modelProbability: PROBABILITY,
  noVigProbability: "0.4800",
  fairOdds: "2.0833",
  decimalOdds: ODDS,
  valuePolicyVersion: "value-policy-v1",
  edgeDefinition: null,
  evPolicyVersion: null,
  kickoffAt: new Date("2026-11-28T17:00:00.000Z"),
  homeTeam: "Арсенал",
  awayTeam: "Челси",
  competition: "Премьер-лига",
  oddsSource: "Pinnacle",
  oddsSubmittedAt: new Date("2026-11-25T13:05:00.000Z"),
  oddsCapturedAt: "2026-11-25T13:00:00.000Z",
  forecastNewerAvailable: false,
  ...overrides,
});

const repositoryOf = (rows: readonly ScannerRow[]): ScannerRepository => ({ loadWindow: async () => rows });
const NOW = new Date("2026-11-25T14:05:00.000Z");

/* ------------------------------------------------------------------ parser */

describe("parseScannerResponse", () => {
  it("accepts the real loadScanner output for AVAILABLE and EMPTY, which pins the page key lists to the API contract", async () => {
    const available = await loadScanner({ now: NOW }, repositoryOf([row()]));
    const parsedAvailable = parseScannerResponse(JSON.parse(JSON.stringify(available)));
    expect(parsedAvailable?.state).toBe("AVAILABLE");
    expect(parsedAvailable?.items).toHaveLength(1);

    const empty = await loadScanner({ now: NOW }, repositoryOf([row({ receiptId: null, ord: null, checked: 3, outcomeCounts: { NO_VALUE: 3 }, allPolicyMismatch: true })]));
    const parsedEmpty = parseScannerResponse(JSON.parse(JSON.stringify(empty)));
    expect(parsedEmpty?.state).toBe("EMPTY");
    expect(parsedEmpty?.allPolicyConfigMismatch).toBe(true);
  });

  it("keeps a held-out edge string byte for byte", () => {
    const parsed = parseScannerResponse(JSON.parse(JSON.stringify(response([item()]))));
    expect(parsed?.items[0]?.edge).toBe(EDGE);
    expect(parsed?.items[0]?.expectedValue).toBe(EV);
  });

  it("accepts null stored values", () => {
    const parsed = parseScannerResponse(response([item({ edge: null, fairOdds: null, oddsSource: null })]));
    expect(parsed).not.toBeNull();
  });

  const valid = () => JSON.parse(JSON.stringify(response([item()]))) as Record<string, unknown>;
  const validItem = (body: Record<string, unknown>) => (body.items as Record<string, unknown>[])[0]!;

  it.each<[string, (body: Record<string, unknown>) => unknown]>([
    ["a missing top-level key", (body) => { delete body.checkedCount; return body; }],
    ["an extra top-level key", (body) => ({ ...body, extra: 1 })],
    ["a wrong state", (body) => ({ ...body, state: "UNAVAILABLE" })],
    ["AVAILABLE with zero items", (body) => ({ ...body, items: [] })],
    ["EMPTY with items", (body) => ({ ...body, state: "EMPTY" })],
    ["a numeric edge", (body) => { validItem(body).edge = 0.05; return body; }],
    ["a string age", (body) => { validItem(body).oddsAgeSeconds = "7200"; return body; }],
    ["a fractional age", (body) => { validItem(body).oddsAgeSeconds = 1.5; return body; }],
    ["an unknown freshness", (body) => { validItem(body).freshness = "FRESHISH"; return body; }],
    ["a missing item key", (body) => { delete validItem(body).selection; return body; }],
    ["an extra item key", (body) => { validItem(body).extra = "x"; return body; }],
    ["a non-boolean flag", (body) => { validItem(body).forecastNewerAvailable = "false"; return body; }],
    ["a non-boolean truncated", (body) => ({ ...body, truncated: 0 })],
    ["a non-integer outcome count", (body) => ({ ...body, outcomeCounts: { NO_VALUE: "3" } })],
    ["a policy without a version", (body) => ({ ...body, freshnessPolicy: { freshMaxHours: 6, agingMaxHours: 24 } })],
    ["an array instead of an object", () => []],
    ["null", () => null],
    ["a string", () => "AVAILABLE"],
  ])("returns null for %s", (_name, mutate) => {
    expect(parseScannerResponse(mutate(valid()))).toBeNull();
  });
});

/* @@scanner-ui-tests-continue@@ */
