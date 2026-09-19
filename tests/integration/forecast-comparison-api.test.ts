import { describe, expect, it, vi } from "vitest";

import { ForecastComparisonService, createProductionRepository } from "../../apps/api/src/modules/forecasts/forecast-comparison.service.js";
import { ForecastsController } from "../../apps/api/src/modules/forecasts/forecasts.controller.js";
import { snapshot } from "../unit/forecast-comparison.test.js";

describe("forecast comparison API", () => {
  it.each([
    [null, snapshot("right", "PRE_MATCH", 0.5, [], 0.7, 1.4), "FORECAST_LEFT_NOT_FOUND"],
    [{ ...snapshot("left", "INITIAL", 0.45, [], 0.6, 1.2), fixtureId: "other" }, snapshot("right", "PRE_MATCH", 0.5, [], 0.7, 1.4), "FORECAST_FIXTURE_MISMATCH"],
    [{ ...snapshot("left", "INITIAL", 0.45, [], 0.6, 1.2), state: "BUILDING" }, snapshot("right", "PRE_MATCH", 0.5, [], 0.7, 1.4), "FORECAST_LEFT_NOT_ISSUED"],
  ])("fails exact-pair validation with stable safe codes", async (left, right, code) => {
    const service = new ForecastComparisonService({ findExact: vi.fn(async (id) => id === "left" ? left : right), listIssued: vi.fn(), absenceReason: vi.fn() } as never);
    await expect(service.compare("fixture-1", { leftId: "left", rightId: "right" })).rejects.toMatchObject({ response: { code } });
  });

  it("keeps controller queries exact and private", async () => {
    const comparison = { compare: vi.fn().mockResolvedValue({ fixtureId: "fixture-1" }), availability: vi.fn() };
    const controller = new ForecastsController({} as never, comparison as never);
    await expect(controller.compare("fixture-1", { leftId: "left", rightId: "right" })).resolves.toEqual({ fixtureId: "fixture-1" });
    expect(() => controller.compare("fixture-1", { leftId: "left", rightId: "right", latest: "true" })).toThrowError(expect.objectContaining({ response: { code: "INVALID_FORECAST_COMPARISON_QUERY" } }));
  });

  it("projects every fixed snapshot kind as exact available or reason-coded absent", async () => {
    const issued = [snapshot("pre", "PRE_MATCH", 0.5, [], 0.7, 1.4)];
    const service = new ForecastComparisonService({ findExact: vi.fn(), listIssued: vi.fn().mockResolvedValue(issued), absenceReason: vi.fn(async (_fixture, kind) => kind === "LINEUP_CONFIRMED" ? "NO_CONFIRMED_LINEUP" : "INSUFFICIENT_EVIDENCE") } as never);
    await expect(service.availability("fixture-1")).resolves.toEqual([
      { kind: "INITIAL", status: "absent", reason: "INSUFFICIENT_EVIDENCE" },
      expect.objectContaining({ kind: "PRE_MATCH", status: "available", snapshot: expect.objectContaining({ id: "pre", revision: 1, sourceCount: 1 }) }),
      { kind: "LINEUP_CONFIRMED", status: "absent", reason: "NO_CONFIRMED_LINEUP" },
    ]);
  });

  it("derives lineup absence only from the exact fixture enrichment decision", async () => {
    const findFirst = vi.fn().mockResolvedValue({ outcome: "DENIED", reason: "CIRCUIT_OPEN" });
    const client = {
      lineupObservation: { findFirst: vi.fn().mockResolvedValue(null) },
      fixture: { findUnique: vi.fn().mockResolvedValue({ kickoffUtc: new Date("2026-09-12T12:00:00Z") }) },
      enrichmentDecisionReceipt: { findFirst },
    };

    const repository = createProductionRepository(client as never);
    await expect(repository.absenceReason("fixture-1", "LINEUP_CONFIRMED")).resolves.toBe("PROVIDER_UNAVAILABLE");
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        fixtureId: "fixture-1",
        provider: "api-football",
        endpoint: "LINEUPS",
        cutoff: { lte: new Date("2026-09-12T12:00:00Z") },
      }),
    }));
  });
});
