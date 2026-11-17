# Phase 10: Performance Audit and Budgets - Pattern Map

**Mapped:** 2026-11-16
**Files analyzed:** 10 (4 new, 6 modified)
**Analogs found:** 8 / 10 (2 config/artifact files have no in-repo analog — use RESEARCH.md patterns)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `scripts/perf-audit.mjs` (new) | utility (audit harness + runner + assertions) | file-I/O + process orchestration | `tests/e2e/live-evaluation-stack.ts` + `scripts/verify-release-integration.mjs` | exact (stack) / exact (gate) |
| `scripts/perf/perf-budget.json` (new) | config | read-only, fail-closed parsed | — none (no versioned JSON budget config exists) | none |
| `scripts/perf/perf-receipts/*.json` (new) | data artifact (committed receipt) | file-I/O, closed-field write | — none (no committed perf receipts); receipt discipline from Phase-8 D-15 | none |
| `tests/unit/perf-audit.test.ts` (new) | test (pure functions: median, assertion, receipt schema) | transform | `tests/unit/ci-workflow-contract.test.ts` | exact |
| `.github/workflows/ci.yml` (modified) | config (CI workflow) | batch | itself (`e2e-portable` job) | exact |
| `tests/unit/ci-workflow-contract.test.ts` (modified) | test (executable policy over ci.yml) | transform | itself | exact |
| `apps/web/app/fixtures/[fixtureId]/forecast-workbench.tsx` (modified) | component ("use client", interactive) | event-driven / request-response | itself (split source) + Next 16 lazy-loading guide | exact (source of moved code) |
| `apps/web/app/fixtures/[fixtureId]/forecast-comparison-panel.tsx` (new module) | component | event-driven | `forecast-workbench.tsx` (the moved code, lines 63–115) | exact |
| `tests/unit/forecast-comparison-ui.test.tsx`, `tests/unit/odds-draft-ui.test.tsx` (modified) | test (import updates after split) | transform | themselves | exact |
| root `package.json` (modified) | config (devDependency `lighthouse`) | config | itself | exact |

**Next 16 warning (from `apps/web/AGENTS.md`):** before touching any web code — especially dynamic imports — read `apps/web/node_modules/next/dist/docs/01-app/02-guides/lazy-loading.md`. Next 16 has breaking changes vs. training data.

---

## Pattern Assignments

### `scripts/perf-audit.mjs` (utility, orchestration + file-I/O)

**Analog (stack lifecycle):** `tests/e2e/live-evaluation-stack.ts` — the closest existing harness that builds a **production** web bundle and starts it with `next start` on the owned stack. The audit script copies this shape almost verbatim, changing only: `next dev`→`next build` + `next start` (already prod here), port constants, seed data, and adding `NEXT_DIST_DIR`.

**Imports + process helpers** (lines 1–27 — copy conventions: `node:`-prefixed builtins, ESM, compact helpers):
```ts
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const databaseRoot = resolve(process.cwd(), "packages/database");
const prismaCli = resolve(databaseRoot, "node_modules/prisma/build/index.js");

function docker(...args: string[]): string { return execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); }
function corepack(...args: string[]): void { execFileSync(process.platform === "win32" ? "cmd.exe" : "corepack", process.platform === "win32" ? ["/d", "/s", "/c", "corepack", ...args] : args, { cwd: process.cwd(), stdio: "pipe" }); }
function start(args: string[], env: NodeJS.ProcessEnv): ChildProcess {
  return spawn(process.platform === "win32" ? "cmd.exe" : "corepack", process.platform === "win32" ? ["/d", "/s", "/c", "corepack", ...args] : args, { cwd: process.cwd(), env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
}
async function wait(url: string): Promise<void> { let cause: unknown; for (let i = 0; i < 120; i += 1) { try { const response = await fetch(url); if (response.ok) return; cause = response.status; } catch (error) { cause = error; } await new Promise((done) => setTimeout(done, 500)); } throw new Error(`SERVICE_NOT_READY: ${String(cause)}`); }
```
> The Windows/POSIX dual spawn is load-bearing: the audit script must run both on the local Windows machine and the ubuntu CI runner. Copy it, do not simplify to bare `corepack`.

