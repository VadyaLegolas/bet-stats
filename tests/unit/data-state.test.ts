import { describe, expect, it, vi } from "vitest";

import {
  DATA_STATES,
  classifyFreshness,
  projectDataState,
} from "../../packages/domain/src/data-state.js";
import {
  DEFAULT_FRESHNESS_THRESHOLDS_MS,
  FreshnessConfigValidationError,
  readFreshnessThresholds,
} from "../../packages/config/src/freshness.js";

describe("data-state projection", () => {
  it("publishes exactly the five D-13 states", () => {
    expect(DATA_STATES).toEqual([
      "AVAILABLE",
      "LIMITED",
      "STALE",
      "UNSUPPORTED",
      "UNRESOLVED",
    ]);
  });

  it.each(DATA_STATES)("projects %s with provenance and the applied threshold", (state) => {
    const projection = projectDataState({
      state,
      reason: `${state}_REASON`,
      provider: "football-data.org",
      capturedAt: "2026-08-28T10:00:00.000Z",
      sourceUpdatedAt: "2026-08-28T09:55:00.000Z",
      freshnessThresholdMs: 900_000,
      value: 12,
    });

    expect(projection).toMatchObject({
      state,
      reason: `${state}_REASON`,
      provider: "football-data.org",
      capturedAt: "2026-08-28T10:00:00.000Z",
      sourceUpdatedAt: "2026-08-28T09:55:00.000Z",
      freshnessThresholdMs: 900_000,
      value: 12,
    });
  });

  it("preserves unknown source timestamps and values as null", () => {
    const projection = projectDataState({
      state: "LIMITED",
      reason: "SOURCE_FIELD_MISSING",
      provider: "football-data.org",
      capturedAt: "2026-08-28T10:00:00.000Z",
      sourceUpdatedAt: null,
      freshnessThresholdMs: 900_000,
      value: null,
    });

    expect(projection.sourceUpdatedAt).toBeNull();
    expect(projection.value).toBeNull();
  });

  it("fails closed for an unknown state and emits telemetry without raw input", () => {
    const telemetry = vi.fn();
    const projection = projectDataState(
      {
        state: "PROVIDER_SECRET_STATE",
        reason: "provider details must not escape",
        provider: "football-data.org",
        capturedAt: "2026-08-28T10:00:00.000Z",
        sourceUpdatedAt: null,
        freshnessThresholdMs: 900_000,
        value: null,
      },
      telemetry,
    );

    expect(projection).toMatchObject({
      state: "LIMITED",
      reason: "UNKNOWN_DATA_STATE",
      value: null,
    });
    expect(telemetry).toHaveBeenCalledWith({
      event: "unknown_data_state",
      receivedType: "string",
    });
    expect(JSON.stringify(telemetry.mock.calls)).not.toContain("PROVIDER_SECRET_STATE");
  });
});

describe("freshness configuration", () => {
  it("ships validated defaults for each supported data type", () => {
    expect(readFreshnessThresholds()).toEqual(DEFAULT_FRESHNESS_THRESHOLDS_MS);
    expect(Object.keys(DEFAULT_FRESHNESS_THRESHOLDS_MS)).toEqual([
      "fixture",
      "fixtureStatus",
      "result",
      "lineup",
    ]);
  });

  it.each([0, -1, 1.5, Number.NaN])("rejects an invalid threshold: %s", (threshold) => {
    expect(() => readFreshnessThresholds({ fixture: threshold })).toThrow(
      FreshnessConfigValidationError,
    );
  });

  it("changes classification deterministically when validated config changes", () => {
    const input = {
      state: "AVAILABLE" as const,
      reason: "SOURCE_COMPLETE",
      provider: "football-data.org",
      capturedAt: "2026-08-28T10:00:00.000Z",
      sourceUpdatedAt: "2026-08-28T09:40:00.000Z",
      value: { status: "SCHEDULED" },
    };
    const now = new Date("2026-08-28T10:00:00.000Z");
    const defaults = readFreshnessThresholds();
    const strict = readFreshnessThresholds({ fixture: 10 * 60 * 1_000 });

    expect(classifyFreshness(input, defaults.fixture, now).state).toBe("AVAILABLE");
    expect(classifyFreshness(input, strict.fixture, now)).toMatchObject({
      state: "STALE",
      reason: "FRESHNESS_THRESHOLD_EXCEEDED",
      freshnessThresholdMs: 600_000,
    });
  });

  it("keeps unsupported and unresolved states independent of freshness", () => {
    const common = {
      reason: "NOT_ELIGIBLE_FOR_FRESHNESS",
      provider: "football-data.org",
      capturedAt: "2026-08-28T10:00:00.000Z",
      sourceUpdatedAt: "2020-01-01T00:00:00.000Z",
      value: null,
    };

    expect(classifyFreshness({ ...common, state: "UNSUPPORTED" }, 1, new Date()).state).toBe(
      "UNSUPPORTED",
    );
    expect(classifyFreshness({ ...common, state: "UNRESOLVED" }, 1, new Date()).state).toBe(
      "UNRESOLVED",
    );
  });
});
