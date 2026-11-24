import { readdirSync, readFileSync, statSync } from "node:fs";
import { posix, resolve, sep } from "node:path";

import ts from "typescript";
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

type NamedUse = readonly string[] | "ALL";
interface ModuleInfo {
  readonly imports: readonly { readonly specifier: string; readonly names: NamedUse }[];
  readonly localExports: ReadonlySet<string>;
  /** exported name -> { specifier, original name } for `export { a as b } from "x"`. */
  readonly reExports: ReadonlyMap<string, { readonly specifier: string; readonly original: string }>;
  readonly starExports: readonly string[];
}

function parseModule(path: string, source: string): ModuleInfo {
  const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const imports: { specifier: string; names: NamedUse }[] = [];
  const localExports = new Set<string>();
  const reExports = new Map<string, { specifier: string; original: string }>();
  const starExports: string[] = [];
  const hasModifier = (node: ts.Node, kind: ts.SyntaxKind): boolean => (ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined)?.some((modifier) => modifier.kind === kind) ?? false;

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const specifier = statement.moduleSpecifier.text;
      const clause = statement.importClause;
      if (!clause) { imports.push({ specifier, names: "ALL" }); continue; }
      const names: string[] = [];
      let all = false;
      if (clause.name) names.push("default");
      if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) all = true;
      if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) for (const element of clause.namedBindings.elements) names.push((element.propertyName ?? element.name).text);
      imports.push({ specifier, names: all ? "ALL" : names });
    } else if (ts.isExportDeclaration(statement)) {
      const specifier = statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier) ? statement.moduleSpecifier.text : null;
      if (specifier === null) {
        if (statement.exportClause && ts.isNamedExports(statement.exportClause)) for (const element of statement.exportClause.elements) localExports.add(element.name.text);
      } else if (!statement.exportClause) starExports.push(specifier);
      else if (ts.isNamespaceExport(statement.exportClause)) imports.push({ specifier, names: "ALL" });
      else for (const element of statement.exportClause.elements) reExports.set(element.name.text, { specifier, original: (element.propertyName ?? element.name).text });
    } else if (ts.isExportAssignment(statement)) {
      localExports.add("default");
    } else if (hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
      if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name)) localExports.add(declaration.name.text);
          else for (const element of declaration.name.elements) if (ts.isBindingElement(element) && ts.isIdentifier(element.name)) localExports.add(element.name.text);
        }
      } else if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name) localExports.add(statement.name.text);
      else if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isEnumDeclaration(statement)) localExports.add(statement.name.text);
      if (hasModifier(statement, ts.SyntaxKind.DefaultKeyword)) localExports.add("default");
    }
  }

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.arguments.length > 0 && ts.isStringLiteralLike(node.arguments[0]!)) {
      const callee = node.expression;
      if (callee.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(callee) && callee.text === "require")) imports.push({ specifier: (node.arguments[0] as ts.StringLiteralLike).text, names: "ALL" });
    }
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) imports.push({ specifier: node.argument.literal.text, names: "ALL" });
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return { imports, localExports, reExports, starExports };
}

function findViolations(files: Files, options: GraphOptions): Violation[] {
  const cache = new Map<string, ModuleInfo>();
  const info = (path: string): ModuleInfo => {
    let known = cache.get(path);
    if (!known) { known = parseModule(path, files.get(path) ?? ""); cache.set(path, known); }
    return known;
  };
  const resolveSpecifier = (from: string, specifier: string): string | null => {
    if (Object.hasOwn(options.aliases, specifier)) return options.aliases[specifier]!;
    if (!specifier.startsWith(".")) return null;
    const base = posix.normalize(posix.join(posix.dirname(from), specifier)).replace(/\.(?:js|jsx|mjs)$/, "");
    for (const candidate of [`${base}.ts`, `${base}.tsx`, `${base}.mts`, posix.join(base, "index.ts"), posix.join(base, "index.tsx")]) if (files.has(candidate)) return candidate;
    return null;
  };

  const reached = new Map<string, readonly string[]>();
  const queue: string[] = [];
  const reach = (file: string, chain: readonly string[]): void => {
    if (reached.has(file)) return;
    reached.set(file, [...chain, file]);
    queue.push(file);
  };
  /** The module that defines `name` as seen from `file` (following re-exports), or null when it is not found. */
  const definition = (file: string, name: string, visiting: Set<string>): string | null => {
    const key = `${file}\u0000${name}`;
    if (visiting.has(key) || !files.has(file)) return null;
    visiting.add(key);
    const module = info(file);
    if (module.localExports.has(name)) return file;
    const re = module.reExports.get(name);
    if (re) {
      const target = resolveSpecifier(file, re.specifier);
      return target ? definition(target, re.original, visiting) : null;
    }
    for (const star of module.starExports) {
      const target = resolveSpecifier(file, star);
      const found = target ? definition(target, name, visiting) : null;
      if (found) return found;
    }
    return null;
  };
  const request = (file: string, names: NamedUse, chain: readonly string[], seenAll: Set<string>): void => {
    if (!files.has(file)) return;
    if (names === "ALL") {
      if (seenAll.has(file)) return;
      seenAll.add(file);
      reach(file, chain);
      const module = info(file);
      for (const { specifier } of module.reExports.values()) { const target = resolveSpecifier(file, specifier); if (target) request(target, "ALL", [...chain, file], seenAll); }
      for (const specifier of module.starExports) { const target = resolveSpecifier(file, specifier); if (target) request(target, "ALL", [...chain, file], seenAll); }
      return;
    }
    // An imported name that no module defines (for example a type erased elsewhere) conservatively counts as the module itself.
    for (const name of names) reach(definition(file, name, new Set()) ?? file, chain);
  };

  const seenAll = new Set<string>();
  for (const root of options.roots) reach(root, []);
  for (let index = 0; index < queue.length; index += 1) {
    const file = queue[index]!;
    const chain = reached.get(file)!.slice(0, -1);
    for (const { specifier, names } of info(file).imports) {
      const target = resolveSpecifier(file, specifier);
      if (target) request(target, names, [...chain, file], seenAll);
    }
  }
  return [...reached.entries()].filter(([file]) => options.isForbidden(file)).map(([forbidden, chain]) => ({ forbidden, chain })).sort((a, b) => a.forbidden.localeCompare(b.forbidden));
}

/** Roots must not touch the closing-observation table through Prisma or SQL either (the repository is not the only door). */
function findObservationTableAccess(files: Files, roots: readonly string[]): string[] {
  return roots.filter((root) => /closingOddsObservation/i.test(files.get(root) ?? "")).sort();
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
      "packages/domain/src/evaluation/closing-odds.ts",
      "packages/domain/src/evaluation/clv.ts",
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
