import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const DISCLOSURE = "Probabilities are estimates, not guarantees. You can lose money when betting.";

const PROHIBITED_CLAIMS = {
  certainty: [/\bsure\b/iu, /\bsafe\s+bet\b/iu, /\bguaranteed(?:\s+(?:win|profit))?\b/iu],
  urgency: [/\bact\s+now\b/iu, /\bmust\s+bet\b/iu, /\block\b/iu],
  riskFree: [/\brisk[-\s]?free\b/iu],
  stakeSizing: [/\bstake\s+(?:size|sizing|\d+)/iu, /\bbet\s+\d+%/iu],
  automaticWager: [/\bauto(?:matic)?(?:ally)?\s+(?:bet|wager)/iu, /\bplace\s+(?:the|a)\s+bet\b/iu],
} as const;

function scanUserFacingCopy(source: string): readonly string[] {
  const approvedDisclosures = [DISCLOSURE, "No outcome is guaranteed."];
  const scannable = approvedDisclosures.reduce((copy, approved) => copy.replaceAll(approved, ""), source);
  return Object.entries(PROHIBITED_CLAIMS)
    .filter(([, patterns]) => patterns.some((pattern) => pattern.test(scannable)))
    .map(([category]) => category);
}

function userFacingSources(): readonly string[] {
  return ["apps/web/app", "apps/web/components"].flatMap((directory) =>
    readdirSync(resolve(directory), { recursive: true })
      .map(String)
      .filter((file) => file.endsWith(".tsx"))
      .map((file) => `${directory}/${file.replaceAll("\\", "/")}`),
  );
}

describe("responsible user-facing copy", () => {
  it.each([
    ["This is a sure result.", "certainty"],
    ["Our safe bet is a guaranteed win.", "certainty"],
    ["Act now: this is the lock of the week.", "urgency"],
    ["You must bet before kickoff.", "urgency"],
    ["A risk-free guaranteed profit.", "riskFree"],
    ["Stake size 5 units.", "stakeSizing"],
    ["Automatically place the bet.", "automaticWager"],
  ])("names the prohibited category for %s", (copy, category) => {
    expect(scanUserFacingCopy(copy)).toContain(category);
  });

  it("does not invalidate the required disclosure or neutral fixture copy", () => {
    expect(scanUserFacingCopy(DISCLOSURE)).toEqual([]);
    expect(scanUserFacingCopy("Upcoming fixtures. No outcome is guaranteed.")).toEqual([]);
  });

  it("keeps the exact disclosure persistent in every protected analytics shell", () => {
    const shell = readFileSync(resolve("apps/web/components/analytics-shell.tsx"), "utf8");
    const disclosure = readFileSync(resolve("apps/web/components/risk-disclosure.tsx"), "utf8");
    expect(shell).toContain("<RiskDisclosure />");
    expect(disclosure).toContain(DISCLOSURE);
  });

  it("keeps fixture discovery neutral and passes the repository copy gate", () => {
    const userFacingFiles = userFacingSources();
    const findings = userFacingFiles.flatMap((file) =>
      scanUserFacingCopy(readFileSync(resolve(file), "utf8")).map((category) => ({ file, category })),
    );

    expect(findings).toEqual([]);
    expect(readFileSync(resolve("apps/web/app/fixtures/page.tsx"), "utf8")).not.toContain("RiskDisclosure");
  });

  it("uses the exact API receipt for readable, copied, and downloaded output", () => {
    const workbench = readFileSync(resolve("apps/web/app/fixtures/[fixtureId]/forecast-workbench.tsx"), "utf8");
    expect(workbench).toContain("JSON.stringify(result, null, 2)");
    expect(workbench).toContain("navigator.clipboard.writeText(canonicalReceipt)");
    expect(workbench).toContain("?download=true");
    expect(workbench).toContain("Receipt IDs and versions");
    expect(workbench).toContain("Gate outcomes and thresholds");
  });
});
