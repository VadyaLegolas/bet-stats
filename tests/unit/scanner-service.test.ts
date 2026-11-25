import { afterEach, describe, expect, it, vi } from "vitest";

import { BadRequestException, Logger, ServiceUnavailableException } from "../../apps/api/node_modules/@nestjs/common/index.js";
import { ScannerController } from "../../apps/api/src/modules/value/scanner.controller.js";
import {
  getScanner, loadScanner, type ScannerRepository, type ScannerRow, type ScannerService,
} from "../../apps/api/src/modules/value/scanner.service.js";
import type { ScannerItem, ScannerResponse } from "../../packages/domain/src/value/scanner.js";

const NOW = new Date("2026-11-25T12:00:00.000Z");
const HOUR = 3_600_000;

const ITEM_KEYS = [
  "receiptId", "fixtureId", "forecastSnapshotId", "oddsSnapshotId", "market", "selection", "kickoffAt", "homeTeam", "awayTeam", "competition",
  "oddsSource", "oddsSubmittedAt", "oddsCapturedAt", "oddsAgeSeconds", "freshness", "forecastNewerAvailable", "edge", "expectedValue",
  "modelProbability", "noVigProbability", "fairOdds", "decimalOdds", "valuePolicyVersion", "edgeDefinition", "evPolicyVersion",
] as const satisfies readonly (keyof ScannerItem)[];

const TOP_KEYS = [
  "state", "generatedAt", "window", "limit", "truncated", "freshnessPolicy", "checkedCount", "outcomeCounts", "totalCandidates", "allPolicyConfigMismatch", "items",
] as const satisfies readonly (keyof ScannerResponse)[];

function summaryRow(overrides: Partial<ScannerRow> = {}): ScannerRow {
  return {
    checked: 0, outcomeCounts: {}, allPolicyMismatch: false, ord: null, receiptId: null, fixtureId: null, forecastSnapshotId: null, oddsSnapshotId: null,
    market: null, selection: null, edge: null, expectedValue: null, modelProbability: null, noVigProbability: null, fairOdds: null, decimalOdds: null,
    valuePolicyVersion: null, edgeDefinition: null, evPolicyVersion: null, kickoffAt: null, homeTeam: null, awayTeam: null, competition: null,
    oddsSource: null, oddsSubmittedAt: null, oddsCapturedAt: null, forecastNewerAvailable: null,
    ...overrides,
  };
}

/** A candidate row; `n` makes ids and kickoff unique, `submittedHoursAgo` sets the odds age relative to NOW. */
function candidateRow(n: number, overrides: Partial<ScannerRow> = {}, submittedHoursAgo = 1): ScannerRow {
  return summaryRow({
    checked: 3, outcomeCounts: { VALUE_CANDIDATE: 3 }, ord: n,
    receiptId: `receipt-${n}`, fixtureId: `fixture-${n}`, forecastSnapshotId: `forecast-${n}`, oddsSnapshotId: `odds-${n}`,
    market: "ONE_X_TWO", selection: "HOME",
    edge: "0.0500", expectedValue: "0.0800", modelProbability: "0.5000", noVigProbability: "0.4500", fairOdds: "2.0000", decimalOdds: "2.1600",
    valuePolicyVersion: "value-policy-v1", edgeDefinition: null, evPolicyVersion: null,
    kickoffAt: new Date(NOW.getTime() + n * HOUR), homeTeam: `Home ${n}`, awayTeam: `Away ${n}`, competition: "Premier League",
    oddsSource: "bookmaker", oddsSubmittedAt: new Date(NOW.getTime() - submittedHoursAgo * HOUR), oddsCapturedAt: "2026-11-25T10:00:00.000Z",
    forecastNewerAvailable: false,
    ...overrides,
  });
}

interface RecordedCall { from: Date; to: Date; limit: number }

function memoryRepository(rows: readonly ScannerRow[]): ScannerRepository & { calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  return {
    calls,
    loadWindow: async (input) => {
      calls.push({ from: input.from, to: input.to, limit: input.limit });
      return rows;
    },
  };
}

afterEach(() => { vi.restoreAllMocks(); });

describe("loadScanner window and cap (D-03)", () => {
  it("reads once with from = now, to = now + 7 days to the millisecond and limit 200", async () => {
    const repository = memoryRepository([summaryRow()]);
    const response = await loadScanner({ now: NOW }, repository);
    expect(repository.calls).toHaveLength(1);
    const call = repository.calls[0]!;
    expect(call.from.getTime()).toBe(NOW.getTime());
    expect(call.to.getTime()).toBe(NOW.getTime() + 7 * 86_400_000);
    expect(call.limit).toBe(200);
    expect(response.window).toEqual({ from: "2026-11-25T12:00:00.000Z", to: "2026-12-02T12:00:00.000Z" });
    expect(response.limit).toBe(200);
    expect(Number.isInteger(response.limit)).toBe(true);
  });
});

