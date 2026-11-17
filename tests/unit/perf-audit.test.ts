// Wave 0 contract tests for the Phase 10 performance audit instrument
// (scripts/perf-audit.mjs). Pins: per-metric median-of-3 semantics, fail-closed
// budget assertions (UNMEASURABLE_* / budget-breach messages), the closed-field
// secret-free receipt schema, and the recorded-only desktop block (D-04: desktop
// is recorded in the receipt but never gated).
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import * as perfAudit from "../../scripts/perf-audit.mjs";

const scriptPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../scripts/perf-audit.mjs");
const source = readFileSync(scriptPath, "utf8").replace(/\r\n/g, "\n");

// The module must import cleanly without the browser stack loaded: lighthouse,
// chrome-launcher and @playwright/test are lazy-imported inside the runner only.
describe("perf-audit module hygiene", () => {
  it("never statically imports the browser stack", () => {
    expect(source, "perf-audit.mjs must not statically import lighthouse").not.toMatch(/^import\s+.*from\s+"lighthouse"/m);
    expect(source, "perf-audit.mjs must not statically import chrome-launcher").not.toMatch(/^import\s+.*from\s+"chrome-launcher"/m);
    expect(source, "perf-audit.mjs must not statically import @playwright/test").not.toMatch(/^import\s+.*from\s+"@playwright\/test"/m);
  });

  it("exports the pure helpers (median, assertMetricsWithinBudgets, GATED_METRICS, validateReceipt)", () => {
    expect(typeof perfAudit.median).toBe("function");
    expect(typeof perfAudit.assertMetricsWithinBudgets).toBe("function");
    expect(Array.isArray(perfAudit.GATED_METRICS)).toBe(true);
    expect(typeof perfAudit.validateReceipt).toBe("function");
  });
});

const { median, assertMetricsWithinBudgets, GATED_METRICS } = perfAudit as {
  median: (values: number[]) => number;
  assertMetricsWithinBudgets: (metrics: unknown, budgets: unknown) => void;
  GATED_METRICS: readonly string[];
};

describe("median-of-3 semantics", () => {
  it("returns the sorted middle value, never min and never max", () => {
    expect(median([24138.077, 14420.087, 22051.317])).toBe(22051.317);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([5, 5, 5])).toBe(5);
  });

  it("is the per-metric median across runs — a single best or worst run never wins", () => {
    // Three runs where run 1 is best and run 3 is worst for every metric: the median
    // of each metric list is the middle value, not any single run's row.
    expect(median([100, 200, 300])).toBe(200);
    expect(median([300, 100, 200])).toBe(200);
    expect(median([200, 300, 100])).toBe(200);
  });

  it("fails loudly on an empty run list", () => {
    expect(() => median([])).toThrow(/UNMEASURABLE/);
  });
});

// Small literal shaped like the real extraction targets — no mocked LHR blobs.
function makeMetrics(overrides: Record<string, number | undefined> = {}) {
  return {
    lcp: { median: overrides.lcp ?? 2000, runs: [1900, overrides.lcp ?? 2000, 2100] },
    tbt: { median: overrides.tbt ?? 300, runs: [290, overrides.tbt ?? 300, 310] },
    cls: { median: overrides.cls ?? 0.05, runs: [0.05, overrides.cls ?? 0.05, 0.05] },
    scriptTransferBytes: { median: overrides.scriptTransferBytes ?? 400_000, runs: [400_000, overrides.scriptTransferBytes ?? 400_000, 400_000] },
  };
}

const BUDGETS = { lcp: 2500, tbt: 350, cls: 0.07, scriptTransferBytes: 500_000 };

