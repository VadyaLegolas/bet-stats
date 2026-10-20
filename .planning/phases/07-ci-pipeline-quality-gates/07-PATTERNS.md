# Phase 7: CI Pipeline & Quality Gates - Pattern Map

**Mapped:** 2026-10-20
**Files analyzed:** 18 (new + modified)
**Analogs found:** 15 / 18

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `.github/workflows/ci.yml` | config (CI workflow) | batch / pipeline | `package.json:11-22` (`verify:release` chain) + `scripts/verify-release-integration.mjs` | semantic only (no workflow file exists in repo) |
| `eslint.config.mjs` (root, optional shared base) | config | transform (static analysis) | `apps/web/eslint.config.mjs` | role-match (flat-config shape) |
| `apps/api/eslint.config.mjs` | config | transform | `apps/web/eslint.config.mjs` | role-match |
| `workers/data-sync/eslint.config.mjs` | config | transform | `apps/web/eslint.config.mjs` | role-match |
| `packages/config/eslint.config.mjs` | config | transform | `apps/web/eslint.config.mjs` | role-match |
| `packages/database/eslint.config.mjs` | config | transform | `apps/web/eslint.config.mjs` | role-match |
| `packages/domain/eslint.config.mjs` | config | transform | `apps/web/eslint.config.mjs` | role-match |
| `packages/football-data/eslint.config.mjs` | config | transform | `apps/web/eslint.config.mjs` | role-match |
| `playwright.ci.config.ts` | config (test runner) | batch (E2E run) | `playwright.config.ts` + `playwright.phase06.config.ts` | exact (copy shape, drop `webServer`) |
| `tests/integration/mutation-rejection.test.ts` | test | CRUD (raw SQL trigger assertion) | `tests/integration/forecast-snapshots.test.ts` | exact (house trigger-assertion pattern) |
| `.gitattributes` | config | — | none | no analog |
| `.npmrc` | config | — | none | no analog |
| `apps/api/package.json` (add `lint` script) | config | — | `apps/web/package.json:10` | exact |
| `workers/data-sync/package.json` (add `lint`) | config | — | `apps/web/package.json:10` | exact |
| `packages/config/package.json` (add `lint`) | config | — | `apps/web/package.json:10` | exact |
| `packages/database/package.json` (add `lint`) | config | — | `apps/web/package.json:10` | exact |
| `packages/domain/package.json` (add `lint`) | config | — | `apps/web/package.json:10` | exact |
| `packages/football-data/package.json` (add `lint`) | config | — | `apps/web/package.json:10` | exact |

**Notes on classification:**
- The root `lint` script (`"lint": "turbo run lint"`, `package.json:14`) and turbo's `lint` task already exist — they need **no modification**, only fan-out coverage via the per-package `lint` scripts above.
- An optional root meta-test (every workspace package declares `lint`) would be a `unit`-project test; nearest analog is the root `vitest.config.ts` unit project (no direct analog file — planner may drop this as optional).

---

## Pattern Assignments

### `.github/workflows/ci.yml` (config, batch pipeline)

**Analog:** `package.json:11-22` (the trusted local release chain CI replays) + `scripts/verify-release-integration.mjs` (integration job body)

**No `.github/` directory exists in the repo** — this is the only wholly-new artifact type. The step order is copied verbatim from the existing `verify:release` chain minus its Windows-only tail:

```json
// package.json:19-21 (existing — CI replays these steps one by one, NOT via verify:release)
"verify:release:prerequisites": "node -e \"if (process.versions.node.split('.')[0] !== '24') { ... }\" && docker version --format \"{{.Server.Version}}\"",
"verify:release:schema": "node -e \"process.env.DATABASE_URL='postgresql://release_validate:...'; ... prisma validate ...\"",
"verify:release": "pnpm verify:release:prerequisites && pnpm install --frozen-lockfile && pnpm verify:release:schema && pnpm typecheck && pnpm test && node scripts/verify-release-integration.mjs && pnpm build && playwright test -c playwright.phase06.config.ts ..."
```

