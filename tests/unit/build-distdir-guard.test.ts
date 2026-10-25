import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Importing build.mjs runs its top-level code but must not spawn turbo: the
// module guards main() behind a direct-execution check (asserted below).
import { resolveNextDistDir } from "../../scripts/build.mjs";

const wrapperPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../scripts/build.mjs");
// Normalize line endings: the Windows dev host checks files out as CRLF
// (core.autocrlf), CI checkouts are LF — the contract must hold for both.
const wrapperSource = readFileSync(wrapperPath, "utf8").replace(/\r\n/g, "\n");

describe("gate build dist-dir decision (resolveNextDistDir)", () => {
  it("passes a caller-set value through untouched, whether or not the dev lock exists", () => {
    expect(resolveNextDistDir({ envValue: ".next-e2e", devLockExists: true })).toBe(".next-e2e");
    expect(resolveNextDistDir({ envValue: ".next-e2e", devLockExists: false })).toBe(".next-e2e");
  });

  it("isolates onto .next-gate when the dev lock exists and no env override is set", () => {
    expect(resolveNextDistDir({ envValue: undefined, devLockExists: true })).toBe(".next-gate");
  });

  it("stays on the plain default when there is neither an env override nor a lock", () => {
    expect(resolveNextDistDir({ envValue: undefined, devLockExists: false })).toBeUndefined();
  });

  it("treats an empty env value as unset (never an empty distDir)", () => {
    expect(resolveNextDistDir({ envValue: "", devLockExists: true })).toBe(".next-gate");
    expect(resolveNextDistDir({ envValue: "", devLockExists: false })).toBeUndefined();
  });
});

describe("build wrapper structure", () => {
  it("guards main() behind a direct-execution check so importing never spawns turbo", () => {
    expect(wrapperSource).toContain("process.argv[1]");
    expect(wrapperSource).toContain("resolve(process.argv[1]) === fileURLToPath(import.meta.url)");
  });

  it("reads the dev lock from the repo root, not from the caller's cwd", () => {
    expect(wrapperSource).toContain('resolve(repoRoot, "apps/web/.next/dev/lock")');
    expect(wrapperSource).not.toMatch(/existsSync\(\s*["'`]apps\//);
  });

  it("spawns turbo through the proven pnpm exec pattern with inherited stdio and one notice line", () => {
    expect(wrapperSource).toContain('"exec", "turbo", "run", "build"');
    expect(wrapperSource).toContain('stdio: "inherit"');
    expect(wrapperSource).toContain("[build] dev lock detected -> NEXT_DIST_DIR=.next-gate");
  });
});