describe("fail-closed budget assertions", () => {
  it("passes when every gated median is within budget", () => {
    expect(() => assertMetricsWithinBudgets(makeMetrics(), BUDGETS)).not.toThrow();
  });

  it("fails with UNMEASURABLE_<METRIC> on an undefined extracted value", () => {
    const metrics = makeMetrics();
    (metrics as Record<string, unknown>).lcp = { median: undefined, runs: [] };
    try {
      assertMetricsWithinBudgets(metrics, BUDGETS);
      expect.unreachable("assertion must fail closed");
    } catch (error) {
      expect((error as Error).message).toContain("UNMEASURABLE_LCP");
    }
  });

  it("fails with UNMEASURABLE_<METRIC> on a NaN extracted value", () => {
    const metrics = makeMetrics({ scriptTransferBytes: Number.NaN });
    try {
      assertMetricsWithinBudgets(metrics, BUDGETS);
      expect.unreachable("assertion must fail closed");
    } catch (error) {
      expect((error as Error).message).toContain("UNMEASURABLE_SCRIPT_TRANSFER_BYTES");
    }
  });

  it("fails with the exact breach message on a median above budget", () => {
    try {
      assertMetricsWithinBudgets(makeMetrics({ lcp: 3000 }), BUDGETS);
      expect.unreachable("assertion must fail closed");
    } catch (error) {
      expect((error as Error).message).toContain("lcp: 3000 > budget 2500");
    }
  });

  it("fails loudly when a budget value is missing (never fail-open)", () => {
    try {
      assertMetricsWithinBudgets(makeMetrics(), { lcp: 2500, tbt: 350, cls: 0.07 });
      expect.unreachable("assertion must fail closed");
    } catch (error) {
      expect((error as Error).message).toContain("scriptTransferBytes");
    }
  });

  it("gates exactly lcp, tbt, cls and scriptTransferBytes (D-02)", () => {
    expect([...GATED_METRICS].sort()).toEqual(["cls", "lcp", "scriptTransferBytes", "tbt"]);
  });
});

// Minimal closed-field receipt literal shaped like perf-receipt-v1.
function makeReceipt(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "perf-receipt-v1",
    date: "2026-11-17T06:00:00.000Z",
    gitSha: "2f4102b34a259ddc990789e16351425dbbbfb9ca",
    lighthouseVersion: "13.6.0",
    profile: { throttlingMethod: "simulate", throttling: { rttMs: 150 }, screenEmulation: { mobile: true, width: 412 }, formFactor: "mobile" },
    pages: [{ url: "http://127.0.0.1:3230/fixtures/perf-audit-fixture", metrics: makeMetrics(), performanceScore: 0.35 }],
    desktop: {
      profile: { throttlingMethod: "simulate", throttling: { rttMs: 150 }, screenEmulation: { mobile: false, width: 1350 }, formFactor: "desktop" },
      metrics: makeMetrics(),
      performanceScore: 0.28,
      recordedOnly: true,
    },
    ...overrides,
  };
}

describe("closed-field secret-free receipt schema", () => {
  it("rejects a receipt with an unknown top-level key", () => {
    const receipt = makeReceipt({ userAgent: "Moto G4 injected via env spread" });
    expect(() => perfAudit.validateReceipt?.(receipt)).toThrow(/UNKNOWN_RECEIPT_KEY|INVALID_RECEIPT/);
  });

  it("accepts a receipt with exactly the closed field set", () => {
    expect(() => perfAudit.validateReceipt?.(makeReceipt())).not.toThrow();
  });

  it("rejects a receipt carrying a connection-string-shaped value", () => {
    const receipt = makeReceipt({ gitSha: "postgresql://postgres:postgres@127.0.0.1:5432/bet_stats" });
    expect(() => perfAudit.validateReceipt?.(receipt)).toThrow(/SECRET/);
  });

  it("rejects a receipt carrying a bearer-style token", () => {
    const receipt = makeReceipt({ gitSha: "authorization: Bearer eyJhbGciOiJIUzI1NiJ9.e30.sig" });
    expect(() => perfAudit.validateReceipt?.(receipt)).toThrow(/SECRET/);
  });

  it("rejects a receipt missing any gated metric block", () => {
    const receipt = makeReceipt();
    const pages = receipt.pages as Array<{ metrics: Record<string, unknown> }>;
    delete pages[0]!.metrics.cls;
    expect(() => perfAudit.validateReceipt?.(receipt)).toThrow(/UNMEASURABLE|MISSING/);
  });
});

describe("recorded-only fields are never gated", () => {
  it("ignores the desktop block entirely: desktop values can never fail the assertion (D-04)", () => {
    // Desktop medians far above every budget — the assertion reads only pages[].metrics.
    const receipt = makeReceipt();
    const desktop = receipt.desktop as { metrics: Record<string, { median: number }> };
    desktop.metrics.lcp = { median: Number.MAX_VALUE, runs: [Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE] };
    desktop.metrics.tbt = { median: Number.MAX_VALUE, runs: [Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE] };
    expect(() => perfAudit.validateReceipt?.(receipt)).not.toThrow();
    const pages = receipt.pages as Array<{ metrics: Record<string, unknown> }>;
    expect(() => assertMetricsWithinBudgets(pages[0]!.metrics, BUDGETS)).not.toThrow();
  });

  it("records the Performance score but never asserts it (D-02)", () => {
    const receipt = makeReceipt();
    const pages = receipt.pages as Array<{ performanceScore: number }>;
    pages[0]!.performanceScore = 0.01;
    expect(() => perfAudit.validateReceipt?.(receipt)).not.toThrow();
  });
});
