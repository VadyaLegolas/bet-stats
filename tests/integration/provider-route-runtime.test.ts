import { describe, expect, it, vi } from "vitest";
import { executeProviderRoute } from "../../workers/data-sync/src/ingestion/provider-route-runtime.js";

describe("durable provider route runtime", () => {
  it("records primary failure then provider-matching fallback observation and success", async () => {
    const events: string[] = [];
    const result = await executeProviderRoute({
      routeId: "route-1", attemptKey: "job-1", candidates: [{ provider: "primary", factory: () => "p" }, { provider: "fallback", factory: () => "f" }],
      appendRoute: async () => { events.push("route"); },
      admitAttempt: async (x) => { events.push(`admit:${x.provider}`); return { admitted: true, reused: false, terminal: null }; },
      completeAttempt: async (x) => { events.push(`${x.state}:${x.provider}`); },
      call: async (client) => { if (client === "p") throw Object.assign(new Error(), { code: "UPSTREAM_5XX" }); return { fixtures: [1] }; },
      classifyFailure: () => ({ eligible: true, trigger: "UPSTREAM_5XX" }),
      persistObservation: async (x) => { events.push(`observation:${x.provider}`); return { id: "observation-fallback", observedAt: "2026-09-13T10:00:00.000Z" }; },
      findLastValid: async () => null,
    });
    expect(result).toMatchObject({ status: "completed", provider: "fallback", observationId: "observation-fallback" });
    expect(events).toEqual(["route", "admit:primary", "FAILED:primary", "admit:fallback", "observation:fallback", "SUCCEEDED:fallback"]);
  });
  it("returns timestamped last-valid facts for sole-source exhaustion", async () => {
    const result = await executeProviderRoute({ routeId: "route-2", attemptKey: "job-2", candidates: [{ provider: "sole", factory: () => "s" }], appendRoute: async () => {}, admitAttempt: async () => ({ admitted: true, reused: false, terminal: null }), completeAttempt: async () => {}, call: async () => { throw Object.assign(new Error(), { code: "UPSTREAM_5XX" }); }, classifyFailure: () => ({ eligible: true, trigger: "UPSTREAM_5XX" }), persistObservation: async () => { throw new Error("not called"); }, findLastValid: async () => ({ at: "2026-09-12T10:00:00.000Z", value: { fixtures: [0] } }) });
    expect(result).toEqual({ status: "limited", reason: "NO_FALLBACK", lastValidAt: "2026-09-12T10:00:00.000Z", lastValidValue: { fixtures: [0] } });
  });
  it("converges terminal replay without constructing or calling the provider", async () => {
    const factory = vi.fn(() => "client"), call = vi.fn();
    const result = await executeProviderRoute({ routeId: "route-3", attemptKey: "job-3", candidates: [{ provider: "primary", factory }], appendRoute: async () => {}, admitAttempt: async () => ({ admitted: true, reused: true, terminal: { state: "SUCCEEDED", observationId: "obs", provider: "primary" } }), completeAttempt: async () => {}, call, classifyFailure: () => ({ eligible: false }), persistObservation: async () => ({ id: "never", observedAt: "" }), loadObservation: async () => ({ fixtures: [1] }), findLastValid: async () => null });
    expect(result).toEqual({ status: "replayed", provider: "primary", observationId: "obs", value: { fixtures: [1] } }); expect(factory).not.toHaveBeenCalled(); expect(call).not.toHaveBeenCalled();
  });
});
