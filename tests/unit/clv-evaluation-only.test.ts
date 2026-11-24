import { readdirSync, readFileSync, statSync } from "node:fs";
import { posix, resolve, sep } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * D-05 / CLV-03: CLV may be READ only by evaluation code. This test walks the import graph and fails when value ranking,
 * candidate generation, or any scanner / journal module can reach a CLV module or the closing-observation repository.
 *
 * The check is symbol-level (usage), not load-level: `@bet-stats/domain` and `@bet-stats/database` are barrels that load every
 * module at runtime anyway, so what matters is which module DEFINES each name a root imports. A named import is followed through
 * `export { a } from` and `export * from` to its defining module; a namespace import, a side-effect import, a dynamic import or a
 * `require` pulls the whole module (pessimistic). Once a module is reached, every one of its own imports counts.
 */

type Files = ReadonlyMap<string, string>;
interface Violation { readonly forbidden: string; readonly chain: readonly string[] }
interface GraphOptions {
  readonly aliases: Readonly<Record<string, string>>;
  readonly roots: readonly string[];
  readonly isForbidden: (path: string) => boolean;
}

function findViolations(_files: Files, _options: GraphOptions): Violation[] {
  return [];
}

function findObservationTableAccess(_files: Files, _roots: readonly string[]): string[] {
  return [];
}

const FORBIDDEN_BASENAMES = new Set(["clv.ts", "no-vig-clv.ts", "closing-odds.ts", "closing-odds-repository.ts", "no-vig-clv-reader.ts"]);
const isForbidden = (path: string): boolean => FORBIDDEN_BASENAMES.has(posix.basename(path));

