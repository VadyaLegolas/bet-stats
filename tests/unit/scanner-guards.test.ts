import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Static guards for the 7-day value scanner (Phase 15): the page stays a server-rendered, read-only, unranked list
 * that shows stored values verbatim (D-04, D-09, D-11). Every message names the file and the rule that was broken.
 */

const SCANNER_DIR = "apps/web/app/scanner";
const SERVICE = "apps/api/src/modules/value/scanner.service.ts";
const DOMAIN_SCANNER = "packages/domain/src/value/scanner.ts";
const ALPHABETICAL_CODES_FILE = `${SCANNER_DIR}/scanner-labels.ts`;

const read = (path: string) => readFileSync(resolve(path), "utf8");

/** Comments are removed so that explanatory prose never trips or hides a guard. Line comments need a leading boundary so "http://" survives. */
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");

const isSource = (file: string) => (file.endsWith(".ts") || file.endsWith(".tsx")) && !file.endsWith(".d.ts") && !/\.test\.tsx?$/.test(file);

function walk(directory: string): readonly string[] {
  return readdirSync(resolve(directory), { recursive: true })
    .map(String)
    .filter(isSource)
    .map((file) => `${directory}/${file.replaceAll("\\", "/")}`);
}

const scannerFiles = walk(SCANNER_DIR);
const scannerTsx = scannerFiles.filter((file) => file.endsWith(".tsx"));

