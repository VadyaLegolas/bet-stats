import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "../../apps/web/node_modules/next/server.js";

import { GET as getForecast, POST as postForecast } from "../../apps/web/app/internal-api/fixtures/[fixtureId]/forecasts/route.js";
import { GET as getOdds, POST as postOdds } from "../../apps/web/app/internal-api/fixtures/[fixtureId]/odds/route.js";
import { POST as postValue } from "../../apps/web/app/internal-api/fixtures/[fixtureId]/value/route.js";
import { GET as getReceipt } from "../../apps/web/app/internal-api/value/[receiptId]/route.js";

const fixtureContext = { params: Promise.resolve({ fixtureId: "fixture/1" }) };
const receiptContext = { params: Promise.resolve({ receiptId: "receipt-1" }) };

describe("protected analytics internal routes", () => {
  beforeEach(() => {
    vi.stubEnv("API_ORIGIN", "http://api.test");
    vi.stubEnv("ELIGIBILITY_REGION", "PL");
    vi.stubEnv("ELIGIBILITY_AGE_ACKNOWLEDGED", "true");
    vi.stubEnv("ELIGIBILITY_CHECKED_AT", "2026-09-06T03:00:00.000Z");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("forwards only allowlisted forecast query and body fields with server eligibility", async () => {
    const fetchStub = vi.fn().mockImplementation(async () => new Response('{"id":"forecast-1"}', {
      status: 201,
      headers: { "content-type": "application/json", "x-eligibility-region": "must-not-leak" },
    }));
    vi.stubGlobal("fetch", fetchStub);

    const getResponse = await getForecast(
      new NextRequest("http://web.test/internal-api/fixtures/x/forecasts?kind=PRE_MATCH&cutoff=2026-09-06T02%3A00%3A00.000Z&secret=drop"),
      fixtureContext,
    );
    expect(fetchStub.mock.calls[0]?.[0].toString()).toBe("http://api.test/fixtures/fixture%2F1/forecasts?kind=PRE_MATCH&cutoff=2026-09-06T02%3A00%3A00.000Z");
    expect(fetchStub.mock.calls[0]?.[1]).toMatchObject({
      method: "GET",
      cache: "no-store",
      headers: {
        accept: "application/json",
        "x-eligibility-region": "PL",
        "x-age-acknowledged": "true",
        "x-eligibility-checked-at": "2026-09-06T03:00:00.000Z",
      },
    });
    expect(getResponse.status).toBe(201);
    expect(await getResponse.text()).toBe('{"id":"forecast-1"}');
    expect(getResponse.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(getResponse.headers.get("x-eligibility-region")).toBeNull();

    await postForecast(new NextRequest("http://web.test/internal-api/fixtures/x/forecasts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "INITIAL", cutoff: "2026-09-06T01:00:00.000Z", fixtureId: "spoof", extra: "drop" }),
    }), fixtureContext);
    expect(JSON.parse(String(fetchStub.mock.calls[1]?.[1]?.body))).toEqual({ kind: "INITIAL", cutoff: "2026-09-06T01:00:00.000Z" });
  });

  it("forwards an empty forecast query as fixture-scoped issued discovery", async () => {
    const fetchStub = vi.fn().mockResolvedValue(new Response("[]", { headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchStub);

    const response = await getForecast(
      new NextRequest("http://web.test/internal-api/fixtures/x/forecasts?secret=drop"),
      fixtureContext,
    );

    expect(fetchStub.mock.calls[0]?.[0].toString()).toBe("http://api.test/fixtures/fixture%2F1/forecasts");
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(await response.json()).toEqual([]);
  });

  it("allowlists odds and value bodies while preserving upstream errors exactly", async () => {
    const fetchStub = vi.fn()
      .mockResolvedValueOnce(new Response('{"code":"INVALID_DECIMAL_ODDS"}', { status: 400, headers: { "content-type": "application/problem+json" } }))
      .mockResolvedValueOnce(new Response('{"outcome":"NO_VALUE"}', { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchStub);
    const selections = [{ selection: "YES", decimalOdds: "1.9" }, { selection: "NO", decimalOdds: "1.9" }];

    const oddsResponse = await postOdds(new NextRequest("http://web.test/internal-api/fixtures/x/odds", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ market: "BTTS", sourceLabel: "Manual", capturedAt: "2026-09-06T02:00:00.000Z", selections, oddsSnapshotId: "odds-1", derived: 42 }),
    }), fixtureContext);
    expect(oddsResponse.status).toBe(400);
    expect(oddsResponse.headers.get("content-type")).toBe("application/problem+json");
    expect(await oddsResponse.text()).toBe('{"code":"INVALID_DECIMAL_ODDS"}');
    expect(JSON.parse(String(fetchStub.mock.calls[0]?.[1]?.body))).toEqual({ market: "BTTS", sourceLabel: "Manual", capturedAt: "2026-09-06T02:00:00.000Z", selections, oddsSnapshotId: "odds-1" });

    await postValue(new NextRequest("http://web.test/internal-api/fixtures/x/value", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ forecastSnapshotId: "forecast-1", oddsSnapshotId: "odds-1", market: "BTTS", selection: "YES", fixtureId: "spoof", expectedValue: "999" }),
    }), fixtureContext);
    expect(fetchStub.mock.calls[1]?.[0].toString()).toBe("http://api.test/value-receipts");
    expect(JSON.parse(String(fetchStub.mock.calls[1]?.[1]?.body))).toEqual({ fixtureId: "fixture/1", forecastSnapshotId: "forecast-1", oddsSnapshotId: "odds-1", market: "BTTS", selection: "YES" });
  });

  it("reads exact odds snapshots and restricts receipt download headers", async () => {
    const fetchStub = vi.fn()
      .mockResolvedValueOnce(new Response('{"id":"odds-1"}', { headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response('{"id":"receipt-1"}', {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "content-disposition": 'attachment; filename="value-receipt-receipt-1.json"',
          "set-cookie": "credential=leak",
        },
      }));
    vi.stubGlobal("fetch", fetchStub);

    await getOdds(new NextRequest("http://web.test/internal-api/fixtures/x/odds?oddsSnapshotId=odds%2F1&extra=drop"), fixtureContext);
    expect(fetchStub.mock.calls[0]?.[0].toString()).toBe("http://api.test/fixtures/fixture%2F1/odds/odds%2F1");

    const download = await getReceipt(new NextRequest("http://web.test/internal-api/value/receipt-1?download=true&filename=evil.json"), receiptContext);
    expect(fetchStub.mock.calls[1]?.[0].toString()).toBe("http://api.test/value-receipts/receipt-1/download");
    expect(download.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(download.headers.get("content-disposition")).toBe('attachment; filename="value-receipt-receipt-1.json"');
    expect(download.headers.get("set-cookie")).toBeNull();
    expect(download.headers.get("cache-control")).toBe("private, no-store, max-age=0");
  });
});
