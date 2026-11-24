import { describe, expect, it } from "vitest";

import { createPrismaEvaluationRepository } from "../../apps/api/src/modules/evaluation/evaluation.service.js";
import { createProductionRepository } from "../../apps/api/src/modules/forecasts/forecast-comparison.service.js";
import { createPrismaValueRepository } from "../../apps/api/src/modules/value/value.service.js";

type Call = Record<string, unknown>;

const bounds = { from: "2026-09-01T00:00:00.000Z", to: "2026-10-01T00:00:00.000Z" };

/** Fake Prisma client that records the argument of every call; every read resolves empty. */
function fakeEvaluationClient() {
  const calls: Record<string, Call[]> = { scoreFindMany: [], valueFindMany: [] };
  const client = {
    forecastScore: { findMany: async (args: Call) => { calls.scoreFindMany!.push(args); return []; } },
    valueSettlement: { findMany: async (args: Call) => { calls.valueFindMany!.push(args); return []; } },
  };
  return { client: client as never, calls };
}

describe("WR-13: public evaluation reads select only PRODUCTION snapshots", () => {
  it("loadCohort filters the score relation by origin and keeps its existing predicates", async () => {
    const { client, calls } = fakeEvaluationClient();
    await createPrismaEvaluationRepository(client).loadCohort({ modelVersion: "all", competitionId: "all", market: "ONE_X_TWO", ...bounds });
    expect(calls.scoreFindMany).toHaveLength(1);
    expect(calls.scoreFindMany![0]!.where).toEqual({
      supersededBy: null,
      kickoffUtc: { gte: new Date(bounds.from), lt: new Date(bounds.to) },
      market: "ONE_X_TWO",
      forecastSnapshot: { origin: "PRODUCTION" },
    });
  });

  it("loadCohort keeps the model and competition filters next to the origin filter", async () => {
    const { client, calls } = fakeEvaluationClient();
    await createPrismaEvaluationRepository(client).loadCohort({ modelVersion: "dixon-coles-ensemble-v1", competitionId: "league-1", market: "all", ...bounds });
    expect(calls.scoreFindMany![0]!.where).toEqual({
      supersededBy: null,
      kickoffUtc: { gte: new Date(bounds.from), lt: new Date(bounds.to) },
      modelVersion: "dixon-coles-ensemble-v1",
      leagueId: "league-1",
      forecastSnapshot: { origin: "PRODUCTION" },
    });
  });

  it("enumerateAvailableCohorts never lists a dimension that exists only in backtests", async () => {
    const { client, calls } = fakeEvaluationClient();
    await expect(createPrismaEvaluationRepository(client).enumerateAvailableCohorts(bounds)).resolves.toEqual([]);
    expect(calls.scoreFindMany).toHaveLength(1);
    const query = calls.scoreFindMany![0]!;
    expect(query.where).toEqual({
      supersededBy: null,
      kickoffUtc: { gte: new Date(bounds.from), lt: new Date(bounds.to) },
      forecastSnapshot: { origin: "PRODUCTION" },
    });
    expect(query.distinct).toEqual(["modelVersion", "leagueId", "market"]);
  });

  it("listValueCandidates for every model filters the receipt's forecast by origin only", async () => {
    const { client, calls } = fakeEvaluationClient();
    await createPrismaEvaluationRepository(client).listValueCandidates({ modelVersion: "all", competitionId: "all", market: "all", ...bounds }, null, 10);
    expect(calls.valueFindMany).toHaveLength(1);
    expect(calls.valueFindMany![0]!.where).toEqual({
      supersededBy: null,
      settlementReceipt: {
        settledAt: { gte: new Date(bounds.from), lt: new Date(bounds.to) },
        forecastSnapshot: { origin: "PRODUCTION" },
        fixture: {},
      },
    });
  });

  it("listValueCandidates for a concrete model adds the model next to the origin filter", async () => {
    const { client, calls } = fakeEvaluationClient();
    await createPrismaEvaluationRepository(client).listValueCandidates({ modelVersion: "poisson-ensemble-v1", competitionId: "league-1", market: "ONE_X_TWO", ...bounds }, null, 10);
    expect(calls.valueFindMany![0]!.where).toEqual({
      supersededBy: null,
      market: "ONE_X_TWO",
      settlementReceipt: {
        settledAt: { gte: new Date(bounds.from), lt: new Date(bounds.to) },
        forecastSnapshot: { origin: "PRODUCTION", modelVersion: "poisson-ensemble-v1" },
        fixture: { leagueId: "league-1" },
      },
    });
  });
});

describe("WR-13: a BACKTEST snapshot id is not retrievable through public endpoints", () => {
  it("comparison findExact looks the snapshot up with the origin filter and yields null for a BACKTEST id", async () => {
    const seen: Call[] = [];
    const client = { forecastSnapshot: { findFirst: async (args: Call) => { seen.push(args); return null; } } };
    const repository = createProductionRepository(client as never);
    await expect(repository.findExact("backtest-snapshot")).resolves.toBeNull();
    expect(seen).toHaveLength(1);
    expect(seen[0]!.where).toEqual({ id: "backtest-snapshot", origin: "PRODUCTION" });
    expect(seen[0]!.select).toEqual({ state: true, receipt: true });
  });

  it("value findForecast looks the snapshot up with the origin filter and yields null for a BACKTEST id", async () => {
    const seen: Call[] = [];
    const client = { forecastSnapshot: { findFirst: async (args: Call) => { seen.push(args); return null; } } };
    const repository = createPrismaValueRepository(client as never);
    await expect(repository.findForecast("backtest-snapshot")).resolves.toBeNull();
    expect(seen).toHaveLength(1);
    expect(seen[0]!.where).toEqual({ id: "backtest-snapshot", origin: "PRODUCTION" });
  });
});
