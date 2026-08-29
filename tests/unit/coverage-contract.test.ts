import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const coveragePath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../.planning/phases/02-historical-evidence-pipeline/COVERAGE.md",
);
const providerContractPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../packages/football-data/src/provider.interface.ts");
const clientPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../packages/football-data/src/providers/football-data-org/client.ts");

const requiredColumns = [
  "Endpoint surface",
  "Adapter method",
  "Capability key",
  "Endpoint priority lane",
  "Reservation class",
  "Normalized DTO",
  "Durable observation/fact",
  "Automated witness",
] as const;

const allowedLanes = new Set(["critical", "standard"]);
const allowedReservations = new Set(["fixture-continuity", "result-continuity", "standings"]);
const deferredTargets = new Map([
  ["lineups", "Phase 3"],
  ["injuries", "Phase 3"],
  ["odds", "Phase 5"],
  ["secondary statistics", "Phase 3"],
  ["fallback/enrichment endpoints", "Phase 5"],
]);

function splitMarkdownRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function parseTable(markdown: string, heading: string): Array<Record<string, string>> {
  const section = markdown.split(`## ${heading}`)[1]?.split("\n## ")[0];
  expect(section, `Missing coverage section: ${heading}`).toBeDefined();

  const lines = section!
    .split("\n")
    .filter((line) => line.trim().startsWith("|"));
  expect(lines.length, `Missing markdown table under: ${heading}`).toBeGreaterThanOrEqual(3);

  const headers = splitMarkdownRow(lines[0]!);
  return lines.slice(2).map((line) =>
    Object.fromEntries(headers.map((header, index) => [header, splitMarkdownRow(line)[index] ?? ""])),
  );
}

describe("Phase 2 football-data.org endpoint coverage contract", () => {
  it("declares the required live endpoint matrix and classifications", () => {
    expect(existsSync(coveragePath), `Missing coverage contract: ${coveragePath}`).toBe(true);

    const markdown = readFileSync(coveragePath, "utf8");
    const headerLine = markdown.split("\n").find((line) => line.includes("Endpoint surface"));
    expect(headerLine, "Missing Phase2EndpointCoverage table header").toBeDefined();
    expect(splitMarkdownRow(headerLine!)).toEqual(requiredColumns);

    const rows = parseTable(markdown, "Phase2EndpointCoverage");
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        "Endpoint surface": "upcoming fixtures",
        "Endpoint priority lane": "critical",
        "Reservation class": "fixture-continuity",
      }),
      expect.objectContaining({
        "Endpoint surface": "completed results",
        "Endpoint priority lane": "critical",
        "Reservation class": "result-continuity",
      }),
      expect.objectContaining({
        "Endpoint surface": "standings",
        "Endpoint priority lane": "standard",
        "Reservation class": "standings",
      }),
    ]));
  });

  it("explicitly defers optional enrichment outside the Phase 2 live path", () => {
    expect(existsSync(coveragePath), `Missing coverage contract: ${coveragePath}`).toBe(true);

    const rows = parseTable(readFileSync(coveragePath, "utf8"), "Explicit opt-outs");
    for (const [endpoint, targetPhase] of deferredTargets) {
      expect(
        rows.find((row) => row["Endpoint surface"] === endpoint),
        `Missing explicit Phase 3/5 opt-out: ${endpoint}`,
      ).toEqual(expect.objectContaining({
        "Phase 2 status": "deferred",
        "Target phase": targetPhase,
      }));
    }
  });

  it("rejects duplicate, incomplete, or invalid live endpoint classifications by name", () => {
    const rows = parseTable(readFileSync(coveragePath, "utf8"), "Phase2EndpointCoverage");
    const seenSurfaces = new Set<string>();

    for (const row of rows) {
      const surface = row["Endpoint surface"] ?? "<unnamed>";
      expect(seenSurfaces.has(surface), `Duplicate live endpoint classification: ${surface}`).toBe(false);
      seenSurfaces.add(surface);

      for (const column of requiredColumns) {
        expect(row[column], `Missing ${column} for live endpoint: ${surface}`).toBeTruthy();
      }
      expect(
        allowedLanes.has(row["Endpoint priority lane"]!),
        `Invalid endpoint priority lane for ${surface}: ${row["Endpoint priority lane"]}`,
      ).toBe(true);
      expect(
        allowedReservations.has(row["Reservation class"]!),
        `Invalid reservation class for ${surface}: ${row["Reservation class"]}`,
      ).toBe(true);
      expect(
        deferredTargets.has(surface),
        `Deferred endpoint leaked into the Phase 2 live matrix: ${surface}`,
      ).toBe(false);
    }

    expect([...seenSurfaces].sort()).toEqual([
      "completed results",
      "standings",
      "upcoming fixtures",
    ]);
  });

  it("keeps every deferred endpoint unique and outside the live classifications", () => {
    const liveRows = parseTable(readFileSync(coveragePath, "utf8"), "Phase2EndpointCoverage");
    const optOutRows = parseTable(readFileSync(coveragePath, "utf8"), "Explicit opt-outs");
    const liveSurfaces = new Set(liveRows.map((row) => row["Endpoint surface"]));
    const optOutSurfaces = optOutRows.map((row) => row["Endpoint surface"]!);

    expect(new Set(optOutSurfaces).size, "Duplicate explicit opt-out row").toBe(optOutSurfaces.length);
    expect([...optOutSurfaces].sort()).toEqual([...deferredTargets.keys()].sort());
    for (const surface of optOutSurfaces) {
      expect(liveSurfaces.has(surface), `Deferred endpoint is also live: ${surface}`).toBe(false);
    }
  });

  it("keeps documented adapter methods and DTO names aligned with exported provider contracts", () => {
    const rows = parseTable(readFileSync(coveragePath, "utf8"), "Phase2EndpointCoverage");
    const providerContract = readFileSync(providerContractPath, "utf8");
    const client = readFileSync(clientPath, "utf8");

    for (const row of rows) {
      const method = row["Adapter method"]!.replaceAll("`", "");
      const dto = row["Normalized DTO"]!.replaceAll("`", "");
      expect(client, `Missing documented adapter method export: ${method}`).toMatch(new RegExp(`\\b${method}\\s*\\(`));
      expect(providerContract, `Missing documented normalized DTO export: ${dto}`).toMatch(new RegExp(`export (?:interface|type) ${dto}\\b`));
    }
  });
});