**Pins already in the repo (drive the workflow's action inputs):**
```json
// package.json:6-10
"packageManager": "pnpm@10.34.5",
"engines": { "node": ">=24.0.0 <25", "pnpm": "10.34.5" }
```

**Integration job body — copy from RESEARCH Pattern 4 skeleton** (research verified all inputs):
```yaml
# .github/workflows/ci.yml — skeleton from 07-RESEARCH.md:273-307
name: CI
on:
  push: { branches: [main] }
  pull_request:
permissions:
  contents: read            # least privilege; never pull_request_target
jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: pnpm/action-setup@v6        # no `version` input — reads packageManager pnpm@10.34.5
      - uses: actions/setup-node@v7
        with: { node-version: 24, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm verify:release:schema
      - run: pnpm typecheck
      - run: pnpm lint
      - run: pnpm test
      - run: pnpm build
  integration:
    runs-on: ubuntu-latest                 # Linux-only: containers unsupported elsewhere
    steps:
      # same checkout/setup/install prologue
      - run: pnpm exec prisma generate --schema packages/database/prisma/schema.prisma
      - run: node scripts/verify-release-integration.mjs   # fails loudly when Docker missing
  # e2e-portable: same setup + corepack enable + `pnpm exec playwright install chromium --with-deps`
  #               + `pnpm exec playwright test -c playwright.ci.config.ts`
```

**Error handling contract (do NOT alter):** the integration harness already fails loud on missing Docker —
```javascript
// scripts/verify-release-integration.mjs:9-11, 52-55
function docker(...args) {
  return execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
// ...
} catch (error) {
  await stop();
  throw error;   // missing docker CLI → throw → nonzero exit; no skip branch anywhere
}
```
No `continue-on-error`, no `if docker info` guards (Pitfall 2).

---

### `eslint.config.mjs` × 7 (config, static analysis)

**Analog:** `apps/web/eslint.config.mjs` (the only flat config in the repo today)

**House flat-config style** (lines 1-16, full file):
```javascript
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  { settings: { next: { rootDir: "." } } },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);
```

**New node-package shape** (RESEARCH Pattern 2, research lines 208-220) — same `defineConfig`/flat philosophy, but `typescript-eslint` preset instead of Next:
```javascript
// apps/api/eslint.config.mjs (same shape for workers/data-sync + 4 packages)
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**"] },
  ...tseslint.configs.recommended,
  { languageOptions: { globals: globals.node, parserOptions: { projectService: true } } },
);
```
Keep type-aware rules narrowly scoped (PITFALLS: monorepo-wide `recommendedTypeChecked` is slow) — prefer `recommended` + a narrow `recommendedTypeChecked` override on `src/` only.

**Do NOT touch `apps/web/eslint.config.mjs`** — Next config stays as-is (Research anti-pattern: root-only config breaks `turbo run lint` fan-out and Next's config scoping).

**Version pins (from apps/web, keep one version workspace-wide):**
```json
// apps/web/package.json:25 — eslint 9.39.5; typescript-eslint 8.72.0, globals 17.x (root devDeps, pinned exact)
```

---

### `playwright.ci.config.ts` (config, E2E batch)

**Analog:** `playwright.config.ts` (base shape) + `playwright.phase06.config.ts` (named-config precedent — the repo already demonstrates a second config file per run mode)

**Base shape** (`playwright.config.ts:1-21`, minus `webServer`):
```typescript
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 240_000,
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:3000",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], timezoneId: "Europe/Warsaw" } },
  ],
  // webServer: [...] ← MUST BE OMITTED in playwright.ci.config.ts (Pitfall 6: double-boot)
});
```

**Named-config precedent** (`playwright.phase06.config.ts:3-20`) shows the repo's convention of one config per invocation mode with an explicit file list passed on the CLI (`package.json:21`):
```typescript
export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/live-release-stack.ts",   // ci config: no globalSetup, no webServer
  timeout: 300_000,
  // ...
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"], timezoneId: "Europe/Warsaw" } },
  ],
});
```

**Portable spec list** (both exist [VERIFIED glob]): `tests/e2e/evidence-scorecard.spec.ts`, `tests/e2e/team-evidence-live.spec.ts` — they self-manage Docker Postgres/migrate/seed/spawn/teardown, so the CI config needs **no `webServer` and no `globalSetup`**. Invocation:
```bash
pnpm exec playwright test -c playwright.ci.config.ts tests/e2e/evidence-scorecard.spec.ts tests/e2e/team-evidence-live.spec.ts
```

---

### `tests/integration/mutation-rejection.test.ts` (test, raw-SQL CRUD assertions)

**Analog:** `tests/integration/forecast-snapshots.test.ts` (house trigger-assertion pattern) + `tests/integration/value-receipt.test.ts` (seeding pattern for guarded tables)

**Imports + file header pattern** (`forecast-snapshots.test.ts:1-11`):
```typescript
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPrismaClient, type PrismaClient } from "@bet-stats/database";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

let prisma: PrismaClient;
const run = process.pid.toString();
const id = (value: string) => `${value}-${run}`;   // per-process id namespace = parallel-safe
```

**Lifecycle pattern** (`forecast-snapshots.test.ts:25-29`):
```typescript
describe("append-only forecast snapshots", () => {
  beforeAll(async () => {
    prisma = createPrismaClient(databaseUrl);
    await seedFixture();
  });
  afterAll(async () => prisma?.$disconnect());
```

**Trigger-assertion core pattern — copy exactly** (`forecast-snapshots.test.ts:45-46`):
```typescript
await expect(prisma.$executeRawUnsafe(`UPDATE "ForecastSnapshot" SET assumptions='["changed"]' WHERE id=$1`, id("forecast-v1"))).rejects.toThrow(/immutable/i);
await expect(prisma.$executeRawUnsafe(`DELETE FROM "ForecastSnapshot" WHERE id=$1`, id("forecast-v1"))).rejects.toThrow(/immutable/i);
```

**Seeding pattern for guarded tables** (`value-receipt.test.ts:31-53`) — idempotent league/season/team/fixture bootstrap plus valid INSERTs that satisfy the tables' INSERT-validation triggers (ForecastSnapshot → ForecastMarket → ManualOddsSnapshot chain):
```typescript
beforeAll(async () => {
  prisma = createPrismaClient(databaseUrl);
  await prisma.$executeRawUnsafe(`
    INSERT INTO "League" (id,name,"countryCode","updatedAt") VALUES ('value-league','League','GB',now()) ON CONFLICT (id) DO NOTHING;
    INSERT INTO "Season" (...) VALUES (...) ON CONFLICT (id) DO NOTHING;
    INSERT INTO "Team" (...) VALUES (...) ON CONFLICT (id) DO NOTHING;
    INSERT INTO "Fixture" (...) VALUES ('${id("fixture")}', ...);
  `);
  // ForecastSnapshot + ForecastMarket inserts (lines 45-50), ManualOddsSnapshot insert (line 52)
});
```

**Assertion-pattern rule (Pitfall 5) — two trigger families, two message patterns:**

| Family | Trigger function | Assert with | Tables |
|--------|------------------|-------------|--------|
| phase03/04 | `reject_append_only_change()` / `guard_*()` | `/immutable/i` | ForecastSnapshot, ForecastMarket, ManualOddsSnapshot/Selection, ValueReceipt, ValueSettlement, SettlementReceipt, ForecastScore, ClosingOddsObservation (`'ClosingOddsObservation is immutable'`) |
| historical-evidence | `prevent_historical_evidence_mutation()` (`'% is append-only'`) | `/append-only/i` | ResultVersion, SourceObservation |

Gap-closure targets for this file (RESEARCH Pattern 3): `ValueReceipt` DELETE, `ValueSettlement` DELETE, `ClosingOddsObservation` UPDATE+DELETE, `ForecastMarket` UPDATE+DELETE, `ResultVersion` UPDATE+DELETE (use `/append-only/i`), optional `SourceObservation` UPDATE.

---

### Modified `*/package.json` — add `lint` script × 6 (config)

**Analog:** `apps/web/package.json:10` (the only package with a lint script today)

```json
// apps/web/package.json:10 — copy this line into apps/api, workers/data-sync,
// packages/{config,database,domain,football-data}
"lint": "eslint .",
```

**Fan-out already wired — no change needed to turbo.json or root package.json:**
```json
// turbo.json:12-14
"lint": { "dependsOn": ["^lint"] }
```
```json
// package.json:14
"lint": "turbo run lint",
```
After extension all 7 packages declare `lint`, so `turbo run lint` (and CI's `pnpm lint`) actually covers the workspace (CI-03 / Pitfall 1).

---

## Shared Patterns

### Fail-loud Docker harness (integration job)
**Source:** `scripts/verify-release-integration.mjs` (full file, 97 lines)
**Apply to:** `ci.yml` integration job — call verbatim as `node scripts/verify-release-integration.mjs`, never wrap.
```javascript
// scripts/verify-release-integration.mjs:23-55 — owned containers, random loopback ports,
// prisma migrate deploy before tests, deterministic cleanup, rethrow on failure
export async function startOwnedReleaseDependencies() {
  const suffix = `${process.pid}-${Date.now()}`;
  const postgres = `bet-stats-release-pg-${suffix}`;
  // ... docker run --publish 127.0.0.1::5432 postgres:18-alpine
  // ... docker run --publish 127.0.0.1::6379 redis:8-alpine
  execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], { ... });
  return { databaseUrl, redisUrl, stop };
}
// CI invocation note (lines 59-61): npm_execpath must be present — invoke via
// `pnpm exec node scripts/...` or right after a pnpm script, else RELEASE_PNPM_CLI_UNAVAILABLE.
```

### Hermetic test env injection (no repo secrets in CI)
**Source:** `scripts/verify-release-integration.mjs:82-89`
**Apply to:** integration job; explains why CI needs no secrets (fork-PR safe)
```javascript
return await run({
  ...environment,
  PATH: `${runtimePath}${delimiter}${inheritedPath}`,
  DATABASE_URL: owned.databaseUrl,
  REDIS_URL: owned.redisUrl,
  OPERATOR_PROXY_SIGNING_SECRET: environment.OPERATOR_PROXY_SIGNING_SECRET ?? "release-integration-signing-secret-32-bytes",
  OPERATOR_AUTHORIZED_SUBJECTS: environment.OPERATOR_AUTHORIZED_SUBJECTS ?? "local-test-operator",
});
```

### Test env guard
**Source:** `tests/integration/forecast-snapshots.test.ts:6-7` (every integration test file opens with this)
**Apply to:** `tests/integration/mutation-rejection.test.ts`
```typescript
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
```

### Per-process ID namespacing
**Source:** `tests/integration/forecast-snapshots.test.ts:10-11`
**Apply to:** all new integration tests (`const run = process.pid.toString(); const id = (v) => `${v}-${run}`;`)

### Lockfile / pinning parity
**Source:** `package.json:6-10` (`packageManager`, `engines`)
**Apply to:** `.gitattributes` (`* text=auto eol=lf`), `.npmrc` (`engine-strict=true`), workflow (`pnpm/action-setup@v6` with no `version` input, `cache: pnpm`) — one source of truth, no hardcoded versions.

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `.github/workflows/ci.yml` | config (CI) | batch pipeline | No `.github/` directory exists [VERIFIED in research]; use RESEARCH.md Pattern 4 skeleton (all inputs verified) as the source of truth |
| `.gitattributes` | config | — | File does not exist; content specified in RESEARCH Code Examples (`* text=auto eol=lf`, `*.png binary`) |
| `.npmrc` | config | — | File does not exist; single line `engine-strict=true` (RESEARCH Standard Stack) |

---

## Metadata

**Analog search scope:** repo root (`package.json`, `turbo.json`, `playwright*.config.ts`), `apps/web/` (eslint config + package.json), `scripts/`, `tests/integration/`, `tests/e2e/` (glob for portable specs)
**Files scanned:** ~10 full reads + 2 searches (6 analogs read in full)
**Pattern extraction date:** 2026-10-20
**Upstream sources:** `07-CONTEXT.md` (read), `07-RESEARCH.md` (read in full, lines 1-548)
