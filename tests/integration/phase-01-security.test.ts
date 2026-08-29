import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { evaluateEligibility, projectDataState } from "@bet-stats/domain";
import { OperatorGuard } from "../../apps/api/src/modules/reconciliation/operator.guard.js";

const repositoryFile = (path: string) => readFileSync(resolve(path), "utf8");

describe("Phase 1 held-out security boundaries", () => {
  it("denies eligibility when the allowlist, region, acknowledgement, or decision freshness is not affirmative", () => {
    const now = new Date("2026-08-28T12:00:00.000Z");
    const inputs = [
      [{ explicitRegion: "PL", ageAcknowledged: true, checkedAt: now.toISOString() }, []],
      [{ explicitRegion: undefined, ageAcknowledged: true, checkedAt: now.toISOString() }, ["PL"]],
      [{ explicitRegion: "PL", ageAcknowledged: false, checkedAt: now.toISOString() }, ["PL"]],
      [{ explicitRegion: "PL", ageAcknowledged: true, checkedAt: "2026-08-28T10:59:59.000Z" }, ["PL"]],
    ] as const;

    for (const [input, allowedRegions] of inputs) {
      expect(evaluateEligibility(input, { allowedRegions, now, maxDecisionAgeMs: 3_600_000 }).allowed).toBe(false);
    }
  });

  it("keeps operator review disabled by default and makes invalid credentials indistinguishable", () => {
    const disabled = new OperatorGuard(undefined);
    const enabled = new OperatorGuard("test-only-operator-credential");

    for (const attempt of [() => disabled.authorize(undefined), () => disabled.authorize("anything"), () => enabled.authorize(undefined), () => enabled.authorize("wrong")]) {
      expect(attempt).toThrowError("Not found");
    }
    expect(enabled.authorize("test-only-operator-credential")).toEqual({ actor: "operator" });
  });

  it("keeps the operator credential server-only and out of browser hydration code", () => {
    const browserWorkspace = repositoryFile("apps/web/app/internal/reconciliation/page.tsx");
    const serverProxy = repositoryFile("apps/web/app/internal-api/reconciliation/[[...path]]/route.ts");

    expect(browserWorkspace).not.toMatch(/OPERATOR_CREDENTIAL|x-operator-credential/);
    expect(serverProxy).toContain("process.env.OPERATOR_CREDENTIAL");
    expect(serverProxy).toContain('"cache-control": "private, no-store, max-age=0"');
  });

  it("fails closed for unknown data state instead of presenting availability", () => {
    expect(projectDataState({ state: "provider-new-state", reason: "untrusted", provider: "held-out", value: null, sourceUpdatedAt: null, capturedAt: "2026-08-28T12:00:00.000Z", freshnessThresholdMs: 60_000 })).toMatchObject({ state: "LIMITED", reason: "UNKNOWN_DATA_STATE", value: null });
  });

  it("contains no Phase-1 implementation path for deferred or prohibited provider surfaces", () => {
    const provider = repositoryFile("packages/football-data/src/providers/football-data-org/client.ts");
    const worker = repositoryFile("workers/data-sync/src/jobs/fixtures.ts");
    const publicFixtures = repositoryFile("apps/web/app/fixtures/page.tsx");
    const production = `${provider}\n${worker}`;

    expect(production).not.toMatch(/api-football|understat|thesportsdb/iu);
    expect(production).not.toMatch(/standings|results|lineups?|injur(?:y|ies)|bookmaker|placeBet|wager/iu);
    expect(publicFixtures).not.toMatch(/["'`]prediction["'`]|["'`]odds["'`]|["'`]value["'`]|coming soon/iu);
  });
});
