// Deterministic stub of `GET /value/scanner` for the scanner end-to-end matrix (Phase 15, plan 15-05).
// Plain node http, no dependencies, bound to 127.0.0.1 only, synthetic data only. The page reads the API on the server,
// so page routing cannot intercept it; states such as UNAVAILABLE cannot be reproduced on live data without mutating
// append-only tables. The DTO shape here is a copy of the ScannerResponse contract: the page parser is fail-closed, so a
// drifted shape turns the AVAILABLE scenario into UNAVAILABLE and fails the specification.
//
//   GET  /__health                    -> 200
//   POST /__scenario {"name": "..."}  -> switches the active scenario (400 for an unknown name)
//   GET  /value/scanner               -> the active scenario
import { createServer } from "node:http";

const PORT = Number(process.env.SCANNER_STUB_PORT ?? 3251);
const GENERATED_AT = "2026-11-27T10:00:00.000Z";
const WINDOW = { from: GENERATED_AT, to: "2026-12-04T10:00:00.000Z" };
const FRESHNESS_POLICY = { version: "scanner-freshness-v1", freshMaxHours: 6, agingMaxHours: 24 };

/** 80 characters without a single break opportunity. */
const LONG_SOURCE = "UnbrokenBookmakerSourceLabel".padEnd(80, "x");
const SCRIPT_SOURCE = "<script>window.__scannerStubInjected=true</script>";
const LONG_TEAM = "Borussiamoenchengladbachunterhachingeintrachtfrankfurtleverkusen";

const FIXTURES = {
  first: { fixtureId: "stub-fixture-1", kickoffAt: "2026-11-28T17:00:00.000Z", homeTeam: LONG_TEAM, awayTeam: "Arsenal", competition: "Премьер-лига" },
  second: { fixtureId: "stub-fixture-2", kickoffAt: "2026-11-29T14:30:00.000Z", homeTeam: "Inter", awayTeam: "Milan", competition: "Серия A" },
  third: { fixtureId: "stub-fixture-3", kickoffAt: "2026-12-01T19:45:00.000Z", homeTeam: "Lyon", awayTeam: "Nantes", competition: "Лига 1" },
};

const FRESHNESS_AGE = { FRESH: 720, AGING: 25_200, STALE: 259_200 };
const FRESHNESS_SUBMITTED = { FRESH: "2026-11-27T09:48:00.000Z", AGING: "2026-11-27T03:00:00.000Z", STALE: "2026-11-24T10:00:00.000Z" };

function item(number, fixture, fields) {
  const freshness = fields.freshness;
  return {
    receiptId: `stub-receipt-${number}`,
    fixtureId: fixture.fixtureId,
    forecastSnapshotId: `stub-forecast-${number}`,
    oddsSnapshotId: `stub-odds-${number}`,
    market: fields.market,
    selection: fields.selection,
    kickoffAt: fixture.kickoffAt,
    homeTeam: fixture.homeTeam,
    awayTeam: fixture.awayTeam,
    competition: fixture.competition,
    oddsSource: fields.oddsSource,
    oddsSubmittedAt: FRESHNESS_SUBMITTED[freshness],
    oddsCapturedAt: null,
    oddsAgeSeconds: FRESHNESS_AGE[freshness],
    freshness,
    forecastNewerAvailable: fields.forecastNewerAvailable ?? false,
    edge: fields.edge,
    expectedValue: fields.expectedValue,
    modelProbability: fields.modelProbability,
    noVigProbability: fields.noVigProbability,
    fairOdds: fields.fairOdds,
    decimalOdds: fields.decimalOdds,
    valuePolicyVersion: "value-policy-v1",
    edgeDefinition: fields.edgeDefinition ?? null,
    evPolicyVersion: fields.evPolicyVersion ?? null,
  };
}

