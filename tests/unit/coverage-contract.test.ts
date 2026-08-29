import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const coveragePath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../.planning/phases/02-historical-evidence-pipeline/COVERAGE.md",
);

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
    for (const endpoint of ["lineups", "injuries", "odds", "secondary statistics", "fallback/enrichment endpoints"]) {
      expect(
        rows.find((row) => row["Endpoint surface"] === endpoint),
        `Missing explicit Phase 3/5 opt-out: ${endpoint}`,
      ).toEqual(expect.objectContaining({ "Phase 2 status": "deferred" }));
    }
  });
});