describe("loadScanner one instant (D-06)", () => {
  it("derives every age from the same generatedAt instant", async () => {
    const rows = [candidateRow(1, {}, 3), candidateRow(2, {}, 30)];
    const response = await loadScanner({ now: NOW }, memoryRepository(rows));
    expect(response.generatedAt).toBe(NOW.toISOString());
    expect(response.items.map((item) => item.oddsAgeSeconds)).toEqual([10_800, 108_000]);
    expect(response.items.map((item) => item.freshness)).toEqual(["FRESH", "STALE"]);
    for (const item of response.items) {
      expect(Date.parse(response.generatedAt) - Date.parse(item.oddsSubmittedAt)).toBe(item.oddsAgeSeconds * 1000);
    }
  });

  it("an odds time after now gives age 0 and FRESH", async () => {
    const future = candidateRow(1, { oddsSubmittedAt: new Date(NOW.getTime() + 5 * HOUR) });
    const response = await loadScanner({ now: NOW }, memoryRepository([future]));
    expect(response.items[0]!.oddsAgeSeconds).toBe(0);
    expect(response.items[0]!.freshness).toBe("FRESH");
  });

  it("the age boundaries survive the row mapping: 21599 s FRESH, 21600 s AGING, 86400 s AGING, 86401 s STALE", async () => {
    const at = (seconds: number) => candidateRow(1, { oddsSubmittedAt: new Date(NOW.getTime() - seconds * 1000) });
    const labels: string[] = [];
    for (const seconds of [21_599, 21_600, 86_400, 86_401]) {
      const response = await loadScanner({ now: NOW }, memoryRepository([at(seconds)]));
      labels.push(`${response.items[0]!.oddsAgeSeconds}:${response.items[0]!.freshness}`);
    }
    expect(labels).toEqual(["21599:FRESH", "21600:AGING", "86400:AGING", "86401:STALE"]);
  });

  it("the typed oddsCapturedAt never affects freshness", async () => {
    const submitted = new Date(NOW.getTime() - 2 * HOUR);
    const near = candidateRow(1, { oddsSubmittedAt: submitted, oddsCapturedAt: submitted.toISOString() });
    const old = candidateRow(1, { oddsSubmittedAt: submitted, oddsCapturedAt: new Date(submitted.getTime() - 3 * 86_400_000).toISOString() });
    const a = (await loadScanner({ now: NOW }, memoryRepository([near]))).items[0]!;
    const b = (await loadScanner({ now: NOW }, memoryRepository([old]))).items[0]!;
    expect(b.freshness).toBe(a.freshness);
    expect(b.oddsAgeSeconds).toBe(a.oddsAgeSeconds);
    expect(b.freshness).toBe("FRESH");
    expect(b.oddsCapturedAt).toBe(old.oddsCapturedAt);
  });
});

describe("loadScanner verbatim strings (D-04)", () => {
  it("copies stored decimals byte for byte and keeps a null edge null", async () => {
    const forty = "0.1234567890123456789012345678901234567890";
    const exact = candidateRow(1, {
      edge: "0.0432109876543210987654321", expectedValue: "1.2e-7", modelProbability: "0.1000", noVigProbability: forty,
      fairOdds: "10.0000", decimalOdds: "2.5000",
    });
    const nulled = candidateRow(2, { edge: null, expectedValue: null });
    const response = await loadScanner({ now: NOW }, memoryRepository([exact, nulled]));
    const [first, second] = response.items as [ScannerItem, ScannerItem];
    expect(first.edge).toBe("0.0432109876543210987654321");
    expect(first.expectedValue).toBe("1.2e-7");
    expect(first.modelProbability).toBe("0.1000");
    expect(first.noVigProbability).toBe(forty);
    expect(first.noVigProbability).toHaveLength(42);
    expect(first.fairOdds).toBe("10.0000");
    expect(first.decimalOdds).toBe("2.5000");
    for (const value of [first.edge, first.expectedValue, first.modelProbability, first.noVigProbability, first.fairOdds, first.decimalOdds]) {
      expect(typeof value).toBe("string");
    }
    expect(second.edge).toBeNull();
    expect(second.expectedValue).toBeNull();
    expect(JSON.parse(JSON.stringify(response)).items[1].edge).toBeNull();
  });

  it("survives JSON serialisation without altering the strings", async () => {
    const row = candidateRow(1, { edge: "0.0432109876543210987654321", expectedValue: "1.2e-7", modelProbability: "0.1000" });
    const response = await loadScanner({ now: NOW }, memoryRepository([row]));
    const parsed = JSON.parse(JSON.stringify(response)) as ScannerResponse;
    expect(parsed.items[0]!.edge).toBe("0.0432109876543210987654321");
    expect(parsed.items[0]!.expectedValue).toBe("1.2e-7");
    expect(parsed.items[0]!.modelProbability).toBe("0.1000");
  });
});

