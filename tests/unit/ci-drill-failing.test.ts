import { describe, expect, it } from "vitest";

describe("ci drill", () => {
  it("deliberately fails", () => {
    expect(1).toBe(2);
  });
});