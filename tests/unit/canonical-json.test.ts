import { describe, expect, it } from "vitest";

import { canonicalJson, canonicalSha256 } from "../../packages/domain/src/forecast/canonical-json.js";
import { forecastConfigHashFor } from "../../packages/domain/src/forecast/config.js";

describe("canonicalJson (review IN-01)", () => {
  it("orders keys by UTF-16 code unit, independent of locale collation", () => {
    // localeCompare would put "a" before "B" and "_" before "-"; code-unit order is fixed.
    expect(canonicalJson({ a: 1, B: 2, _x: 3, "-y": 4 })).toBe('{"-y":4,"B":2,"_x":3,"a":1}');
  });

  it("is order-independent for objects and keeps array order", () => {
    expect(canonicalJson({ b: [2, 1], a: { d: 1, c: 2 } })).toBe(canonicalJson({ a: { c: 2, d: 1 }, b: [2, 1] }));
    expect(canonicalJson([2, 1])).not.toBe(canonicalJson([1, 2]));
  });

  it("hashes with a stable sha256 prefix", () => {
    expect(canonicalSha256({ a: 1 })).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(canonicalSha256({ a: 1, b: 2 })).toBe(canonicalSha256({ b: 2, a: 1 }));
  });

  it("keeps the published model config hashes distinct and stable across runs", () => {
    expect(forecastConfigHashFor("poisson-ensemble-v1")).toBe(forecastConfigHashFor("poisson-ensemble-v1"));
    expect(forecastConfigHashFor("poisson-ensemble-v1")).not.toBe(forecastConfigHashFor("dixon-coles-ensemble-v1"));
  });
});