describe("loadScanner never reorders (D-09)", () => {
  it("keeps the repository order for edges descending and for edges ascending", async () => {
    const edges = ["0.3000", "0.2000", "0.1000"];
    const build = (ordered: readonly string[]) => ordered.map((edge, index) => candidateRow(index + 1, { edge, expectedValue: edge }));
    const descending = await loadScanner({ now: NOW }, memoryRepository(build(edges)));
    const ascending = await loadScanner({ now: NOW }, memoryRepository(build([...edges].reverse())));
    expect(descending.items.map((item) => item.receiptId)).toEqual(["receipt-1", "receipt-2", "receipt-3"]);
    expect(ascending.items.map((item) => item.receiptId)).toEqual(["receipt-1", "receipt-2", "receipt-3"]);
    expect(descending.items.map((item) => item.edge)).toEqual(edges);
    expect(ascending.items.map((item) => item.edge)).toEqual([...edges].reverse());
  });

  it("keeps a repository order that is not sorted by any visible value", async () => {
    const rows = [candidateRow(3), candidateRow(1), candidateRow(2)];
    const response = await loadScanner({ now: NOW }, memoryRepository(rows));
    expect(response.items.map((item) => item.receiptId)).toEqual(["receipt-3", "receipt-1", "receipt-2"]);
  });
});

describe("loadScanner states and summary", () => {
  it("no candidates and nothing checked is EMPTY with zero counts", async () => {
    const response = await loadScanner({ now: NOW }, memoryRepository([summaryRow({ checked: 0, outcomeCounts: {} })]));
    expect(response.state).toBe("EMPTY");
    expect(response.items).toEqual([]);
    expect(response.truncated).toBe(false);
    expect(response.totalCandidates).toBe(0);
    expect(response.checkedCount).toBe(0);
    expect(response.allPolicyConfigMismatch).toBe(false);
  });

  it("only non-candidate outcomes are EMPTY and keep the exact counts", async () => {
    const counts = { INSUFFICIENT_EVIDENCE: 4, NO_VALUE: 9 };
    const response = await loadScanner({ now: NOW }, memoryRepository([summaryRow({ checked: 13, outcomeCounts: counts })]));
    expect(response.state).toBe("EMPTY");
    expect(response.checkedCount).toBe(13);
    expect(response.outcomeCounts).toEqual(counts);
    expect(response.totalCandidates).toBe(0);
    expect(response.truncated).toBe(false);
    expect(response.items).toHaveLength(0);
  });

  it("candidate rows are AVAILABLE and totalCandidates comes from outcomeCounts", async () => {
    const rows = [candidateRow(1), candidateRow(2), candidateRow(3)];
    const response = await loadScanner({ now: NOW }, memoryRepository(rows));
    expect(response.state).toBe("AVAILABLE");
    expect(response.items).toHaveLength(3);
    expect(response.totalCandidates).toBe(3);
    expect(response.truncated).toBe(false);
  });

  it("truncated is true only when totalCandidates exceeds the listed items", async () => {
    const counts = { VALUE_CANDIDATE: 5, NO_VALUE: 2 };
    const listed = [1, 2, 3].map((n) => candidateRow(n, { checked: 7, outcomeCounts: counts }));
    const truncated = await loadScanner({ now: NOW }, memoryRepository(listed));
    expect(truncated.truncated).toBe(true);
    expect(truncated.totalCandidates).toBe(5);
    expect(truncated.checkedCount).toBe(7);
    const all = [1, 2, 3, 4, 5].map((n) => candidateRow(n, { checked: 7, outcomeCounts: counts }));
    const complete = await loadScanner({ now: NOW }, memoryRepository(all));
    expect(complete.truncated).toBe(false);
  });

  it("carries the all-policy-mismatch flag from the summary", async () => {
    const response = await loadScanner({ now: NOW }, memoryRepository([summaryRow({ checked: 2, outcomeCounts: { INSUFFICIENT_EVIDENCE: 2 }, allPolicyMismatch: true })]));
    expect(response.allPolicyConfigMismatch).toBe(true);
    expect(response.state).toBe("EMPTY");
  });
});

