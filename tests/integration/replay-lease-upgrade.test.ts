import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("populated replay lease upgrade", () => {
  it("backfills only RUNNING runs as expired and preserves terminal rows", () => {
    const migration = readFileSync(resolve(import.meta.dirname, "../../packages/database/prisma/migrations/20260904_phase02_sync_run_execution_lease/migration.sql"), "utf8");
    expect(migration).toContain("WHERE state = 'RUNNING'");
    expect(migration).toContain("clock_timestamp() - interval '1 second'");
    expect(migration).toContain("terminal SyncRun is immutable");
  });
});
