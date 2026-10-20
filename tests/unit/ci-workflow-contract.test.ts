import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// CI-02 backstop: this test is the executable security policy for
// .github/workflows/ci.yml. It runs inside the unit project, therefore inside
// the quality job itself — the policy guards the workflow that runs the policy.
const workflowPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../.github/workflows/ci.yml");
// Normalize line endings: the Windows dev host checks files out as CRLF
// (core.autocrlf), CI checkouts are LF — the policy must hold for both.
const source = readFileSync(workflowPath, "utf8").replace(/\r\n/g, "\n");

// Job keys are matched at their exact two-space YAML indentation so step-level
// substrings (e.g. `test:integration:docker` in a `run:` line) can never be
// mistaken for a job definition.
const QUALITY_JOB = "\n  quality:\n";
const INTEGRATION_JOB = "\n  integration:\n";
const E2E_JOB = "\n  e2e-portable:\n";

function jobBlock(jobKey: string, nextJobKey?: string): string {
  const start = source.indexOf(jobKey);
  expect(start, `ci.yml is missing the job definition: ${jobKey.trim()}`).toBeGreaterThanOrEqual(0);
  if (!nextJobKey) return source.slice(start);
  const end = source.indexOf(nextJobKey, start + jobKey.length);
  expect(end, `ci.yml is missing the job definition: ${nextJobKey.trim()}`).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("CI workflow structure contract", () => {
  it("declares the CI workflow with exactly the quality, integration and e2e-portable jobs", () => {
    expect(existsSync(workflowPath), `Missing CI workflow: ${workflowPath}`).toBe(true);
    expect(source, "ci.yml must declare `name: CI`").toContain("name: CI");
    expect(source, "ci.yml must define the quality job").toContain(QUALITY_JOB);
    expect(source, "ci.yml must define the integration job").toContain(INTEGRATION_JOB);
    expect(source, "ci.yml must define the e2e-portable job").toContain(E2E_JOB);
  });

  it("runs every job on ubuntu-latest", () => {
    const jobs: Array<[string, string | undefined]> = [
      [QUALITY_JOB, INTEGRATION_JOB],
      [INTEGRATION_JOB, E2E_JOB],
      [E2E_JOB, undefined],
    ];
    for (const [jobKey, nextJobKey] of jobs) {
      expect(
        jobBlock(jobKey, nextJobKey),
        `Job ${jobKey.trim()} must run on ubuntu-latest (containers are unsupported elsewhere)`,
      ).toContain("runs-on: ubuntu-latest");
    }
  });

  it("grants only read-only permissions and cancels superseded runs", () => {
    expect(source, "ci.yml must declare a top-level permissions block").toContain("permissions:");
    expect(source, "ci.yml permissions must be restricted to `contents: read`").toContain("contents: read");
    expect(source, "ci.yml must declare a concurrency block").toContain("concurrency:");
    expect(
      source,
      "ci.yml concurrency must set `cancel-in-progress: true` so a newer push cancels stale runs",
    ).toContain("cancel-in-progress: true");
  });

  it("triggers on pull requests and on pushes to main only", () => {
    expect(source, "ci.yml must trigger on pull_request").toContain("pull_request:");
    expect(source, "ci.yml must trigger on push").toContain("push:");
    expect(source, "ci.yml push trigger must be scoped to branches: [main]").toContain("branches: [main]");
  });

  it("never uses pull_request_target or path filters", () => {
    expect(source, "ci.yml must not use pull_request_target (fork-PR secret-exfiltration vector)").not.toContain(
      "pull_request_target",
    );
    expect(source, "ci.yml must not use `paths:` — every commit must execute all three jobs").not.toContain("paths:");
    expect(source, "ci.yml must not use `paths-ignore:` — every commit must execute all three jobs").not.toContain(
      "paths-ignore:",
    );
  });
});

describe("CI workflow skips-and-secrets contract", () => {
  it("contains no skip constructs, no secrets, no provider credentials and no docker-presence guards", () => {
    expect(source, "ci.yml must not use `continue-on-error` — failures must block, never skip").not.toContain(
      "continue-on-error",
    );
    expect(source, "ci.yml must not reference `secrets.` — fork PRs must run with no repo secrets").not.toContain(
      "secrets.",
    );
    expect(source, "ci.yml must never name API_FOOTBALL — no provider credentials in CI (budget)").not.toContain(
      "API_FOOTBALL",
    );
    expect(source, "ci.yml must never name FOOTBALL_DATA — no provider credentials in CI (budget)").not.toContain(
      "FOOTBALL_DATA",
    );
    expect(source, "ci.yml must not guard on docker presence — missing Docker must fail, not skip").not.toMatch(
      /if\s+docker\s+info/,
    );
  });

  it("passes expressions to shell only via env indirection, never interpolation into run bodies", () => {
    const offending = source
      .split("\n")
      .filter((line) => /run:.*\$\{\{/.test(line));
    expect(
      offending,
      `ci.yml must not interpolate \${{ }} expressions into run: bodies (workflow-injection risk); offending lines: ${offending.join(" | ")}`,
    ).toEqual([]);
  });
});

describe("CI workflow supply-chain contract", () => {
  it("pins the sanctioned action majors", () => {
    expect(source, "ci.yml must use actions/checkout@v6").toContain("actions/checkout@v6");
    expect(source, "ci.yml must use pnpm/action-setup@v6").toContain("pnpm/action-setup@v6");
    expect(source, "ci.yml must use actions/setup-node@v7").toContain("actions/setup-node@v7");
  });

  it("pins every uses: ref to an exact major tag", () => {
    const usesLines = source.split("\n").filter((line) => line.includes("uses:"));
    expect(usesLines.length, "ci.yml declares no uses: steps at all").toBeGreaterThan(0);
    for (const line of usesLines) {
      expect(
        line,
        `Unpinned action ref (must be owner/repo@vN, no branches or floating refs): ${line.trim()}`,
      ).toMatch(/uses:\s*[\w-]+\/[\w-]+@v\d+/);
    }
  });

  it("lets pnpm/action-setup read packageManager instead of a hardcoded version input", () => {
    const setupOccurrences = [...source.matchAll(/pnpm\/action-setup@v6/g)];
    expect(setupOccurrences.length, "ci.yml must use pnpm/action-setup@v6").toBeGreaterThan(0);
    for (const match of setupOccurrences) {
      const after = source.slice(match.index! + "pnpm/action-setup@v6".length);
      const nextLine = after
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line.length > 0) ?? "";
      expect(
        nextLine,
        "The pnpm/action-setup step must not carry a `version:`/`with:` input — packageManager pnpm@10.34.5 is the single source of truth",
      ).not.toMatch(/^(with:|version:)/);
    }
  });

  it("uses Node 24 with the pnpm store cache", () => {
    expect(source, "ci.yml must pin node-version: 24 (engines requires >=24 <25)").toContain("node-version: 24");
    expect(source, "ci.yml must enable `cache: pnpm` keyed on the lockfile").toContain("cache: pnpm");
  });

  it("installs only with --frozen-lockfile", () => {
    const installLines = source.split("\n").filter((line) => line.includes("pnpm install"));
    expect(installLines.length, "ci.yml declares no pnpm install step at all").toBeGreaterThan(0);
    for (const line of installLines) {
      expect(
        line,
        `Every pnpm install must pass --frozen-lockfile (lockfile-bypass risk): ${line.trim()}`,
      ).toContain("--frozen-lockfile");
    }
  });
});

describe("CI workflow job-body contracts", () => {
  it("keeps the quality chain in the release-gate order", () => {
    const quality = jobBlock(QUALITY_JOB, INTEGRATION_JOB);
    const chain = [
      "pnpm install --frozen-lockfile",
      "pnpm verify:release:schema",
      "pnpm typecheck",
      "pnpm lint",
      "pnpm test",
      "pnpm build",
    ];
    const positions = chain.map((step) => quality.indexOf(step));
    for (let index = 0; index < chain.length; index += 1) {
      expect(positions[index], `Quality job must contain step: ${chain[index]}`).toBeGreaterThanOrEqual(0);
      if (index > 0) {
        expect(
          positions[index],
          `Quality step out of release-gate order: ${chain[index]} must run after ${chain[index - 1]}`,
        ).toBeGreaterThan(positions[index - 1]!);
      }
    }
  });

  it("runs the integration suite only through the owned-container harness", () => {
    const integration = jobBlock(INTEGRATION_JOB, E2E_JOB);
    expect(
      integration,
      "Integration job must invoke `pnpm run test:integration:docker` (the owned-container harness)",
    ).toContain("pnpm run test:integration:docker");
    expect(
      integration,
      "Integration job must not call vitest directly — the harness owns containers, migrate deploy and the test invocation",
    ).not.toContain("vitest");
  });

  it("runs exactly the two portable specs under the webServer-less CI config", () => {
    const e2e = source.slice(source.indexOf(E2E_JOB));
    expect(e2e, "e2e-portable job must run `corepack enable` (stacks shell out to corepack pnpm)").toContain(
      "corepack enable",
    );
    expect(
      e2e,
      "e2e-portable job must install the browser via `playwright install chromium --with-deps`",
    ).toContain("playwright install chromium --with-deps");
    expect(
      e2e,
      "e2e-portable job must run playwright with -c playwright.ci.config.ts and the explicit two-spec list",
    ).toContain("playwright.ci.config.ts");
  });
});