describe("loadScanner payload shape", () => {
  it("has exactly the documented top-level and item keys and no receipt-internal keys", async () => {
    const response = await loadScanner({ now: NOW }, memoryRepository([candidateRow(1)]));
    expect(Object.keys(response).sort()).toEqual([...TOP_KEYS].sort());
    expect(Object.keys(response.items[0]!).sort()).toEqual([...ITEM_KEYS].sort());
    expect(() => JSON.stringify(response)).not.toThrow();
    const text = JSON.stringify(response);
    for (const forbidden of ["receipt\"", "\"sources\"", "\"assumptions\"", "\"gates\""]) expect(text).not.toContain(forbidden);
    const keys = new Set<string>();
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === "object") for (const [key, inner] of Object.entries(value)) { keys.add(key); walk(inner); }
    };
    walk(response);
    for (const forbidden of ["receipt", "sources", "assumptions", "gates"]) expect(keys.has(forbidden)).toBe(false);
  });

  it("serialises dates as ISO strings and the Asian handicap policy fields as stored", async () => {
    const row = candidateRow(1, { market: "ASIAN_HANDICAP:-0.25", selection: "HOME", edgeDefinition: "push-aware", evPolicyVersion: "push-aware-ev-v1" });
    const item = (await loadScanner({ now: NOW }, memoryRepository([row]))).items[0]!;
    expect(item.kickoffAt).toBe(new Date(NOW.getTime() + HOUR).toISOString());
    expect(item.oddsSubmittedAt).toBe(new Date(NOW.getTime() - HOUR).toISOString());
    expect(item.edgeDefinition).toBe("push-aware");
    expect(item.evPolicyVersion).toBe("push-aware-ev-v1");
  });
});

describe("loadScanner failure on a missing summary", () => {
  it("an empty repository result is a failure, never an empty scanner", async () => {
    await expect(loadScanner({ now: NOW }, memoryRepository([]))).rejects.toThrow("SCANNER_SUMMARY_MISSING");
  });

  it("getScanner surfaces it as SCANNER_READ_FAILED", async () => {
    vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    const failure = await getScanner(memoryRepository([]), NOW).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ServiceUnavailableException);
    expect((failure as ServiceUnavailableException).getStatus()).toBe(503);
    expect((failure as ServiceUnavailableException).getResponse()).toEqual({ code: "SCANNER_READ_FAILED" });
  });
});

describe("getScanner typed errors (V7)", () => {
  it("a missing repository is DATABASE_UNAVAILABLE", async () => {
    const failure = await getScanner(null, NOW).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ServiceUnavailableException);
    expect((failure as ServiceUnavailableException).getStatus()).toBe(503);
    expect((failure as ServiceUnavailableException).getResponse()).toEqual({ code: "DATABASE_UNAVAILABLE" });
  });

  it("a repository error never reaches the client message and is logged for the operator", async () => {
    const warn = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    const internal = 'relation "ValueReceipt" does not exist at postgresql://user:secret@db.internal:5432/bet';
    const repository: ScannerRepository = { loadWindow: async () => { throw new Error(internal); } };
    const failure = await getScanner(repository, NOW).catch((error: unknown) => error) as ServiceUnavailableException;
    expect(failure).toBeInstanceOf(ServiceUnavailableException);
    expect(failure.getStatus()).toBe(503);
    expect(failure.getResponse()).toEqual({ code: "SCANNER_READ_FAILED" });
    const serialised = JSON.stringify(failure.getResponse());
    expect(serialised).not.toContain("ValueReceipt");
    expect(serialised).not.toContain("postgresql://");
    expect(serialised).not.toContain("secret");
    expect(failure.message).not.toContain("ValueReceipt");
    expect(failure.message).not.toContain("postgresql://");
    expect(warn).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(String(warn.mock.calls[0]![0])) as { code: string; reason: string };
    expect(logged.code).toBe("SCANNER_READ_FAILED");
    expect(logged.reason).toBe(internal);
  });

  it("returns the response untouched when the read succeeds", async () => {
    const response = await getScanner(memoryRepository([candidateRow(1)]), NOW);
    expect(response.state).toBe("AVAILABLE");
    expect(response.generatedAt).toBe(NOW.toISOString());
  });
});

describe("ScannerController query rejection (V5)", () => {
  function controller() {
    const get = vi.fn(async () => ({ state: "EMPTY" }) as unknown as ScannerResponse);
    return { get, instance: new ScannerController({ get } as unknown as ScannerService) };
  }

  it("delegates to the service once when no query is given", async () => {
    const { get, instance } = controller();
    await instance.get({});
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("rejects any query key with INVALID_SCANNER_QUERY and never calls the service", () => {
    for (const query of [{ from: "2026-01-01" }, { limit: "5" }, { sort: "edge" }, { anything: "" }]) {
      const { get, instance } = controller();
      let thrown: unknown;
      try { void instance.get(query); } catch (error) { thrown = error; }
      expect(thrown).toBeInstanceOf(BadRequestException);
      expect((thrown as BadRequestException).getStatus()).toBe(400);
      expect((thrown as BadRequestException).getResponse()).toEqual({ code: "INVALID_SCANNER_QUERY" });
      expect(get).not.toHaveBeenCalled();
    }
  });
});
