# Phase 7: CI Pipeline & Quality Gates - Research

**Researched:** 2026-10-20
**Domain:** GitHub Actions CI, lint/test/build quality gates, DB-layer immutability enforcement
**Confidence:** HIGH (all load-bearing facts verified directly against the repo this session)

<user_constraints>
## User Constraints (from CONTEXT.md — verbatim)

### Implementation Decisions

All implementation choices are at the agent's discretion — pure infrastructure phase. Use ROADMAP phase goal, success criteria, research findings, and codebase conventions to guide decisions.

Research-informed defaults to respect (from .planning/research/SUMMARY.md and PITFALLS.md):
- Hosted GitHub Actions on ubuntu-latest; actions/checkout@v6, actions/setup-node@v7, pnpm/action-setup@v5+ reading `packageManager`.
- Integration tests are Linux-only with Docker; missing Docker must FAIL, not skip. Windows runners cannot run containers (actions/runner#904).
- CI must NEVER call live external providers (free-tier budget).
- Extend flat ESLint config to apps/api, apps/api-e2e, workers/* before lint becomes a required gate.
- CI uses the cross-platform scripts/verify-release-integration.mjs path; E2E live-stack tests shell out to cmd.exe (Windows-only) and are excluded from the default CI job.
- CI-04: mutation-rejection tests prove snapshot/receipt tables reject UPDATE/DELETE at the DB layer.
- .gitattributes + Node/pnpm pins for parity.

### Deferred Ideas

None — discussion stayed within phase scope.

*(Research correction to a locked default: `apps/api-e2e` does not exist in this workspace — the real workspace is `apps/* = {api, web}`, `workers/* = {data-sync}`, `packages/* = {config, database, domain, football-data}` [VERIFIED: workspace directory listing 2026-10-20]. The lint-extension target list below reflects the real layout. Also: current `pnpm/action-setup` major is **v6**, not v5 — see Standard Stack.)*
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CI-01 | GitHub Actions pipeline on every push/PR: frozen-lockfile install, schema verification, typecheck, lint, unit tests, integration tests, build | Root scripts already compose this exact chain (`verify:release:*`, `typecheck`, `test`, `build`) [VERIFIED: package.json:19-21] — CI replicates them step-by-step in `.github/workflows/ci.yml` (NOT by calling `pnpm verify:release`, which drags in Windows-only E2E) |
| CI-02 | Integration tests on Linux runners with Docker; fail (never skip) when Docker unavailable; never call live providers | `scripts/verify-release-integration.mjs` is already cross-platform and fails loudly (`execFileSync("docker", …)` throws on missing Docker) [VERIFIED: scripts/verify-release-integration.mjs:10,52-55]; it provisions owned postgres:18-alpine/redis:8-alpine containers, migrates, and runs `vitest --project integration` with hermetic env |
| CI-03 | Lint covers all workspace applications and packages before becoming a required gate | Only `apps/web` has `eslint.config.mjs` + `lint` script today; the other 6 packages have no lint script so `turbo run lint` silently no-ops on them — see Standard Stack + Architecture Patterns for the exact extension |
| CI-04 | CI-enforced mutation-rejection tests protect immutable snapshot and receipt tables against UPDATE and DELETE at the DB layer | DB triggers **already exist** for every snapshot/receipt table (verbatim enumeration below) and most mutation-rejection tests already exist in `tests/integration/` — NO schema migration needed; CI-04 = close the remaining test gaps and make the integration project a required CI gate |
</phase_requirements>

## Summary

This phase is ~90% wiring and ~10% new code. The v1.0 codebase already contains every gate component the ROADMAP asks for: a composable release chain in root `package.json` (`verify:release:prerequisites` → frozen-lockfile install → `prisma validate` → typecheck → unit tests → Docker-backed integration harness → build) [VERIFIED: package.json:19-21], a cross-platform Docker harness `scripts/verify-release-integration.mjs` that owns postgres:18-alpine/redis:8-alpine containers, runs `prisma migrate deploy`, injects `DATABASE_URL`/`REDIS_URL`, and executes the Vitest `integration` project [VERIFIED: scripts/verify-release-integration.mjs:37-71,82-89], and PostgreSQL append-only triggers on all frozen tables with mutation-rejection tests covering most of them. What does **not** exist: any `.github/` directory [VERIFIED: Test-Path .github → False], lint beyond `apps/web`, `.gitattributes`, `.nvmrc`, `.npmrc`/engine-strict [VERIFIED: glob found none of the three].

The largest resolved research flag: **CI-04 needs no schema migration.** Every snapshot/receipt table named in the requirement already carries a `BEFORE UPDATE OR DELETE` trigger created by shipped migrations (verbatim trigger definitions with file:line citations in Architecture Patterns). Existing integration tests already prove rejection for `ForecastSnapshot`, `ForecastScore`, `SettlementReceipt`, `ManualOddsSnapshot`/`ManualOddsSelection`, `ValueSettlement` (UPDATE only), and `ValueReceipt` (UPDATE only). CI-04's real work is one new/extended integration test file closing the gaps (`ValueReceipt` DELETE, `ValueSettlement` DELETE, `ClosingOddsObservation` UPDATE+DELETE, `ForecastMarket`, `ResultVersion`, `SourceObservation`) plus making the integration project a required CI job.

The second resolved flag: **the portable E2E subset is exactly two specs** — `evidence-scorecard.spec.ts` and `team-evidence-live.spec.ts`. Their stacks (`live-evaluation-stack.ts`, `live-evidence-stack.ts`) are already cross-platform (platform-conditional `cmd.exe`/`corepack` spawn and `taskkill`/`process.kill`), own their own Docker Postgres, migrate, self-seed deterministic data, and build/spawn api+web themselves [VERIFIED: tests/e2e/live-evaluation-stack.ts:20-27,55-60]. Everything in `playwright.phase06.config.ts` (release-journey, release-degradation, release-accessibility, methodology, operator-overview, operator-recovery, privacy-retention) depends on `live-provider-stack.ts`, which hardcodes `cmd.exe`/`taskkill` [VERIFIED: tests/e2e/live-provider-stack.ts:82-85,47] and is therefore Windows-only — but note it uses a **local stub provider at 127.0.0.1:3241 with deterministic provider factories** [VERIFIED: tests/e2e/live-provider-stack.ts:12,80-81], so the exclusion is process-management, never provider budget. The nine default-config specs (walking-skeleton, public-shell, fixture-discovery, forecast-comparison, forecast-workbench, pipeline-replay, provider-degradation, reconciliation-review, team-evidence) assume an externally provisioned, pre-seeded database via inherited `DATABASE_URL` and are excluded from the default CI job in Phase 7 (flagged in Open Questions).

**Primary recommendation:** Build one `ci.yml` on `ubuntu-latest` with three jobs — `quality` (install → schema → typecheck → lint-all → unit+web tests → build), `integration` (`node scripts/verify-release-integration.mjs` directly — no wrapper), and `e2e-portable` (new `playwright.ci.config.ts` without webServer running the two portable specs) — while extending flat ESLint to the six unlintered packages and adding one `mutation-rejection.test.ts` integration file for the CI-04 gaps.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Pipeline definition & triggering | CI (GitHub Actions) | — | Single `ci.yml` on push/PR; branch protection on `main` makes checks required |
| Install / pinning parity (Node, pnpm, line endings) | CI + repo config | Dev host | `packageManager`/`engines` pins + `.gitattributes` make frozen-lockfile and tests behave identically on Windows dev and Linux CI |
| Schema verification | CI job step | packages/database | `prisma validate` via existing `verify:release:schema` — no live DB needed |
| Lint | Package tier (each workspace package) | turbo graph | ESLint flat config lives per-package; `turbo run lint` fans out; every package must declare a `lint` script or the gate is a silent no-op |
| Unit tests | Vitest `unit` project (root) | apps/web vitest | Root `pnpm test` = unit project + web project [VERIFIED: package.json:15] |
| Integration tests (Docker Postgres/Redis) | CI job (Linux only) | scripts/ harness | Only Linux runners can run containers (actions/runner#904); the harness fails loudly when Docker is absent |
| Immutability enforcement | Database tier (Postgres triggers) | tests/integration | Triggers are the enforcement mechanism; tests are the CI proof; repository code never UPDATEs these tables |
| Portable E2E (2 specs) | CI job (Linux only) | tests/e2e self-managed stacks | Stacks own Docker lifecycle; no live providers anywhere |
| Live-release E2E (7 specs) | Dev host (Windows) | — | `cmd.exe`-hardcoded process management; stays a local release gate (`pnpm verify:release`) |
| Branch protection / required checks | GitHub repo settings | — | Manual/operator step (API or UI) — a pipeline nobody is forced to pass is decorative |

## Standard Stack

### Core (no new runtime dependencies — CI-only additions)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| GitHub Actions | hosted, `ubuntu-latest` | CI runner | Already the platform of record (origin = github.com/VadyaLegolas/bet-stats, branch `main`) [VERIFIED: git remote/branch]; Linux runners are the only ones that can run Docker containers |
| `actions/checkout` | `@v6` | Repo checkout | Locked default from CONTEXT |
| `actions/setup-node` | `@v7` | Node 24 + pnpm store cache | `node-version: 24` matches `engines.node ">=24.0.0 <25"` [VERIFIED: package.json:7-10]; `cache: pnpm` keys on the lockfile |
| `pnpm/action-setup` | **`@v6`** (current major — CONTEXT said v5+; v6 is what exists now) | pnpm install | Official README: `version` input "is optional when there is a packageManager or devEngines.packageManager field" — repo pins `packageManager: "pnpm@10.34.5"` [VERIFIED: package.json:6] so omit `version` entirely [VERIFIED: github.com/pnpm/action-setup README, fetched 2026-10-20]. Note: `pnpm/setup@v1` exists but requires pnpm v11+ — repo is on pnpm 10, so `pnpm/action-setup@v6` is the correct action |
| `eslint` | `9.39.5` (match apps/web exactly [VERIFIED: apps/web/package.json:25]) | Lint gate | Already a workspace dep; `eslint-config-next@16.3.3` peer allows `eslint >=9.0.0` [VERIFIED: npm registry] |
| `typescript-eslint` | `8.72.0` [VERIFIED: npm registry] | TS lint for node packages | Official flat-config tooling for api/workers/packages; peer-supports eslint `^8.57 \|\| ^9 \|\| ^10` and TS `>=4.8.4 <6.1.0` (TS 5.9.3 OK) [VERIFIED: npm registry] |
| `globals` | pin a 17.x [VERIFIED: npm registry latest 17.13.0] | Node globals for flat configs | Companion to typescript-eslint flat configs |
| Docker | preinstalled on `ubuntu-latest` | postgres:18-alpine / redis:8-alpine harness | Used by existing harness; no service-container config needed because the harness publishes random loopback ports itself |

### Supporting (already present — reuse, do not re-build)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `scripts/verify-release-integration.mjs` | in-repo | Owned-container Docker harness + `prisma migrate deploy` + integration project run | The single integration entry point for CI (`node scripts/verify-release-integration.mjs`) |
| Vitest `unit`/`integration` projects | 4.1.11 [VERIFIED: package.json:29; vitest.config.ts:14-39] | Test fan-out | `pnpm test` (unit+web) and the harness (integration) |
| `playwright.ci.config.ts` | NEW file, `@playwright/test` 1.62.1 | webServer-less Playwright config for the two portable specs | E2E CI job only |
| `@playwright/test` browsers | 1.62.1 | chromium | `playwright install chromium --with-deps` in the E2E job |
| `.gitattributes` | NEW file | LF normalization | `* text=auto eol=lf` — protects `pnpm-lock.yaml` and Prisma files from CRLF drift (Pitfall 1) |
| `.npmrc` | NEW file | `engine-strict=true` | Turns the existing `engines` pin into an enforced failure locally and in CI |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `pnpm/action-setup@v6` + `actions/setup-node@v7` | `pnpm/setup@v1` (single action, installs runtime too) | `pnpm/setup` requires pnpm v11+; repo pins pnpm 10.34.5 — rejected for now; revisit on a pnpm major bump |
| Testcontainers for Node | Existing `verify-release-integration.mjs` harness | Milestone research confirmed Testcontainers is NOT in the repo; the hand-rolled harness already satisfies the need (owned containers, migrate, exact cleanup) — adding Testcontainers now is churn with zero capability gain |
| GitHub `services:` containers | Owned `docker run` harness | `services:` gives fixed ports and no per-run ownership/migrate/seed lifecycle; the harness already does more |
| ESLint flat config at repo root only | Per-package `eslint.config.mjs` + `lint` scripts | Root-only config breaks `turbo run lint` fan-out and Next's config scoping; per-package scripts (web already has one) are the turbo-native shape |

**Installation (root devDependencies):**
```bash
pnpm add -Dw typescript-eslint globals eslint@9.39.5
```
(eslint may stay only in apps/web if the node-package configs are placed per-package with their own devDeps — prefer root so one version rules the workspace.)

**Version verification performed 2026-10-20:** `npm view typescript-eslint version` → 8.72.0; `npm view eslint version` → 10.13.0 (do NOT upgrade to 10 in this phase — apps/web pins 9.39.5 and eslint-config-next declares `eslint >=9.0.0`; a major bump mid-phase is out of scope); `npm view globals version` → 17.13.0; `npm view eslint-config-next@16.3.3 peerDependencies` → `{ eslint: ">=9.0.0", typescript: ">=3.3.1" }` — all [VERIFIED: npm registry].

## Package Legitimacy Audit

> Required because this phase installs external packages (`typescript-eslint`, `globals`).

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| typescript-eslint | npm | latest patch published 2026-10-19 ("too-new" = recency heuristic only) | 55,569,191/wk | github.com/typescript-eslint/typescript-eslint | SUS [WARNING: flagged as suspicious — verify before using] | Flagged — planner adds `checkpoint:human-verify` before install. Note: this is the official TypeScript-ESLint project with 55M weekly downloads; the SUS verdict is purely the "too-new patch" signal. Mitigation: pin the exact version `8.72.0` |
| globals | npm | latest patch published 2026-10-01 ("too-new" = recency heuristic only) | 153,593,968/wk | github.com/sindresorhus/globals | SUS [WARNING: flagged as suspicious — verify before using] | Flagged — planner adds `checkpoint:human-verify` before install. sindresorhus/globals is the canonical package; pin an exact 17.x version |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** `typescript-eslint`, `globals` — both `SUS` solely on the "too-new latest patch" signal with authoritative repos and 55M+/153M+ weekly downloads; planner inserts a `checkpoint:human-verify` task before the install step and pins exact versions.

## Architecture Patterns

### System Architecture Diagram

```
push / pull_request ──► github.com/VadyaLegolas/bet-stats (main)
                              │
                              ▼
                 .github/workflows/ci.yml (ubuntu-latest)
                              │
        ┌─────────────────────┼──────────────────────────┐
        ▼                     ▼                          ▼
   [quality]            [integration]              [e2e-portable]
   checkout@v6          checkout@v6                checkout@v6
   pnpm/action-setup@v6 pnpm/action-setup@v6       pnpm/action-setup@v6
   setup-node@v7 (24,   setup-node@v7 (24)         setup-node@v7 (24)
     cache: pnpm)          │                         │
     │                     │                         │
   pnpm install          pnpm install               pnpm install
   --frozen-lockfile     --frozen-lockfile          --frozen-lockfile
     │                     │                         │
   verify:release:schema  scripts/verify-           playwright install
   (prisma validate)      release-integration.mjs   chromium --with-deps
     │                     │                         │
   typecheck (turbo)        ├─ docker run postgres:18-alpine
   lint (turbo, ALL         ├─ docker run redis:8-alpine
     packages — NEW)        ├─ prisma migrate deploy
     │                     ├─ vitest --project integration
   pnpm test                 │    └─ mutation-rejection tests
     ├─ vitest unit           │       (CI-04: UPDATE/DELETE on
     └─ web vitest            │        frozen tables must THROW)
     │                     └─ docker rm (owned cleanup)
   build (turbo)            │
     │                     ✗ NO continue-on-error,
     │                       NO docker-skip branch:
     │                       missing Docker = red job
     ▼                     ▼                          ▼
              branch protection on main (operator step)
              required checks: quality, integration, e2e-portable
                              │
                              ▼
   deliberate breakage (type error / failing test / UPDATE on a
   frozen table) ──► red pipeline ──► merge blocked  (CI-04 proof)

NOT in default CI (Windows-only process mgmt, local stub provider):
   pnpm verify:release ──► playwright.phase06.config.ts
      (release-journey/degradation/accessibility, methodology,
       operator-overview/recovery, privacy-retention via
       live-provider-stack.ts ── hardcoded cmd.exe)
```

No CI step ever reaches a live football provider: the integration project uses fixture payloads/local stubs, and the only "provider stack" in E2E is a loopback stub at `127.0.0.1:3241` with deterministic provider factories [VERIFIED: tests/e2e/live-provider-stack.ts:12,80].

### Recommended Project Structure (new files only)

```
.github/
└── workflows/
    └── ci.yml                    # quality + integration + e2e-portable jobs
eslint.config.mjs                 # NEW root flat config base for node packages (optional shared base)
apps/api/eslint.config.mjs        # NEW — node/TS flat config
workers/data-sync/eslint.config.mjs  # NEW
packages/{config,database,domain,football-data}/eslint.config.mjs  # NEW (or shared root config + per-package script)
playwright.ci.config.ts           # NEW — no webServer; testDir tests/e2e; two portable specs
tests/integration/mutation-rejection.test.ts  # NEW — CI-04 gap closure
.gitattributes                    # NEW — LF normalization
.npmrc                            # NEW — engine-strict=true
```

Plus `lint` scripts added to: `apps/api`, `workers/data-sync`, `packages/config`, `packages/database`, `packages/domain`, `packages/football-data` (all currently have only `build`/`typecheck` (+`dev`/`prisma` where applicable) [VERIFIED: package.json script enumeration 2026-10-20]).

### Pattern 1: The integration job calls the existing harness verbatim
**What:** `run: node scripts/verify-release-integration.mjs` is the entire integration job body after install.
**When to use:** Always — do not wrap, do not re-implement, do not add `continue-on-error`.
**Why it works headless in CI (each verified):**
- Cross-platform process management (plain `docker`/`node` exec, no shell builtins) [VERIFIED: scripts/verify-release-integration.mjs:9-11].
- Owned unique container names `bet-stats-release-pg-${pid}-${Date.now()}`, random loopback port publish `--publish 127.0.0.1::5432`, deterministic `docker rm --force` cleanup in `finally` [VERIFIED: lines 24-34,37-38].
- `prisma migrate deploy` with injected `DATABASE_URL` before tests [VERIFIED: lines 46-50].
- Injects `DATABASE_URL`, `REDIS_URL`, and default test-only secrets `OPERATOR_PROXY_SIGNING_SECRET ?? "release-integration-signing-secret-32-bytes"`, `OPERATOR_AUTHORIZED_SUBJECTS ?? "local-test-operator"` [VERIFIED: lines 84-89] — no repo secrets needed, so fork PRs work.
- pnpm resolution: `process.env.npm_execpath` (set when invoked via `pnpm run`) with an APPDATA fallback for Windows dev — on CI always invoke it as `pnpm exec node scripts/...` or directly after a pnpm-script context so `npm_execpath` is present, else it throws `RELEASE_PNPM_CLI_UNAVAILABLE` [VERIFIED: lines 59-61].
- Fail-loud: missing Docker → `execFileSync("docker", …)` throws → nonzero exit; the `catch` stops owned containers and rethrows [VERIFIED: lines 10,52-55].

### Pattern 2: Lint extension — flat config per package + turbo fan-out
**What:** Add a `lint` script (`eslint .`) + flat `eslint.config.mjs` to each of the 6 unlintered packages. Node packages use `typescript-eslint`'s flat preset; `apps/web` keeps its Next config untouched.
**When to use:** This phase, BEFORE lint becomes a required gate (CI-03 ordering is explicit in the requirement).
**Key detail:** `turbo run lint` only runs packages that declare a `lint` script — today it silently "passes" while covering one package. After extension, all 7 packages declare one. Optionally add a tiny root meta-test asserting every workspace `package.json` has a `lint` script so a future package can't silently escape the gate.

**Skeleton (apps/api/eslint.config.mjs; same shape for workers/packages):**
```typescript
// Source: typescript-eslint official "flat config" usage; verified versions this session
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**"] },
  ...tseslint.configs.recommended,
  { languageOptions: { globals: globals.node, parserOptions: { projectService: true } } },
);
```
Note: keep type-aware rules (`projectService`) scoped — milestone PITFALLS warns type-aware linting across the whole monorepo is slow; `recommended` (non-type-checked) plus a narrow `recommendedTypeChecked` override on `src/` is the safe default.

### Pattern 3: CI-04 mutation-rejection test — prove triggers, do not re-create them
**What:** One integration test file that attempts raw `UPDATE`/`DELETE` against every frozen snapshot/receipt table and asserts the Postgres trigger raises.
**Why no migration is needed:** triggers already exist — verified verbatim this session:

| Table | Trigger (verbatim DDL) | Source |
|-------|------------------------|--------|
| `ForecastSnapshot` | `CREATE TRIGGER "ForecastSnapshot_guarded_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "ForecastSnapshot" FOR EACH ROW EXECUTE FUNCTION guard_forecast_snapshot();` | [VERIFIED: packages/database/prisma/migrations/20260905_phase03_forecast_value_snapshots/migration.sql:141] |
| `ForecastMarket` | `CREATE TRIGGER "ForecastMarket_append_only" BEFORE UPDATE OR DELETE ON "ForecastMarket" FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();` | [VERIFIED: …20260905…/migration.sql:172] |
| `ManualOddsSnapshot` | `CREATE TRIGGER "ManualOddsSnapshot_append_only" BEFORE UPDATE OR DELETE ON "ManualOddsSnapshot" FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();` | [VERIFIED: …20260905…/migration.sql:173] |
| `ManualOddsSelection` | `CREATE TRIGGER "ManualOddsSelection_append_only" BEFORE UPDATE OR DELETE ON "ManualOddsSelection" FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();` | [VERIFIED: …20260905…/migration.sql:174] |
| `ValueReceipt` | `CREATE TRIGGER "ValueReceipt_append_only" BEFORE UPDATE OR DELETE ON "ValueReceipt" FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();` | [VERIFIED: …20260905…/migration.sql:175] |
| `SettlementReceipt` | `CREATE TRIGGER "SettlementReceipt_guarded_append_only" BEFORE INSERT OR UPDATE OR DELETE ON "SettlementReceipt" FOR EACH ROW EXECUTE FUNCTION guard_settlement_receipt();` | [VERIFIED: packages/database/prisma/migrations/20260908_phase04_settlement_receipts/migration.sql:75] |
| `ValueSettlement` | `CREATE TRIGGER "ValueSettlement_guarded_append_only" BEFORE INSERT OR UPDATE OR DELETE ON "ValueSettlement" FOR EACH ROW EXECUTE FUNCTION guard_value_settlement();` | [VERIFIED: packages/database/prisma/migrations/20260908_phase04_value_settlements/migration.sql:64] |
| `ClosingOddsObservation` | `IF TG_OP IN ('UPDATE','DELETE') THEN RAISE EXCEPTION 'ClosingOddsObservation is immutable'; END IF;` … `CREATE TRIGGER "ClosingOddsObservation_guarded_append_only" BEFORE INSERT OR UPDATE OR DELETE ON "ClosingOddsObservation" FOR EACH ROW EXECUTE FUNCTION guard_closing_odds_observation();` | [VERIFIED: …20260908_phase04_value_settlements/migration.sql:66-67] |
| `ForecastScore` | `CREATE TRIGGER "ForecastScore_guarded_append_only" BEFORE INSERT OR UPDATE OR DELETE ON "ForecastScore" FOR EACH ROW EXECUTE FUNCTION guard_forecast_score();` | [VERIFIED: packages/database/prisma/migrations/20260908_phase04_z_score_facts/migration.sql:35] |
| `SourceObservation` | `CREATE TRIGGER "SourceObservation_append_only" BEFORE UPDATE OR DELETE ON "SourceObservation" FOR EACH ROW EXECUTE FUNCTION "prevent_historical_evidence_mutation"();` (function: `RAISE EXCEPTION '% is append-only', TG_TABLE_NAME`) | [VERIFIED: packages/database/prisma/migrations/20260829_historical_evidence/migration.sql:37-40] |
| `ResultVersion` | `CREATE TRIGGER "ResultVersion_append_only" BEFORE UPDATE OR DELETE ON "ResultVersion" FOR EACH ROW EXECUTE FUNCTION "prevent_historical_evidence_mutation"();` | [VERIFIED: …20260829_historical_evidence/migration.sql:41] |

**Existing mutation-rejection test coverage (already in `tests/integration/`, runs under the `integration` project):**
- `ForecastSnapshot` UPDATE+DELETE `/immutable/i` [VERIFIED: tests/integration/forecast-snapshots.test.ts:45-46]
- `ForecastScore` UPDATE+DELETE `/immutable/i` + forged-INSERT guard [VERIFIED: tests/integration/forecast-scoring.test.ts:123-125]
- `SettlementReceipt` UPDATE+DELETE `/immutable/i` [VERIFIED: tests/integration/settlement.test.ts:69-70] and again in phase-04-security [VERIFIED: tests/integration/phase-04-security.test.ts:74-75]
- `ManualOddsSnapshot` UPDATE + `ManualOddsSelection` DELETE `/immutable/i` [VERIFIED: tests/integration/manual-odds.test.ts:31-32]
- `ValueSettlement` UPDATE `/immutable/i` [VERIFIED: tests/integration/value-settlement.test.ts:85]
- `ValueReceipt` UPDATE `/immutable/i` [VERIFIED: tests/integration/value-receipt.test.ts:60]

**CI-04 gap-closure list (new assertions in one new `tests/integration/mutation-rejection.test.ts` or by extending the existing files):**
1. `ValueReceipt` DELETE (only UPDATE is tested today).
2. `ValueSettlement` DELETE (only UPDATE is tested today).
3. `ClosingOddsObservation` UPDATE + DELETE → assert `'ClosingOddsObservation is immutable'` (message verified verbatim above).
4. `ForecastMarket` UPDATE + DELETE (no test today; shared `reject_append_only_change()` function, whose message matches `/immutable/i` — same function as ManualOddsSnapshot whose test already asserts `/immutable/i` [VERIFIED inference from the two reads above]).
5. `ResultVersion` UPDATE + DELETE → assert `/append-only/i` (message format `'% is append-only'` verified above — note this does NOT match `/immutable/i`; use the right pattern per table).
6. Optional hardening (same file, same cost): `SourceObservation` UPDATE.

**Skeleton (follows the existing house pattern exactly):**
```typescript
// Pattern source: tests/integration/forecast-snapshots.test.ts:45-46 (existing, passing)
await expect(
  prisma.$executeRawUnsafe(`UPDATE "ClosingOddsObservation" SET "decimalOdds"='9' WHERE id=$1`, id("close-v1")),
).rejects.toThrow(/immutable/i);
await expect(
  prisma.$executeRawUnsafe(`DELETE FROM "ClosingOddsObservation" WHERE id=$1`, id("close-v1")),
).rejects.toThrow(/immutable/i);
```
Seeding note: the guarded tables have FK/validation triggers on INSERT (`ValueReceipt_validate_pair` requires an exact forecast+odds pair [VERIFIED: …20260905…/migration.sql:169,157-168]; `ManualOddsSnapshot_validate_replacement` validates `replacesOddsId` [VERIFIED: …20260905…/migration.sql:155]) — the cheapest test strategy is to reuse the minimal seeding already present in `value-receipt.test.ts` / `manual-odds.test.ts` / `forecast-snapshots.test.ts` (they already construct valid fixtures), and keep each table's pair-validation INSERT semantics untouched.

### Pattern 4: The quality job mirrors the release chain, step by step
**What:** CI does NOT call `pnpm verify:release` — that chain ends in the Windows-only phase06 E2E [VERIFIED: package.json:21]. Instead the quality job runs the portable steps in the same order the chain already defines:
`pnpm install --frozen-lockfile` → `pnpm verify:release:schema` → `pnpm typecheck` → `pnpm lint` → `pnpm test` → `pnpm build`.
**Why:** identical semantics to the trusted local release gate, minus the Windows-only tail; schema verification needs no DB (dummy `DATABASE_URL` is set inside the script itself [VERIFIED: package.json:20]).
**Job skeleton:**
```yaml
# .github/workflows/ci.yml (skeleton — planner fills exact action versions)
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
      - uses: pnpm/action-setup@v6        # version input omitted — reads packageManager pnpm@10.34.5
      - uses: actions/setup-node@v7
        with: { node-version: 24, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm verify:release:schema
      - run: pnpm typecheck
      - run: pnpm lint
      - run: pnpm test                     # vitest unit project + @bet-stats/web tests
      - run: pnpm build
  integration:
    runs-on: ubuntu-latest                 # Linux-only: containers unsupported elsewhere
    steps:
      - uses: actions/checkout@v6
      - uses: pnpm/action-setup@v6
      - uses: actions/setup-node@v7
        with: { node-version: 24, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec prisma generate --schema packages/database/prisma/schema.prisma  # if generate is not a build side-effect; verify in Wave 0
      - run: node scripts/verify-release-integration.mjs   # fails loudly when Docker missing
  # e2e-portable: same setup + `pnpm exec playwright install chromium --with-deps`
  #               + `pnpm exec playwright test -c playwright.ci.config.ts`
```

### Anti-Patterns to Avoid
- **Calling `pnpm verify:release` in CI:** drags in the phase06 E2E suite whose stack hardcodes `cmd.exe` — the job can never go green on Linux [VERIFIED: package.json:21 + live-provider-stack.ts:82-85].
- **`continue-on-error: true` or docker-skip branches on the integration job:** converts CI-02's fail-loud contract into skip-and-green (Pitfall 1 / gotcha C10).
- **Making lint required before extending it:** `turbo run lint` today covers 1 of 7 packages — requiring it now would certify a mostly-unlinted repo (CI-03's explicit ordering).
- **`pull_request_target` or repo secrets in PR jobs:** secret-exfiltration vector for fork PRs; the harness needs no real secrets (dummy defaults injected) [VERIFIED: scripts/…:87-88].
- **E2E against the dev database or any provider endpoint:** CI must never set provider tokens; deterministic factories and stub origins only.
- **Windows runners in the matrix for integration:** container operations are Linux-only (`actions/runner#904`); a Windows leg gets typecheck/lint/unit only, and Phase 7 needs no Windows leg at all (dev host covers that reality).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Docker Postgres/Redis lifecycle for integration tests | Custom `docker run` shell in ci.yml | `scripts/verify-release-integration.mjs` (already shipped) | Owned unique names, random-port publish, migrate-before-test, deterministic cleanup, injected env — re-implementing loses the exact-PID/name ownership discipline Phase 2/6 built |
| DB immutability enforcement | Repository-level "reject update calls" code guards | Existing Postgres triggers + integration proof tests | Triggers protect against ANY writer (future workers, psql, migrations-gone-wrong); code guards only protect against one code path (Pitfall 11) |
| pnpm/Node version pinning | Hardcoded `version:` in workflow + ad-hoc nvm usage | `packageManager` field (read by pnpm/action-setup@v6) + `engines` + `.npmrc` engine-strict + `.gitattributes` | One source of truth; frozen-lockfile behavior identical on Windows dev and Linux CI |
| Lint orchestration | Per-package bespoke lint shell scripts | `turbo run lint` fan-out over per-package `lint` scripts | turbo already models the graph (`lint` dependsOn `^lint`) [VERIFIED: turbo.json:12-14] |
| E2E server bootstrapping in CI | Scripting `pnpm dev` + readiness polls in yaml | Self-managing Playwright stacks (`live-evaluation-stack.ts`, `live-evidence-stack.ts`) via `playwright.ci.config.ts` | They already own container+migrate+seed+build+spawn+teardown with supervision and diagnostic tails |
| Action version pinning | Floating `@main` action refs | Pinned majors from the locked defaults (`checkout@v6`, `setup-node@v7`, `pnpm/action-setup@v6`) | Supply-chain hygiene (V8); SHA-pinning is optional hardening, not required for MVP |

**Key insight:** every gate the ROADMAP names already has a proven local implementation whose semantics were hardened across Phases 1-6 (owned-resource cleanup, fail-closed readiness, exact-PID supervision). CI's job is to replay those exact implementations on Linux, not to author new ones.

## Common Pitfalls

### Pitfall 1: Lint gate that lints one package and certifies six
**What goes wrong:** `turbo run lint` exits 0 while only `apps/web` has a lint script; the "required check" becomes decorative and the first api/workers lint error surfaces months later.
**Why it happens:** turbo skips packages without the script silently; `lint` config exists only under `apps/web` [VERIFIED: eslint config glob → single file apps/web/eslint.config.mjs].
**How to avoid:** add `lint` scripts to all 7 packages in the same PR that creates the workflow; optional meta-test asserting every workspace package declares `lint`.
**Warning signs:** `turbo run lint` duration ≈ 1 s; CI lint step output mentions only `@bet-stats/web`.

### Pitfall 2: Integration job that skips when Docker is missing
**What goes wrong:** A misconfigured runner or self-hosted fallback reports green without ever executing the DB suite — exactly gotcha C10.
**Why it happens:** defensive `if docker info; then … fi` guards written "to be safe."
**How to avoid:** no guards in the workflow; the harness itself throws on missing Docker (verified behavior). The job has exactly one test command and no conditionals.
**Warning signs:** integration job duration under ~60 s; "0 tests" in vitest summary; any `continue-on-error`.

### Pitfall 3: Lockfile/line-ending drift between Windows dev and Linux CI
**What goes wrong:** `pnpm install --frozen-lockfile` fails on the runner or, worse, passes while dev machines keep rewriting `pnpm-lock.yaml` — Pitfall 1's root cause.
**Why it happens:** no `.gitattributes`; git's `core.autocrlf` on the Windows host rewrites checked-in text files.
**How to avoid:** commit `.gitattributes` with `* text=auto eol=lf` (plus explicit `*.png binary` if any assets exist); `engine-strict=true` in `.npmrc`; CI cache keyed on the lockfile via `cache: pnpm`.
**Warning signs:** lockfile diffs on every pull with no dependency change; CI-only Prisma client type errors (generated client differs by platform — always `prisma generate` before typecheck in CI if not already a build step).

### Pitfall 4: CI burning the free-tier provider budget
**What goes wrong:** a future job adds "just a quick live smoke" and quietly consumes the API-Football 100 req/day allowance (Pitfall 12).
**Why it happens:** the quota guard lives inside the app's provider policy layer; tooling outside the app bypasses it.
**How to avoid:** CI workflows carry NO provider env vars/secrets at all; the only provider-touching code path in CI-bound tests uses deterministic factories (`providerFactories: deterministic` [VERIFIED: tests/e2e/live-provider-stack.ts:80]) and loopback stubs. Any future live smoke is a separate `workflow_dispatch` job with explicit budget accounting — never on `pull_request`.
**Warning signs:** provider request ledger rows from Actions IPs/hours; any workflow file containing `API_FOOTBALL` or `FOOTBALL_DATA` secret names.

### Pitfall 5: Assertion-pattern mismatch in new mutation tests
**What goes wrong:** new tests assert `/immutable/i` against tables whose triggers raise `'… is append-only'` (ResultVersion, SourceObservation) — the test fails for the wrong reason or, if wrapped in a broad catch, passes for the wrong reason.
**Why it happens:** two different guard functions exist (`reject_append_only_change()` vs `prevent_historical_evidence_mutation()`) with different messages (both verified verbatim above).
**How to avoid:** per-table expected messages from the table in Pattern 3; prefer `rejects.toThrow(/append-only/i)` for the historical-evidence family and `/immutable/i` for the phase03/04 family.
**Warning signs:** mutation test green while raw SQL succeeds (assertion accidentally matching the seeding error instead).

### Pitfall 6: Playwright config confusion — webServer + self-managed stack double-boot
**What goes wrong:** running the two portable specs under the default `playwright.config.ts` boots its `webServer` api+web (ports 3001/3000, which require an inherited `DATABASE_URL` the config never sets [VERIFIED: playwright.config.ts:22-48]) in addition to the spec-owned stacks (ports 3220/3221) — the webServer readiness poll fails and the run dies before any test.
**Why it happens:** the default config was written for the v1.0 locally-provisioned flow; the self-managing stacks predate it.
**How to avoid:** new `playwright.ci.config.ts` with NO `webServer` and explicit test file list (`evidence-scorecard.spec.ts`, `team-evidence-live.spec.ts`); do not reuse any existing config unmodified.
**Warning signs:** `SERVICE_NOT_READY` from playwright's webServer watchdog; port 3001 bind errors in CI logs.

## Code Examples

All verified patterns below come from in-repo sources read this session; external sources cited inline.

### CI job bodies (Pattern 4 skeleton above) — key verified inputs
```yaml
# Pins that exist in the repo TODAY:
# package.json:6   "packageManager": "pnpm@10.34.5"   ← pnpm/action-setup@v6 reads this
# package.json:7-8 "engines": { "node": ">=24.0.0 <25", "pnpm": "10.34.5" }
```

### Mutation-rejection test house pattern (existing, passing)
```typescript
// Source: tests/integration/forecast-snapshots.test.ts:45-46
await expect(prisma.$executeRawUnsafe(`UPDATE "ForecastSnapshot" SET assumptions='["changed"]' WHERE id=$1`, id("forecast-v1"))).rejects.toThrow(/immutable/i);
await expect(prisma.$executeRawUnsafe(`DELETE FROM "ForecastSnapshot" WHERE id=$1`, id("forecast-v1"))).rejects.toThrow(/immutable/i);
```

### Portable E2E invocation
```bash
# After: pnpm install --frozen-lockfile && pnpm exec playwright install chromium --with-deps
pnpm exec playwright test -c playwright.ci.config.ts tests/e2e/evidence-scorecard.spec.ts tests/e2e/team-evidence-live.spec.ts
# Both specs manage their own postgres:18-alpine container, migrate, seed, build+spawn api/web,
# and tear down — cross-platform spawn verified in tests/e2e/live-evaluation-stack.ts:21-25.
# Linux CI needs corepack available for the stacks' `corepack pnpm --filter … build` calls —
# add `corepack enable` before the E2E step (Node 24 still bundles corepack; see Assumptions A1).
```

### .gitattributes (new)
```
* text=auto eol=lf
*.png binary
*.jpg binary
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| pnpm/action-setup@v5 | pnpm/action-setup@v6 current; pnpm/setup@v1 exists for pnpm ≥11 | 2026 (verified from official README 2026-10-20) | Use @v6 with no `version` input; repo stays on pnpm 10.34.5 |
| ESLint "eslintrc" format | Flat config (`defineConfig`/`tseslint.config`) — apps/web already flat [VERIFIED: apps/web/eslint.config.mjs:1-3] | already adopted in repo | New configs are flat; no `.eslintrc` anywhere |
| ESLint 9.x as current | eslint 10.13.0 is latest on npm | verified 2026-10-20 | Stay on 9.39.5 this phase (eslint-config-next peer `>=9.0.0`); upgrade is a separate deliberate phase |
| Skipping DB tests when Docker absent | Fail-loud harness (this repo's own contract since Phase 2/6) | repo convention | CI inherits it verbatim |

**Deprecated/outdated:**
- `pnpm/action-setup@v5`: superseded by v6 in the same action line — bump to v6.
- Any `describe.skip`-on-missing-Docker pattern: forbidden by CI-02.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Node 24 as installed by `actions/setup-node@v7` still bundles `corepack` (needed by the E2E stacks' `corepack pnpm …` calls); `corepack enable` may be required | Code Examples / E2E job | E2E job fails at build step — fix by running `corepack enable` (harmless if already enabled) or by pre-building packages with the action-installed pnpm; LOW impact, detected on first CI run |
| A2 | `prisma generate` output is not committed and must run before `typecheck` in CI (harness runs `migrate deploy`, which generates the client, but the quality job has no DB step) | Pattern 4 skeleton | Quality job typecheck fails on generated-client types — fix by adding an explicit `prisma generate` step; MEDIUM likelihood, trivial fix |
| A3 | GitHub Actions is enabled on the (private-or-public) repo and the plan's minutes budget covers 3 ubuntu jobs per PR | Environment Availability | Pipeline cannot run until enabled/upgraded — operator action; LOW likelihood |
| A4 | The two portable E2E specs pass on Linux unchanged (they were authored on Windows; cross-platform branches exist, but timing/path assumptions may lurk) | E2E subset | e2e-portable job flakes or fails on first runs — budget a fix-forward task; MEDIUM likelihood |
| A5 | `verify:release:schema` (prisma validate with a dummy DATABASE_URL) runs without a live DB on Linux as it does on Windows | CI-01 chain | Schema step fails — replace with `prisma validate` against the real service container in the integration job; LOW likelihood (validate is offline by design) |

**If a claim is missing from this table:** it was verified with a Read/tool call this session and is tagged `[VERIFIED: …]`.

## Open Questions

1. **Default-config E2E specs (9 files) in CI later?**
   - What we know: they rely on inherited `DATABASE_URL` + pre-seeded deterministic state and the default `webServer` [VERIFIED: playwright.config.ts:22-48].
   - What's unclear: whether a small deterministic seed script can make them hermetic on a fresh container.
   - Recommendation: exclude from Phase 7 default CI (scope discipline); revisit in a fast-follow once CI exists — the two portable specs + full integration project already give CI-01/CI-02 strong coverage.
2. **One CI job vs three?**
   - Recommendation: three (`quality`, `integration`, `e2e-portable`) for parallelism and clear required-check semantics; merge `e2e-portable` into `integration` if Actions minutes matter (single install+build amortized). Either satisfies the requirements.
3. **Turbo remote cache:** deferred per milestone research ("Defer: CI remote caching") — do not add in this phase.
4. **Secret scanning (gitleaks step):** nice-to-have V8 hardening from PITFALLS security table; not required by CI-01..04. Recommend as an optional final task, not a gate.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| GitHub Actions (repo `VadyaLegolas/bet-stats`, branch `main`) | all jobs | ✓ (repo exists; Actions enablement assumed — A3) | hosted | — |
| Docker on `ubuntu-latest` | integration + e2e jobs | ✓ (preinstalled on GitHub-hosted Linux runners) | runner default | none needed |
| Node 24 | all jobs (also enforced by `verify:release:prerequisites`) | ✓ via `actions/setup-node@v7` | 24.x | engines pin blocks other majors |
| pnpm 10.34.5 | install | ✓ via `pnpm/action-setup@v6` reading `packageManager` | 10.34.5 | — |
| corepack (bundled with Node 24) | E2E stacks' `corepack pnpm` calls | ✓ expected (A1); add `corepack enable` step | bundled | build packages with action pnpm first |
| Playwright chromium | e2e job | ✗ preinstalled → install in job | 1.62.1 | `playwright install chromium --with-deps` |
| Live football providers | — | deliberately absent from CI | — | deterministic factories/stubs |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** Playwright browsers (installed in-job); corepack enablement (one step).

## Validation Architecture

> `.planning/config.json` has `workflow.nyquist_validation: true` [VERIFIED: .planning/config.json:24] — section included.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.11 (unit + integration projects) + Playwright 1.62.1 (E2E); apps/web has its own vitest config |
| Config file | `vitest.config.ts` (root, defines `unit` and `integration` projects [VERIFIED: vitest.config.ts:14-39]); `playwright.ci.config.ts` (new) |
| Quick run command | `pnpm vitest run --project unit` (plus `pnpm --filter @bet-stats/web test` for web) |
| Full suite command | `pnpm test && node scripts/verify-release-integration.mjs` (integration needs Docker) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CI-01 | Full chain runs on push/PR | workflow smoke + manual proof | push a branch; observe all jobs; then the deliberate-breakage drill (type error → red → revert) | ❌ Wave 0 (`ci.yml`) |
| CI-02 | Integration on Linux Docker; fails when Docker missing; no live providers | integration | `node scripts/verify-release-integration.mjs` (locally on Docker host; on CI as a job). Fail-loud proof: harness throws on missing `docker` CLI [VERIFIED: scripts:10] — optionally add a unit test asserting `runOwnedIntegrationGate` rejects when `start()` throws | ✅ harness exists |
| CI-03 | Lint covers all packages | lint + meta-check | `pnpm lint` (turbo, all 7 packages after extension); optional meta-test: every workspace package.json declares `lint` | ❌ Wave 0 (6 configs + 6 scripts) |
| CI-04 | Frozen tables reject UPDATE/DELETE in CI | integration (DB-backed) | `pnpm exec vitest run --project integration tests/integration/mutation-rejection.test.ts` | ⚠️ Wave 0 (partial — extend existing files; triggers already exist) |

### Sampling Rate
- **Per task commit:** `pnpm vitest run --project unit` + `pnpm typecheck` + `pnpm lint` (< 60 s target).
- **Per wave merge:** full local `node scripts/verify-release-integration.mjs` + `pnpm test`.
- **Phase gate:** first green run of all three CI jobs on `main` + the deliberate-breakage drill on a throwaway PR (success criterion 4).

### Wave 0 Gaps
- [ ] `.github/workflows/ci.yml` — three jobs per Pattern 4.
- [ ] `lint` scripts + flat configs for `apps/api`, `workers/data-sync`, `packages/config`, `packages/database`, `packages/domain`, `packages/football-data`.
- [ ] `playwright.ci.config.ts` — no webServer, two portable specs.
- [ ] `tests/integration/mutation-rejection.test.ts` — CI-04 gap list (6 items in Pattern 3).
- [ ] `.gitattributes`, `.npmrc` (`engine-strict=true`).
- [ ] Branch protection on `main` requiring the three checks (operator step, plan task with `gh api` commands).

## Security Domain

> `security_enforcement: true`, `security_asvs_level: 1` [VERIFIED: .planning/config.json:47-48].

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | no auth surfaces in this phase |
| V3 Session Management | no | — |
| V4 Access Control | no (existing OperatorGuard already integration-tested) | — |
| V5 Input Validation | incidental | `prisma validate` schema gate in CI; Zod already validates provider input at runtime |
| V6 Cryptography | no | no crypto in this phase; workflow uses only dummy test secrets |
| V8 Software Integrity (build pipeline) | **yes** | `--frozen-lockfile` install; pinned action majors; `packageManager`-driven pnpm; lockfile-keyed cache; no `pull_request_target`; `permissions: contents: read`; optional gitleaks step |

### Known Threat Patterns for this phase

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Tampered dependencies / lockfile bypass | Tampering | `pnpm install --frozen-lockfile` as the only install path; cache keyed on lockfile hash |
| Fork-PR secret exfiltration | Info disclosure | No repo secrets in PR-triggered jobs; harness injects dummy values [VERIFIED: scripts:87-88]; `pull_request` (not `pull_request_target`); top-level `permissions: contents: read` |
| CI consuming the free-tier provider budget | Repudiation of budget | No provider credentials anywhere in workflows or CI env; deterministic provider factories in all CI-bound tests |
| Workflow injection via branch-name/script interpolation | Tampering | Use `run:` with no `${{ }}` interpolation into shell strings (env-var indirection if ever needed) |
| Over-privileged action versions / tag re-pointing | Tampering | Pin majors (`@v6/@v7`); optional SHA-pinning hardening task |

## Sources

### Primary (HIGH confidence — verified with Read/tool calls this session)
- Root `package.json` (read in full) — `packageManager`, `engines`, the `verify:release*` chain, `test`/`typecheck`/`lint` scripts.
- `turbo.json` (read in full) — task graph incl. `lint` dependsOn.
- `vitest.config.ts` (read in full) — `unit` and `integration` project definitions.
- `scripts/verify-release-integration.mjs` (read in full) — Docker harness, env injection, fail-loud behavior.
- `playwright.config.ts` / `playwright.phase06.config.ts` (read in full) — webServer env, globalSetup chain.
- `tests/e2e/live-evaluation-stack.ts:1-60`, `live-provider-stack.ts:1-96` — cross-platform vs cmd.exe-only process management, deterministic provider factories, local stub origin.
- Migration SQL (read at cited line ranges) — verbatim trigger DDL for all frozen tables (Pattern 3 table).
- `tests/integration/` existing mutation-rejection assertions (forecast-snapshots:45-46, forecast-scoring:123-125, settlement:69-70, manual-odds:31-32, value-settlement:85, value-receipt:60, phase-04-security:74-75).
- `apps/web/eslint.config.mjs`, `apps/web/package.json` — current lint reality (flat config, eslint 9.39.5).
- Workspace enumeration (shell) — package scripts per package; absence of `apps/api-e2e`, `.github/`, `.gitattributes`, `.nvmrc`, `.npmrc`.
- `.planning/config.json:24,47-48` — nyquist validation + security enforcement flags.

### Secondary (HIGH/MEDIUM — official external docs fetched this session)
- [VERIFIED: github.com/pnpm/action-setup README (raw fetch 2026-10-20)] — `version` optional with `packageManager`; current major v6; `pnpm/setup@v1` requires pnpm ≥11.
- [VERIFIED: npm registry, `npm view` 2026-10-20] — typescript-eslint 8.72.0 (+peer ranges), eslint latest 10.13.0, globals 17.13.0, eslint-config-next@16.3.3 peers.
- [VERIFIED: gsd-tools package-legitimacy check] — typescript-eslint/globals verdicts (both SUS on "too-new" recency signal only).

### Tertiary (MEDIUM — carried from milestone research, not re-verified)
- `actions/runner#904` — container operations Linux-only (cited consistently in SUMMARY.md/PITFALLS.md and CONTEXT defaults).
- GitHub-hosted `ubuntu-latest` image ships Docker preinstalled (community-canonical; not fetched this session).
- Node 24 bundles corepack (deprecated-but-present; removal targeted at Node 25) — Assumption A1.

## Metadata

**Confidence breakdown:**
- Standard Stack: **HIGH** — all versions verified against the npm registry and the repo's own pins; action majors verified from the official action README.
- Architecture: **HIGH** — every gate component, harness behavior, trigger definition, and test assertion verified by reading the source this session; the CI workflow skeleton is composed only from verified inputs.
- Pitfalls: **HIGH** — each pitfall is grounded in a verified repo fact (lint coverage gap, config double-boot, message-pattern mismatch, cmd.exe hardcoding) plus milestone-research-cited runner constraints.
- E2E portability on Linux (A4): **MEDIUM** — code paths are cross-platform by construction, but first-run behavior on a Linux runner is unproven.

**Research date:** 2026-10-20
**Valid until:** 2026-11-20 (30 days — action majors and hosted-runner images drift slowly; re-verify only if the first CI runs surface runner-image changes)