const hasClientDirective = (source: string) => /^\s*(?:(?:\/\*[\s\S]*?\*\/|\/\/[^\n]*)\s*)*["']use client["']/.test(source);

describe("scanner static guards", () => {
  it("covers the real scanner files", () => {
    for (const name of ["page.tsx", "scanner-data.ts", "scanner-labels.ts", "scanner-rows.tsx", "scanner-types.ts", "scanner-view.tsx"]) {
      expect(scannerFiles, `${SCANNER_DIR}: expected file ${name}`).toContain(`${SCANNER_DIR}/${name}`);
    }
  });

  it("(1) no scanner file carries a client directive", () => {
    for (const file of scannerFiles) {
      expect(hasClientDirective(read(file)), `${file}: the scanner page ships no client JavaScript (no "use client")`).toBe(false);
    }
  });

  it("(2) scanner files import nothing at runtime from the domain barrel", () => {
    for (const file of scannerFiles) {
      const source = stripComments(read(file));
      const statements = [
        ...source.matchAll(/(?:import|export)\s+(type\s+)?[^;]*?from\s*["'](@bet-stats\/domain[^"']*)["']/g),
        ...source.matchAll(/import\s*()["'](@bet-stats\/domain[^"']*)["']/g),
      ];
      for (const [statement, typeOnly] of statements) {
        expect(typeOnly, `${file}: only "import type" may reference @bet-stats/domain (found: ${statement.trim().slice(0, 80)})`).toBeTruthy();
      }
      expect(source, `${file}: no dynamic or CommonJS load of @bet-stats/domain`).not.toMatch(/(?:import\(|require\()\s*["']@bet-stats\/domain/);
    }
  });

  it("(3) no client component imports a scanner module", () => {
    const files = [...walk("apps/web/app"), ...walk("apps/web/components")];
    const clientFiles = files.filter((file) => hasClientDirective(read(file)));
    expect(clientFiles.length, "walk found no client component at all (the walker is broken)").toBeGreaterThan(0);
    for (const file of clientFiles) {
      const specifiers = [...read(file).matchAll(/(?:from\s*|import\s*\(\s*|import\s+)["']([^"']+)["']/g)].map((match) => match[1]!);
      const offending = specifiers.filter((specifier) => /scanner/i.test(specifier));
      expect(offending, `${file}: client components must not import scanner modules (bundle budget)`).toEqual([]);
    }
  });

  it("(4) the page is force-dynamic with a title, and the data read is no-store", () => {
    const page = read(`${SCANNER_DIR}/page.tsx`);
    expect(page, `${SCANNER_DIR}/page.tsx: must export dynamic = "force-dynamic"`).toMatch(/export const dynamic\s*=\s*["']force-dynamic["']/);
    expect(page, `${SCANNER_DIR}/page.tsx: must export a metadata title`).toMatch(/export const metadata[^=]*=\s*\{\s*title:/);
    expect(read(`${SCANNER_DIR}/scanner-data.ts`), `${SCANNER_DIR}/scanner-data.ts: the fetch must use cache: "no-store"`).toContain('cache: "no-store"');
  });

  it("(5) scanner web files never format, recompute or reorder receipt values", () => {
    const banned: ReadonlyArray<readonly [string, RegExp]> = [
      ["Number(...) conversion", /\bNumber\s*\(/],
      ["parseFloat", /\bparseFloat\b/],
      ["parseInt", /\bparseInt\b/],
      ["toFixed", /\btoFixed\b/],
      ["percent formatting", /percent/i],
      ["formatOdds", /\bformatOdds\b/],
      ["formatSignedPercent", /\bformatSignedPercent\b/],
      ["Intl.NumberFormat", /\bIntl\s*\.\s*NumberFormat\b/],
      [".sort(...)", /\.\s*sort\s*\(/],
      [".toSorted(...)", /\.\s*toSorted\s*\(/],
    ];
    for (const file of scannerFiles) {
      let source = stripComments(read(file));
      if (file === ALPHABETICAL_CODES_FILE) {
        // The one allowed sort: alphabetical order of unknown outcome CODES for the EMPTY count tiles. It orders short
        // strings in a pure helper, never rows, edge, EV or probability. Removing that helper body re-arms the ban.
        const helper = /export function outcomeTileOrder[\s\S]*?\n\}\n/.exec(source)?.[0] ?? "";
        expect(helper.match(/\.\s*sort\s*\(\s*\)/g)?.length, `${file}: outcomeTileOrder must hold the single allowed argument-free sort of outcome codes`).toBe(1);
        source = source.replace(helper, "");
      }
      for (const [name, pattern] of banned) {
        expect(source, `${file}: ${name} is forbidden (stored strings are shown verbatim, the list is never reordered)`).not.toMatch(pattern);
      }
    }
  });

  it("(6) scanner markup has no table, sort or filter control, raw HTML or next/link", () => {
    expect(scannerTsx.length, `${SCANNER_DIR}: no .tsx files found`).toBeGreaterThan(0);
    for (const file of scannerTsx) {
      const source = stripComments(read(file));
      expect(source, `${file}: no table markup (the scanner is a grouped list)`).not.toMatch(/<(?:table|thead|tbody|tfoot|tr|th|td|caption|colgroup)[\s>/]/);
      expect(source, `${file}: no aria-sort`).not.toContain("aria-sort");
      expect(source, `${file}: no select, input, textarea, button or form controls`).not.toMatch(/<(?:select|input|textarea|button|form|option)[\s>/]/);
      expect(source, `${file}: no dangerouslySetInnerHTML`).not.toContain("dangerouslySetInnerHTML");
      expect(source, `${file}: no next/link (plain anchors avoid prefetching hundreds of links)`).not.toMatch(/from\s*["']next\/link["']/);
    }
  });

  it("(7) the navigation has the scanner entry between Анализ and Результаты", () => {
    const source = read("apps/web/components/release-navigation.tsx");
    const analysis = source.indexOf('label: "Анализ"');
    const scanner = source.indexOf('label: "Сканер"');
    const results = source.indexOf('label: "Результаты"');
    expect(scanner, "release-navigation.tsx: missing the «Сканер» entry").toBeGreaterThan(-1);
    expect(scanner, "release-navigation.tsx: «Сканер» must come after «Анализ»").toBeGreaterThan(analysis);
    expect(results, "release-navigation.tsx: «Результаты» must come after «Сканер»").toBeGreaterThan(scanner);
    const entry = source.slice(scanner, results);
    expect(entry, 'release-navigation.tsx: the entry must link to href: "/scanner"').toContain('href: "/scanner"');
    expect(entry, 'release-navigation.tsx: the entry must be current for pathname.startsWith("/scanner")').toContain('pathname.startsWith("/scanner")');
    expect(source, "release-navigation.tsx: must not import from the scanner directory (client bundle)").not.toMatch(/from\s*["'][^"']*scanner/);
  });

  it("(8) the home page takes the scanner card from the shared labels", () => {
    const home = read("apps/web/app/page.tsx");
    expect(home, "apps/web/app/page.tsx: must import SCANNER_HOME_CONTENT").toMatch(/import\s*\{[^}]*\bSCANNER_HOME_CONTENT\b[^}]*\}\s*from\s*["']\.\/scanner\/scanner-labels["']/);
    expect(home, "apps/web/app/page.tsx: SCANNER_HOME_CONTENT must be listed in CONTENTS").toMatch(/CONTENTS\s*=\s*\[[\s\S]*\bSCANNER_HOME_CONTENT\b[\s\S]*\]\s*as const/);
  });

  it("(9) there is no public proxy route for the scanner", () => {
    expect(existsSync(resolve("apps/web/app/internal-api/scanner")), "apps/web/app/internal-api/scanner: the page reads the API on the server; no proxy route (recorded assumption)").toBe(false);
  });

  it("(10) the API service runs one raw statement, never orders by edge, EV or probability, and never sorts", () => {
    const service = stripComments(read(SERVICE));
    expect(service.match(/\$queryRaw\b/g)?.length ?? 0, `${SERVICE}: exactly one $queryRaw call (no N+1)`).toBe(1);
    expect(service, `${SERVICE}: no unsafe raw variants`).not.toMatch(/\$(?:queryRawUnsafe|executeRawUnsafe|executeRaw)\b|Prisma\.raw\b/);
    expect(service, `${SERVICE}: no ORM find calls (everything is the single statement)`).not.toMatch(/\.\s*(?:findMany|findFirst|findUnique|findFirstOrThrow|findUniqueOrThrow|groupBy|aggregate)\s*\(/);
    expect(service, `${SERVICE}: no JS sort`).not.toMatch(/\.\s*(?:sort|toSorted)\s*\(/);

    const clauses = [...service.matchAll(/ORDER\s+BY/gi)].map((match) => {
      let depth = 0;
      let text = "";
      for (const char of service.slice(match.index + match[0].length)) {
        if (char === "(") depth += 1;
        else if (char === ")") {
          if (depth === 0) break;
          depth -= 1;
        } else if (char === "`" || char === ";") break;
        text += char;
      }
      return text;
    });
    expect(clauses.length, `${SERVICE}: expected ORDER BY clauses to inspect`).toBeGreaterThan(0);
    for (const clause of clauses) {
      expect(clause, `${SERVICE}: ORDER BY must not use edge, EV or probability (ranking drift): ${clause.trim().slice(0, 80)}`).not.toMatch(
        /edge|expectedValue|modelProbability|noVigProbability|fairOdds/,
      );
    }

    expect(stripComments(read(DOMAIN_SCANNER)), `${DOMAIN_SCANNER}: no JS sort`).not.toMatch(/\.\s*(?:sort|toSorted)\s*\(/);
  });

  it("(11) scanner domain module adds nothing to a client chunk", () => {
    // Raw text on purpose: the comment stripper would remove the annotations this guard is about.
    const source = read(DOMAIN_SCANNER);
    const declarations = [...source.matchAll(/^export const (\w+)[^=\n]*=\s*/gm)];
    expect(declarations.length, `${DOMAIN_SCANNER}: no top-level export const found (the guard is broken)`).toBeGreaterThan(0);
    // A bare call right after "=" has no annotation: the annotation would sit between "=" and the callee.
    const unannotated = declarations
      .filter((match) => /^(?:new\s+)?[A-Za-z_$][\w$.]*\s*\(/.test(source.slice(match.index + match[0].length)))
      .map((match) => match[1]);
    expect(unannotated, `${DOMAIN_SCANNER}: a top-level call without a pure annotation stays in the browser chunk of every barrel importer (D-11)`).toEqual([]);
    expect(
      source.match(/=\s*\/\*#__PURE__\*\/\s*Object\.freeze\(/g)?.length ?? 0,
      `${DOMAIN_SCANNER}: the freshness policy and both order lists must be annotated Object.freeze calls`,
    ).toBe(3);
  });
});
