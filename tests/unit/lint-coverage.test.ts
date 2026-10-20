import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const workspaceYaml = readFileSync(join(repoRoot, "pnpm-workspace.yaml"), "utf8");

// Workspace globs as declared in pnpm-workspace.yaml (apps/*, packages/*, workers/*).
const workspaceGlobs = workspaceYaml
  .split("\n")
  .filter((line) => line.trim().startsWith("- "))
  .map((line) => line.trim().slice(2).trim())
  .filter((glob) => glob.endsWith("/*"))
  .map((glob) => glob.slice(0, -2));

// The fixed set of workspace packages that must be covered by the lint gate.
// A new package added to the workspace must be added here AND given a lint
// script + eslint.config.mjs — this test is the CI-03 adjacency backstop.
const expectedPackages = [
  "apps/api",
  "apps/web",
  "packages/config",
  "packages/database",
  "packages/domain",
  "packages/football-data",
  "workers/data-sync",
] as const;

function enumerateWorkspacePackages(): string[] {
  const found: string[] = [];
  for (const dir of workspaceGlobs) {
    const full = join(repoRoot, dir);
    if (!existsSync(full)) continue;
    for (const entry of readdirSync(full, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const pkgJson = join(full, entry.name, "package.json");
      if (existsSync(pkgJson)) found.push(`${dir}/${entry.name}`);
    }
  }
  return found.sort();
}

describe("lint coverage contract (CI-03)", () => {
  it("covers every workspace package in the fixed set", () => {
    expect(enumerateWorkspacePackages()).toEqual([...expectedPackages].sort());
  });

  it("every workspace package declares scripts.lint === 'eslint .'", () => {
    for (const pkg of enumerateWorkspacePackages()) {
      const pkgJsonPath = join(repoRoot, pkg, "package.json");
      const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf8")) as { scripts?: Record<string, string> };
      expect(pkgJson.scripts?.lint, `Missing scripts.lint in ${pkg}/package.json`).toBe("eslint .");
    }
  });

  it("every workspace package has an eslint.config.mjs", () => {
    for (const pkg of enumerateWorkspacePackages()) {
      const configPath = join(repoRoot, pkg, "eslint.config.mjs");
      expect(existsSync(configPath), `Missing eslint.config.mjs in ${pkg}`).toBe(true);
    }
  });
});
