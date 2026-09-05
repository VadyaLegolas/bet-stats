import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("replay execution process crash recovery", () => {
  it("uses the production worker in a separately killable child process", () => {
    const source = readFileSync(resolve(import.meta.dirname, "../../workers/data-sync/src/replay-crash-harness.ts"), "utf8");
    expect(source).toContain("createReplayWorker");
    expect(source).toContain("process.send");
    expect(source).toContain("claimed-before-provider");
  });
});