// Edge values are deliberately not monotone in display order: the list is never ranked.
const ITEMS = [
  item(1, FIXTURES.first, {
    market: "ONE_X_TWO", selection: "HOME", freshness: "FRESH", oddsSource: LONG_SOURCE,
    edge: "0.0432109876543210987654321", expectedValue: "0.1234567890123456789012345678901234567891",
    modelProbability: "0.4876543210987654321098765432109876543219", noVigProbability: "0.4444444444444444444444444444444444444441",
    fairOdds: "2.050632911392405063291139240506329113924", decimalOdds: "2.123456789012345678901234567890123456789",
  }),
  item(2, FIXTURES.first, {
    market: "OVER_UNDER_2_5", selection: "OVER_2_5", freshness: "AGING", oddsSource: SCRIPT_SOURCE,
    edge: "1.2e-7", expectedValue: "3.4e-7", modelProbability: "0.51", noVigProbability: "0.50999988", fairOdds: "1.96", decimalOdds: "1.9608",
  }),
  item(3, FIXTURES.second, {
    market: "BTTS", selection: "YES", freshness: "FRESH", oddsSource: "Stub Bookmaker",
    edge: "0.1000", expectedValue: "0.2000", modelProbability: "0.6000", noVigProbability: "0.5000", fairOdds: null, decimalOdds: "2.0000",
  }),
  item(4, FIXTURES.second, {
    market: "ASIAN_HANDICAP:-0.75", selection: "HOME", freshness: "AGING", oddsSource: null, forecastNewerAvailable: true,
    edge: "0.025000000000000000000000000000000000001", expectedValue: "0.031", modelProbability: "0.55", noVigProbability: "0.525",
    fairOdds: "1.82", decimalOdds: "1.875", edgeDefinition: "conditional-win-probability-minus-no-vig", evPolicyVersion: "push-aware-ev-v1",
  }),
  item(5, FIXTURES.third, {
    market: "EXACT_SCORE", selection: "2-1", freshness: "STALE", oddsSource: "Stub Bookmaker",
    edge: "0.0712345678901234567890123456789012345678", expectedValue: "0.5", modelProbability: "0.09", noVigProbability: "0.0555", fairOdds: "11.11", decimalOdds: "17",
  }),
];

const response = (fields) => ({
  state: fields.items.length > 0 ? "AVAILABLE" : "EMPTY",
  generatedAt: GENERATED_AT,
  window: WINDOW,
  limit: 200,
  truncated: false,
  freshnessPolicy: FRESHNESS_POLICY,
  checkedCount: fields.items.length,
  outcomeCounts: fields.items.length > 0 ? { VALUE_CANDIDATE: fields.items.length } : {},
  totalCandidates: fields.items.length,
  allPolicyConfigMismatch: false,
  ...fields,
});

/** Same rows in the same positions, only the edge strings are replaced: the page must keep the order it receives. */
const withEdges = (edges) => ITEMS.map((entry, index) => ({ ...entry, edge: edges[index] }));

const SCENARIOS = {
  available: { status: 200, body: response({ items: ITEMS }) },
  "available-edge-descending": { status: 200, body: response({ items: withEdges(["0.5", "0.4", "0.3", "0.2", "0.1"]) }) },
  "available-edge-ascending": { status: 200, body: response({ items: withEdges(["0.1", "0.2", "0.3", "0.4", "0.5"]) }) },
  "all-stale": {
    status: 200,
    body: response({
      items: ITEMS.map((entry) => ({ ...entry, freshness: "STALE", oddsAgeSeconds: FRESHNESS_AGE.STALE, oddsSubmittedAt: FRESHNESS_SUBMITTED.STALE })),
    }),
  },
  "empty-zero": { status: 200, body: response({ items: [] }) },
  "empty-counts": { status: 200, body: response({ items: [], checkedCount: 7, outcomeCounts: { INSUFFICIENT_EVIDENCE: 4, NO_VALUE: 3 } }) },
  "empty-policy": { status: 200, body: response({ items: [], checkedCount: 5, outcomeCounts: { INSUFFICIENT_EVIDENCE: 5 }, allPolicyConfigMismatch: true }) },
  truncated: {
    status: 200,
    body: response({ items: ITEMS.slice(0, 4), truncated: true, totalCandidates: 250, checkedCount: 250, outcomeCounts: { VALUE_CANDIDATE: 250 } }),
  },
  unavailable: { status: 503, body: { code: "SCANNER_READ_FAILED" } },
  // AVAILABLE with no item contradicts the contract: the page must fail closed.
  "invalid-shape": { status: 200, body: { ...response({ items: [] }), state: "AVAILABLE" } },
};

let active = "available";

function send(reply, status, body) {
  reply.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  reply.end(JSON.stringify(body));
}

createServer((request, reply) => {
  const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
  if (request.method === "GET" && path === "/__health") return send(reply, 200, { ok: true });
  if (request.method === "GET" && path === "/value/scanner") return send(reply, SCENARIOS[active].status, SCENARIOS[active].body);
  if (request.method === "POST" && path === "/__scenario") {
    let raw = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => { raw += chunk; });
    request.on("end", () => {
      let name;
      try { name = JSON.parse(raw).name; } catch { name = undefined; }
      if (typeof name !== "string" || !Object.hasOwn(SCENARIOS, name)) return send(reply, 400, { code: "UNKNOWN_SCENARIO" });
      active = name;
      return send(reply, 200, { name });
    });
    return undefined;
  }
  return send(reply, 404, { code: "NOT_FOUND" });
}).listen(PORT, "127.0.0.1");
