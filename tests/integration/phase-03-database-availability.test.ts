import { afterEach, describe, expect, it } from "vitest";

import { ForecastsService } from "../../apps/api/src/modules/forecasts/forecasts.service.js";
import { OddsService } from "../../apps/api/src/modules/odds/odds.service.js";
import { ValueService } from "../../apps/api/src/modules/value/value.service.js";

const originalDatabaseUrl = process.env.DATABASE_URL;

afterEach(() => {
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
});

describe("Phase 3 API database availability", () => {
  it("initializes without DATABASE_URL and fails closed only when database-backed methods are invoked", async () => {
    delete process.env.DATABASE_URL;

    const forecasts = new ForecastsService();
    const odds = new OddsService();
    const value = new ValueService();

    await expect(forecasts.get("fixture-1", "PRE_MATCH", "2026-09-06T12:00:00.000Z")).rejects.toMatchObject({
      code: "DATABASE_UNAVAILABLE",
    });
    await expect(odds.get("odds-1")).rejects.toMatchObject({ code: "DATABASE_UNAVAILABLE" });
    await expect(value.get("receipt-1")).rejects.toMatchObject({ code: "DATABASE_UNAVAILABLE" });

    await Promise.all([forecasts.onModuleDestroy(), odds.onModuleDestroy(), value.onModuleDestroy()]);
  });
});