**Owned Postgres + migrate deploy + readiness poll** (lines 55–58):
```ts
docker("run", "--detach", "--name", state.container, "--env", "POSTGRES_PASSWORD=postgres", "--env", "POSTGRES_DB=bet_stats", "--publish", "127.0.0.1::5432", "postgres:18-alpine");
for (let i = 0; i < 60; i += 1) { try { docker("exec", state.container, "pg_isready", "-U", "postgres", "-d", "bet_stats"); break; } catch (error) { if (i === 59) throw error; await new Promise((done) => setTimeout(done, 500)); } }
const pgPort = docker("port", state.container, "5432/tcp").split(":").at(-1); if (!pgPort) throw new Error("POSTGRES_PORT_MISSING"); state.url = `postgresql://postgres:postgres@127.0.0.1:${pgPort}/bet_stats`;
execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], { cwd: databaseRoot, env: { ...process.env, DATABASE_URL: state.url }, stdio: "pipe" });
```

**Prod API + prod web start with the exact eligibility env** (lines 59–62 — this is the D-05 core; note the audit script keeps `ELIGIBILITY_ALLOWED_REGIONS`, `ELIGIBILITY_REGION`, `ELIGIBILITY_AGE_ACKNOWLEDGED` but must **omit `ELIGIBILITY_CHECKED_AT`** so the proxies stamp per-request — the only deliberate divergence from this analog, see Pitfall 5 in RESEARCH.md):
```ts
corepack("pnpm", "--filter", "@bet-stats/config", "build"); corepack("pnpm", "--filter", "@bet-stats/domain", "build"); corepack("pnpm", "--filter", "@bet-stats/database", "build");
const prisma = createPrismaClient(state.url); try { await seed(prisma); } finally { await prisma.$disconnect(); } corepack("pnpm", "--filter", "@bet-stats/api", "build");
state.apiPid = start(["pnpm", "--filter", "@bet-stats/api", "dev"], { DATABASE_URL: state.url, API_HOST: "127.0.0.1", API_PORT: "3221", POSTGRES_READY: "true", REDIS_READY: "true", NODE_ENV: "test", ELIGIBILITY_ALLOWED_REGIONS: "PL" }).pid;
corepack("pnpm", "--filter", "@bet-stats/web", "build"); state.webPid = start(["pnpm", "--filter", "@bet-stats/web", "exec", "next", "start", "--hostname", "127.0.0.1", "--port", "3220"], { API_ORIGIN: EVALUATION_API_ORIGIN, DISPLAY_TIME_ZONE: "Europe/Warsaw", NODE_ENV: "production", ELIGIBILITY_REGION: "PL", ELIGIBILITY_AGE_ACKNOWLEDGED: "true", ELIGIBILITY_CHECKED_AT: new Date().toISOString() }).pid;
await wait(EVALUATION_WEB_ORIGIN);
```

**Seeded ForecastSnapshot shape** (line 41 — the audit seed reuses this exact prisma call, one fixture id + ≥2 `ISSUED` snapshots):
```ts
await prisma.forecastSnapshot.create({ data: { id: `evaluation-forecast-${suffix}`, fixtureId, kind: "PRE_MATCH", state: "ISSUED", revision: 1, cutoff, modelVersion: model, modelHash: "model-hash", configVersion: "forecast-config-v1", configHash: "config-hash", inputHash: `input-${suffix}`, evidenceFingerprint: `evidence-${suffix}`, sourceRefs: [], probabilities: {}, confidence: {}, assumptions: [], receipt: {}, issuedAt: new Date(cutoff.getTime() + 1000), markets: { create: { id: `evaluation-market-${suffix}`, market: "ONE_X_TWO", probabilities: [{ selection: "HOME", probability: 0.5 }, { selection: "DRAW", probability: 0.3 }, { selection: "AWAY", probability: 0.2 }] } } } });
```

**Cleanup-on-failure pattern** (lines 63–65 + stop/cleanup helpers lines 25–26 — owned resources are killed exactly, never left behind):
```ts
} catch (error) { cleanup(state); throw error; }
```

**Analog (fail-closed gate script):** `scripts/verify-release-integration.mjs` — the repo's existing "Node script = CI gate with exit code" convention (ESM `.mjs`, helpers, main-entry guard). Copy these conventions for the audit script's assertion/exit layer:

**Main entry, fail-closed exit code** (lines 95–97):
```js
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runOwnedIntegrationGate();
}
```

**Readiness helper with bounded retries** (lines 13–21):
```js
async function waitFor(container, command, delayMs) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { docker("exec", container, ...command); return; }
    catch (error) { if (attempt === 59) throw error; await new Promise((resolveWait) => setTimeout(resolveWait, delayMs)); }
  }
}
```

**Divergence note:** unlike this analog (which injects fallback env like `OPERATOR_PROXY_SIGNING_SECRET ?? "..."`), the audit script must **not** invent fallbacks — missing budget config field or missing LHR audit id fails loudly (Pitfall 8: no `?? 0`, no `Number(undefined)`).

---

### `scripts/perf/perf-budget.json` + `scripts/perf/perf-receipts/*.json` (config + committed receipts)

**No in-repo analog** — no versioned budget config or committed perf receipt exists. Source the shapes from RESEARCH.md §Code Examples (`receipt` object with `schemaVersion: "perf-receipt-v1"`, per-metric `{median, runs}`) and the Phase-8 D-15 discipline already applied in `tests/unit/` (closed fields, never spread `process.env`, secret-shaped values forbidden — add a unit test for this, mirroring how Phase 8 tested redaction).

The closed-field receipt philosophy already exists in domain code — e.g. value receipts persist an explicit `receipt: {...}` object field (see `tests/e2e/live-evaluation-stack.ts:44`) — never an open dump.

---

### `tests/unit/perf-audit.test.ts` (test, transform)

**Analog:** `tests/unit/ci-workflow-contract.test.ts` — the repo's canonical "contract test reads a repo file and asserts fail-closed invariants" pattern.

**File-reading + CRLF-normalized contract style** (lines 1–29):
```ts
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflowPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../.github/workflows/ci.yml");
// Normalize line endings: the Windows dev host checks files out as CRLF
// (core.autocrlf), CI checkouts are LF — the policy must hold for both.
const source = readFileSync(workflowPath, "utf8").replace(/\r\n/g, "\n");
```

**Assertion idioms to copy:** `expect(source).not.toContain(...)` for forbidden constructs (lines 83–97), loop-with-message over extracted lines (lines 119–127), and message-first failure strings (`"ci.yml must not use ..."`). Apply the same to: median-of-3 computation (property: odd count, per-metric not per-run), fail-closed extraction (renamed audit id / non-numeric / missing `resource-summary` item → loud failure, never `undefined` passthrough), and receipt schema (closed field set; reject unknown keys; forbid secret-shaped values).

**Source-scanning precedent:** `tests/unit/responsible-copy.test.ts:67-74` reads the workbench raw source and asserts exact substrings — after the D-09 split, this test's expectations must be re-checked against the new module(s):
```ts
const workbench = readFileSync(resolve("apps/web/app/fixtures/[fixtureId]/forecast-workbench.tsx"), "utf8");
expect(workbench).toContain("JSON.stringify(result, null, 2)");
expect(workbench).toContain("navigator.clipboard.writeText(canonicalReceipt)");
```

---

### `.github/workflows/ci.yml` (modified, config/batch)

**Analog:** itself — the new `performance-budget` job clones the `e2e-portable` job body (lines 58–77), which is the most recently added job and the one that already installs Playwright chromium:

```yaml
  e2e-portable:
    runs-on: ubuntu-latest
    # The two portable specs own their containers, migrations, seeds and process
    # lifecycle via the live-evidence-stack globalSetup; no credentials are set.
    timeout-minutes: 25
    steps:
      - uses: actions/checkout@v6
      - uses: pnpm/action-setup@v6
      - uses: actions/setup-node@v7
        with:
          node-version: 24
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec turbo run build --filter=@bet-stats/config --filter=@bet-stats/domain --filter=@bet-stats/football-data --filter=@bet-stats/database --filter=@bet-stats/data-sync
      - run: corepack enable
      - run: pnpm exec playwright install chromium --with-deps
      - run: pnpm exec playwright test -c playwright.ci.config.ts tests/e2e/evidence-scorecard.spec.ts tests/e2e/team-evidence-live.spec.ts
```

**Hard constraints from the executable policy (`tests/unit/ci-workflow-contract.test.ts`)** — every new job step must satisfy these or the `quality` job's own test suite fails:
- Every `pnpm install` line must contain `--frozen-lockfile` (lines 150–159).
- Every `uses:` ref must match `owner/repo@vN` exact major tag — no floating refs (lines 118–127); sanctioned majors: `actions/checkout@v6`, `pnpm/action-setup@v6`, `actions/setup-node@v7`.
- No `continue-on-error`, no `secrets.`, no `paths:`/`paths-ignore:` filters, no `${{ }}` interpolation inside `run:` bodies (lines 70–108).
- `timeout-minutes` ceiling convention (~20–25) with a justification comment (lines 19–21, 44, 62).
- Comments above steps explain *why* (e.g. lines 53–55, 71–73) — mirror this style for the new job.

**⚠️ The contract test itself must be updated in the same task:** the job-list assertions (lines 31–52) enumerate exactly `quality`, `integration`, `e2e-portable` via `jobBlock()` slicing; the `runs every job on ubuntu-latest` loop (lines 40–52) has a hardcoded job list. Adding `performance-budget` requires extending these lists (and its contract assertions: chromium reuse, `node scripts/perf-audit.mjs`, no skip constructs) — otherwise the policy guards only three of four jobs.

---

### `apps/web/app/fixtures/[fixtureId]/forecast-workbench.tsx` (modified, component, event-driven)

**Analog:** itself — the D-09 split moves existing code out; the remaining file is the pattern for what stays.

**Code to move — `ForecastComparisonPanel` + its support helpers (lines 63–106):**
```tsx
function SourceRefItem({ source, name }: { source: ComparisonSourceRef; name?: string | undefined }) {
  return <li title={`Матч: ${source.fixtureId} · отпечаток: ${source.payloadHash} · обновление источника: ${source.sourceUpdatedAt ?? "нет"}`}>
    <strong>{name ?? shortFixtureId(source.fixtureId)}</strong> · {formatUtc(source.effectiveAt)} · отпечаток <code>{shortFingerprint(source.payloadHash)}</code> · наблюдено {formatUtc(source.observedAt)}
  </li>;
}
// ... sourceRefList (68-71), revisionColumns (88-95) ...
export function ForecastComparisonPanel({ comparison }: { comparison: ForecastComparisonDto }) {
  // lines 97-106: heading, material check, sourceRefList, ResponsiveEvidence, details dl, disclaimer
}
```

**Code to move — `ValueOutcomeSection` (lines 108–115):** the post-interaction value result + full receipt JSON section (`OUTCOME_COPY` constants, lines 16–20, move with it).

**Code that stays eager (odds-entry core, D-09):** `availabilityReasonCopy` (25), `validateOddsFields`/`buildOddsSubmission`/`canonicalizeClientOdds` (27–38), `selectStableSnapshot`/`forecastOptionLabel` (39–40), `initializeComparisonPair`/`swapComparisonPair` (44–49), the `ForecastWorkbench` component itself (117–169) including its `useEffect` fetch logic (lines 142–150 — do NOT touch mount-time fetches, Pitfall 10).

**Test-coupled exports that must remain importable (Pitfall 4):** `tests/unit/forecast-comparison-ui.test.tsx:5` imports `availabilityReasonCopy, ForecastComparisonPanel, ForecastWorkbench, initializeComparisonPair, swapComparisonPair, ValueOutcomeSection`; `tests/unit/odds-draft-ui.test.tsx:12` imports from the same module. After the split, update these import paths to the new modules.

**Dynamic import pattern — no in-repo analog** (grep for `next/dynamic` returns zero matches): use the RESEARCH.md Pattern 3 / Next 16 lazy-loading guide form:
```tsx
import dynamic from "next/dynamic";
const ForecastComparisonPanel = dynamic(
  () => import("./forecast-comparison-panel").then((m) => m.ForecastComparisonPanel),
  { loading: () => <p role="status">Загружаем результат сравнения…</p> },
);
```
Constraints (verified in research): `dynamic()` calls at module top level; `ssr: false` only inside Client Components; a Server Component dynamically importing a Client Component does **not** code-split — so the split lives *inside* this "use client" file, never in `page.tsx`.

**Static import that stays untouched** — `apps/web/app/fixtures/[fixtureId]/page.tsx:7` (the Server Component keeps its static import; only the internal chunking changes):
```tsx
import { ForecastWorkbench } from "./forecast-workbench";
```

---

### New split modules (`forecast-comparison-panel.tsx`, optionally `value-outcome-section.tsx`)

**Analog:** the moved code itself (workbench lines 63–115) plus the repo's component conventions visible in that file:
- Russian user-facing copy with proper `role="status"` / `role="alert"` / `aria-labelledby` attributes and the mandatory responsible-gambling disclaimer line («Вероятности — это оценки, а не гарантии…», line 104).
- Labels come from `../../../components/enum-labels` (`forecastLimitationLabel`, `oddsMarketLabel`, `oddsSelectionLabel`, `valueReasonLabel`) — keep importing, never inline English.
- Tables render via the shared `ResponsiveEvidence` component (`../../../components/responsive-evidence`) with typed `EvidenceColumn<T>` column definitions (lines 74–95).
- Module layout: colocated with the route (`apps/web/app/fixtures/[fixtureId]/`), named exports, no barrel files, `"use client"` inherited from the importing boundary (do not add a second directive — verify against the Next 16 docs on shared client components).

---

### root `package.json` (modified)

**Analog:** itself. `lighthouse` joins the existing root devDependencies (lines 25–35) as an exact-pinned entry (`lighthouse: "13.6.0"` — matching the exact-version convention of `@playwright/test: "1.62.1"`, `vitest: "4.1.11"`), installed with `pnpm add -D -w`. It is imported only by `scripts/perf-audit.mjs`, never from `apps/web` code (web deps stay the verified minimal set: `@bet-stats/domain`, `next`, `react`, `react-dom`).

---

## Shared Patterns

### Owned-container lifecycle (Windows/POSIX dual)
**Source:** `tests/e2e/live-evidence-stack.ts:21-35, 78-110`; `tests/e2e/live-evaluation-stack.ts:20-27, 63-65`
**Apply to:** `scripts/perf-audit.mjs`
- `execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })` for all docker calls.
- Unique container name `bet-stats-<purpose>-${process.pid}-${Date.now()}`; `docker rm --force` in `finally`/catch-path cleanup.
- `pg_isready` poll (60 × 500 ms) before migrate; `docker port` → `postgresql://postgres:postgres@127.0.0.1:<port>/bet_stats`.
- Spawn via `cmd.exe /d /s /c corepack ...` on win32, bare corepack on POSIX; cleanup via `taskkill /pid <pid> /T /F` (win32) or `process.kill(-pid, "SIGTERM")` (POSIX).

### Production web build with distDir isolation
**Source:** `apps/web/next.config.ts:10-13` + `tests/e2e/live-evidence-stack.ts:136` + `tests/e2e/live-evaluation-stack.ts:62`
**Apply to:** `scripts/perf-audit.mjs` (both `next build` and `next start`)
```ts
...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
```
The audit harness always sets `NEXT_DIST_DIR=.next-e2e` (07-02 precedent) so the developer's `next dev` on `.next` is never contended. Any harness invocation without it is a bug (Pitfall 6).

### Eligibility env pinning (honest audit preconditions)
**Source:** `tests/e2e/live-evaluation-stack.ts:61-62`; divergence justified by `packages/domain/src/eligibility.ts:34-66` (fail-closed guard, 1-hour stamp max age)
**Apply to:** `scripts/perf-audit.mjs`
- API: `ELIGIBILITY_ALLOWED_REGIONS: "PL"`, `POSTGRES_READY: "true"`, `REDIS_READY: "true"`, `NODE_ENV: "test"`.
- Web prod server: `ELIGIBILITY_REGION: "PL"`, `ELIGIBILITY_AGE_ACKNOWLEDGED: "true"`, `DISPLAY_TIME_ZONE: "Europe/Warsaw"`, `NODE_ENV: "production"`, `API_ORIGIN`.
- **Do NOT set `ELIGIBILITY_CHECKED_AT`** in the audit harness (unlike the evaluation-stack analog) — unset lets the proxies stamp per-request so long audits never serve a stale-denied page state.

### Fail-closed gates (anything unmeasurable fails loudly)
**Source:** `scripts/verify-release-integration.mjs:95-97` (exit-code entry), `tests/unit/ci-workflow-contract.test.ts` (no-skip policy for CI), Phase-07 discipline
**Apply to:** `scripts/perf-audit.mjs` assertions + `tests/unit/perf-audit.test.ts` + the CI job (no `continue-on-error`).
```js
// Budget assertion shape (fail-closed, from RESEARCH.md; unit-test these branches):
if (median === undefined || Number.isNaN(median)) fail(`UNMEASURABLE_${metric}`);
if (median > budget) fail(`${metric}: ${median} > budget ${budget}`);
```

### CI job conventions
**Source:** `.github/workflows/ci.yml:58-77` (job body), `tests/unit/ci-workflow-contract.test.ts` (executable policy)
**Apply to:** new `performance-budget` job + contract-test extension. Details in the ci.yml assignment above.

### Russian copy + a11y in components
**Source:** `apps/web/app/fixtures/[fixtureId]/forecast-workbench.tsx` (throughout)
**Apply to:** new split modules — `role="status"` for non-alarming async results, `role="alert"` for failures, mandatory disclaimer paragraphs, labels from `enum-labels.ts`, loading fallback text in Russian (e.g. `Загружаем результат сравнения…`).

---

## No Analog Found

| File | Role | Data Flow | Reason | Planner guidance |
|------|------|-----------|--------|------------------|
| `scripts/perf/perf-budget.json` | config | read-only | No versioned JSON budget/profile config exists in repo | Shape from RESEARCH.md Patterns 1–2 + Pitfall-2 sequencing (budgets pinned from measured medians, never invented) |
| `scripts/perf/perf-receipts/*.json` | data artifact | file-I/O write | No committed perf receipts; only in-DB receipts exist | Shape from RESEARCH.md receipt example + Phase-8 D-15 closed-field/redaction discipline; add unit test forbidding secret-shaped values |
| `next/dynamic` usage (any file) | component mechanism | — | Zero occurrences repo-wide (grep verified) | Use RESEARCH.md Pattern 3 verbatim (Next 16 lazy-loading guide); verify against `node_modules/next/dist/docs/01-app/02-guides/lazy-loading.md` before writing |

---

## Metadata

**Analog search scope:** `tests/e2e/`, `tests/unit/`, `scripts/`, `apps/web/app/fixtures/`, `apps/web/`, `.github/workflows/`, root `package.json`
**Files read in full:** `live-evidence-stack.ts`, `live-evaluation-stack.ts`, `ci.yml`, `playwright.ci.config.ts`, `forecast-workbench.tsx`, `page.tsx`, `next.config.ts`, `ci-workflow-contract.test.ts`, `verify-release-integration.mjs`, `responsible-copy.test.ts` (excerpt), `package.json`
**Tracked-source gate:** all named analogs verified with `git ls-files` — none is a gitignored mirror.
**Pattern extraction date:** 2026-11-16