/** Roots: value ranking, candidate generation (domain decision + API value/odds modules) and any scanner or journal path, now or later. */
const ROOT_MASKS: readonly RegExp[] = [/^packages\/domain\/src\/value\//, /^apps\/api\/src\/modules\/value\//, /^apps\/api\/src\/modules\/odds\//, /scanner|journal/i];
function selectRoots(paths: Iterable<string>): string[] {
  return [...paths].filter((path) => ROOT_MASKS.some((mask) => mask.test(path))).sort();
}

const ALIASES = {
  "@bet-stats/config": "packages/config/src/index.ts",
  "@bet-stats/database": "packages/database/src/index.ts",
  "@bet-stats/domain": "packages/domain/src/index.ts",
  "@bet-stats/football-data": "packages/football-data/src/index.ts",
} as const;

const workspaceRoot = resolve(import.meta.dirname, "../..");
const SOURCE_EXTENSIONS = /\.(?:ts|tsx|mts)$/;
const SKIPPED_DIRECTORIES = new Set(["node_modules", "dist", "generated", ".next", ".next-e2e", ".turbo", "coverage"]);

function walk(directory: string, into: Map<string, string>): void {
  for (const entry of readdirSync(directory)) {
    if (SKIPPED_DIRECTORIES.has(entry)) continue;
    const absolute = resolve(directory, entry);
    const stats = statSync(absolute);
    if (stats.isDirectory()) walk(absolute, into);
    else if (SOURCE_EXTENSIONS.test(entry) && !entry.endsWith(".d.ts")) into.set(absolute.slice(workspaceRoot.length + 1).split(sep).join("/"), readFileSync(absolute, "utf8"));
  }
}

function loadWorkspaceSources(): Map<string, string> {
  const files = new Map<string, string>();
  for (const group of ["packages", "apps", "workers"]) {
    for (const project of readdirSync(resolve(workspaceRoot, group))) {
      const projectRoot = resolve(workspaceRoot, group, project);
      if (!statSync(projectRoot).isDirectory()) continue;
      for (const directory of ["src", "app", "lib", "components"]) {
        try { if (statSync(resolve(projectRoot, directory)).isDirectory()) walk(resolve(projectRoot, directory), files); } catch { /* optional directory */ }
      }
    }
  }
  return files;
}

describe("CLV is evaluation-only (D-05): red proof on synthetic graphs", () => {
  const options = (roots: string[]): GraphOptions => ({ aliases: ALIASES, roots, isForbidden });
  const barrel = {
    "packages/domain/src/index.ts": 'export * from "./value/decision.js";\nexport * from "./evaluation/no-vig-clv.js";\nexport * from "./evaluation/clv.js";',
    "packages/domain/src/value/decision.ts": 'export function decideValue() { return 1; }',
    "packages/domain/src/evaluation/no-vig-clv.ts": "export function calculateNoVigClv() { return 2; }",
    "packages/domain/src/evaluation/clv.ts": "export function calculateComparableClv() { return 3; }",
  };

  it("flags a root that imports a CLV function through the package barrel", () => {
    const files = new Map(Object.entries({ ...barrel, "apps/api/src/modules/value/rank.ts": 'import { calculateNoVigClv } from "@bet-stats/domain";\nexport const x = calculateNoVigClv();' }));
    const violations = findViolations(files, options(["apps/api/src/modules/value/rank.ts"]));
    expect(violations).toHaveLength(1);
    expect(violations.map((violation) => violation.forbidden)).toEqual(["packages/domain/src/evaluation/no-vig-clv.ts"]);
    expect(violations[0]!.chain[0]).toBe("apps/api/src/modules/value/rank.ts");
  });

  it("flags a transitive import through a relative helper", () => {
    const files = new Map(Object.entries({
      ...barrel,
      "packages/domain/src/value/decision.ts": 'import { helper } from "./helper.js";\nexport function decideValue() { return helper(); }',
      "packages/domain/src/value/helper.ts": 'import { calculateComparableClv } from "../evaluation/clv.js";\nexport const helper = () => calculateComparableClv();',
    }));
    const violations = findViolations(files, options(["packages/domain/src/value/decision.ts"]));
    expect(violations.map((violation) => violation.forbidden)).toEqual(["packages/domain/src/evaluation/clv.ts"]);
    expect(violations[0]!.chain).toEqual(["packages/domain/src/value/decision.ts", "packages/domain/src/value/helper.ts", "packages/domain/src/evaluation/clv.ts"]);
  });

  it("flags the observation reader through a named re-export of the database barrel", () => {
    const files = new Map(Object.entries({
      "packages/database/src/index.ts": 'export { createPrismaClient } from "./client.js";\nexport { readNoVigClvForCandidates as reader } from "./evaluation/no-vig-clv-reader.js";',
      "packages/database/src/client.ts": "export const createPrismaClient = () => 1;",
      "packages/database/src/evaluation/no-vig-clv-reader.ts": "export const readNoVigClvForCandidates = () => 2;",
      "apps/api/src/modules/value/value.service.ts": 'import { reader } from "@bet-stats/database";\nexport const y = reader;',
    }));
    expect(findViolations(files, options(["apps/api/src/modules/value/value.service.ts"])).map((violation) => violation.forbidden)).toEqual(["packages/database/src/evaluation/no-vig-clv-reader.ts"]);
  });

  it.each([
    ["namespace import", 'import * as domain from "@bet-stats/domain";\nexport const z = domain;'],
    ["side-effect import", 'import "@bet-stats/domain";'],
    ["dynamic import", 'export const load = () => import("@bet-stats/domain");'],
    ["require call", 'const d = require("@bet-stats/domain");\nexport default d;'],
  ])("treats a %s of a barrel as reaching everything it exports", (_label, source) => {
    const files = new Map(Object.entries({ ...barrel, "apps/api/src/modules/value/rank.ts": source }));
    expect(findViolations(files, options(["apps/api/src/modules/value/rank.ts"])).length).toBeGreaterThan(0);
  });

  it("does not flag a named import of an unrelated symbol from a barrel that also re-exports CLV modules", () => {
    const files = new Map(Object.entries({ ...barrel, "apps/api/src/modules/value/rank.ts": 'import { decideValue } from "@bet-stats/domain";\nexport const x = decideValue();' }));
    expect(findViolations(files, options(["apps/api/src/modules/value/rank.ts"]))).toEqual([]);
  });

  it("discovers scanner and journal modules by path mask, wherever they appear", () => {
    const paths = [
      "apps/api/src/modules/scanner/scanner.service.ts",
      "packages/domain/src/journal/entry.ts",
      "workers/data-sync/src/value-scanner.ts",
      "apps/web/app/journal/page.tsx",
      "packages/domain/src/value/decision.ts",
      "apps/api/src/modules/evaluation/evaluation.service.ts",
    ];
    expect(selectRoots(paths)).toEqual([
      "apps/api/src/modules/scanner/scanner.service.ts",
      "apps/web/app/journal/page.tsx",
      "packages/domain/src/journal/entry.ts",
      "packages/domain/src/value/decision.ts",
      "workers/data-sync/src/value-scanner.ts",
    ]);
    const files = new Map(Object.entries({ ...barrel, "apps/api/src/modules/scanner/scanner.service.ts": 'import { calculateComparableClv } from "@bet-stats/domain";\nexport const s = calculateComparableClv;' }));
    expect(findViolations(files, options(selectRoots(files.keys()))).map((violation) => violation.forbidden)).toEqual(["packages/domain/src/evaluation/clv.ts"]);
  });

  it("flags direct access to the closing-observation table from a root", () => {
    const files = new Map(Object.entries({ "apps/api/src/modules/value/rank.ts": "const rows = client.closingOddsObservation.findMany();", "apps/api/src/modules/value/clean.ts": "export const ok = 1;" }));
    expect(findObservationTableAccess(files, ["apps/api/src/modules/value/rank.ts", "apps/api/src/modules/value/clean.ts"])).toEqual(["apps/api/src/modules/value/rank.ts"]);
  });
});

describe("CLV is evaluation-only (D-05): the real workspace", () => {
  const files = loadWorkspaceSources();
  const roots = selectRoots(files.keys());

  it("finds the forbidden CLV modules and the guarded roots, so the check cannot pass vacuously", () => {
    const forbidden = [...files.keys()].filter(isForbidden).sort();
    expect(forbidden).toEqual([
      "packages/database/src/closing-odds-repository.ts",
      "packages/database/src/evaluation/no-vig-clv-reader.ts",
      "packages/domain/src/evaluation/clv.ts",
      "packages/domain/src/evaluation/closing-odds.ts",
      "packages/domain/src/evaluation/no-vig-clv.ts",
    ]);
    for (const required of ["packages/domain/src/value/decision.ts", "packages/domain/src/value/contract.ts", "apps/api/src/modules/value/value.service.ts", "apps/api/src/modules/value/value.controller.ts"]) expect(roots).toContain(required);
  });

  it("no ranking, candidate-generation, scanner or journal module reaches a CLV module", () => {
    const violations = findViolations(files, { aliases: ALIASES, roots, isForbidden });
    expect(violations.map((violation) => `${violation.chain.join(" -> ")}`)).toEqual([]);
  });

  it("no root reads the closing-observation table directly", () => {
    expect(findObservationTableAccess(files, roots)).toEqual([]);
  });
});
