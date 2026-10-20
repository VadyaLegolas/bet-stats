---
phase: 07-ci-pipeline-quality-gates
plan: 1
type: execute
wave: 1
depends_on: []
files_modified:
  - .github/workflows/ci.yml
  - package.json
  - pnpm-lock.yaml
  - apps/api/eslint.config.mjs
  - apps/api/package.json
  - workers/data-sync/eslint.config.mjs
  - workers/data-sync/package.json
  - packages/config/eslint.config.mjs
  - packages/config/package.json
  - packages/database/eslint.config.mjs
  - packages/database/package.json
  - packages/domain/eslint.config.mjs
  - packages/domain/package.json
  - packages/football-data/eslint.config.mjs
  - packages/football-data/package.json
  - tests/unit/lint-coverage.test.ts
  - tests/integration/mutation-rejection.test.ts
autonomous: false
requirements: [CI-01, CI-03, CI-04]
user_setup: []
estimate:
  tokens: 115000
  raw_tokens: 115000
  tasks: 4
  confidence: low
must_haves:
  truths:
    - ".github/workflows/ci.yml exists and its quality job runs, in exact order: pnpm install --frozen-lockfile, pnpm verify:release:schema, pnpm typecheck, pnpm lint, pnpm test, pnpm build on ubuntu-latest with actions/checkout@v6, pnpm/action-setup@v6 (no version input), actions/setup-node@v7 (node-version 24, cache pnpm)"
    - "pnpm lint (turbo run lint) executes ESLint in all seven workspace packages (@bet-stats/api, @bet-stats/web, @bet-stats/data-sync, @bet-stats/config, @bet-stats/database, @bet-stats/domain, @bet-stats/football-data) and exits 0"
    - "Introducing one deliberate lint violation into any single package makes pnpm lint exit non-zero (negative probe executed and reverted within the task)"
    - "tests/unit/lint-coverage.test.ts passes and fails if any workspace package.json lacks scripts.lint or an eslint.config.mjs"
    - "tests/integration/mutation-rejection.test.ts rejects UPDATE and DELETE on ValueReceipt, ValueSettlement, ClosingOddsObservation and ForecastMarket (/immutable/i) and on ResultVersion and SourceObservation (/append-only/i) against a real migrated PostgreSQL via the owned-container Docker harness"
    - "Prohibition tokens (see ## Prohibitions) appear in zero artifacts produced by this plan (grep-verified)"
  artifacts:
    - .github/workflows/ci.yml (quality job)
    - package.json (scripts.test:integration:docker; devDependencies eslint@9.39.5, typescript-eslint@8.72.0, globals@17.13.0)
    - apps/api/eslint.config.mjs, workers/data-sync/eslint.config.mjs, packages/config/eslint.config.mjs, packages/database/eslint.config.mjs, packages/domain/eslint.config.mjs, packages/football-data/eslint.config.mjs
    - lint script entries in all six package.json files
    - tests/unit/lint-coverage.test.ts
    - tests/integration/mutation-rejection.test.ts
  key_links:
    - ci.yml quality job -> root package.json verify:release:/test:/typecheck:/lint:/build scripts (the workflow replays the trusted local release chain minus its Windows-only tail)
    - turbo run lint fan-out -> per-package lint scripts (today only apps/web declares one; this plan closes the gap so the gate certifies the workspace, not one package)
    - scripts/verify-release-integration.mjs owned containers -> vitest integration project -> tests/integration/mutation-rejection.test.ts (CI-04 proof)
    - Postgres append-only triggers (migrations 20260829/20260905/20260908) -> raw-SQL mutation assertions in the new integration test
---

<objective>
Build the Wave-0 (roadmap wave 1) artifacts of the Phase 7 pipeline: the CI workflow tracer with its quality job, full-workspace ESLint coverage (CI-03), and the CI-04 mutation-rejection gap-closure test. Integration/e2e jobs, repo pins and the live GitHub drill land in plans 2 and 3.

Purpose: prove the pipeline's command layer end-to-end on the trusted local chain before any job beyond `quality` exists, and close the six identified immutability test gaps so the integration gate carries CI-04 weight from its first CI run.

Output: `.github/workflows/ci.yml` (quality job), lint configs + scripts for the six unlintered packages with a coverage meta-test, `tests/integration/mutation-rejection.test.ts`.

<assumption_delta>
None. `gsd-tools assumption-delta scan 7` returned `detected: false` on 2026-10-20; all research assumptions (A1-A5) are same-day fresh. Two research claims were resolved by direct measurement this session and the corrected facts are baked into the tasks below: (1) generated Prisma client output `packages/database/src/generated/prisma` IS committed (59 tracked files, clean status) so research assumption A2 is FALSE — no `prisma generate` step is needed before typecheck; (2) `pnpm exec node -e "console.log(process.env.npm_execpath)"` prints MISSING (measured 2026-10-20), so the integration harness must be invoked through a `pnpm run` script context, not `pnpm exec` (see Task 1).
</assumption_delta>

<api_coverage_scan>
Phase 7 adds no outbound HTTP calls to any external provider (pure CI/infra). CI-02 requires the workflow itself to never call live providers — enforced by the credential-scan assertions in plan 2's workflow contract test. No external_apis block required; no {N}-api-coverage.json emitted.
</api_coverage_scan>

<execution_context>
@C:/Users/Vlad/.config/opencode/gsd-core/workflows/execute-plan.md
@C:/Users/Vlad/.config/opencode/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/07-ci-pipeline-quality-gates/07-CONTEXT.md
@.planning/phases/07-ci-pipeline-quality-gates/07-RESEARCH.md
@.planning/phases/07-ci-pipeline-quality-gates/07-PATTERNS.md
@.planning/phases/07-ci-pipeline-quality-gates/07-VALIDATION.md
@package.json
@turbo.json
@vitest.config.ts
@scripts/verify-release-integration.mjs
@tests/integration/forecast-snapshots.test.ts
@tests/integration/value-receipt.test.ts
@tests/integration/value-settlement.test.ts
@tests/unit/coverage-contract.test.ts
</context>

<tasks>

<task type="tracer">
  <name>Task 1: ci.yml quality-job tracer + integration harness script context</name>
  <files>.github/workflows/ci.yml, package.json</files>
  <read_first>07-RESEARCH.md (Pattern 4 skeleton, lines 273-307, and its verified pins), package.json (lines 6-21: packageManager pnpm@10.34.5, engines, verify:release:* scripts), turbo.json, scripts/verify-release-integration.mjs (lines 58-71: npm_execpath requirement), 07-PATTERNS.md (ci.yml pattern section)</read_first>
  <action>Create the directory .github/workflows and the file ci.yml containing ONLY the quality job in this task (integration and e2e-portable jobs are added by plan 2, Task 1/Task 2 — do not stub them). Exact workflow shape, copied from the RESEARCH Pattern 4 skeleton with these values: name: CI; on: push restricted to branches [main] plus pull_request with no filters; top-level permissions containing only contents: read; top-level concurrency with group `ci-${{ github.workflow }}-${{ github.ref }}` and cancel-in-progress: true (GitHub expression in the group key is allowed; it must NOT appear inside any run: body). The quality job runs on ubuntu-latest with steps in this exact order: (1) actions/checkout@v6, (2) pnpm/action-setup@v6 with NO version input (it reads packageManager pnpm@10.34.5), (3) actions/setup-node@v7 with node-version: 24 and cache: pnpm, (4) `pnpm install --frozen-lockfile`, (5) `pnpm verify:release:schema`, (6) `pnpm typecheck`, (7) `pnpm lint`, (8) `pnpm test`, (9) `pnpm build`. Keep run: bodies as bare commands — no shell interpolation. Add a one-line comment above the workflow noting least-privilege intent (permissions read-only). Second change, same task: add one script to root package.json scripts, alphabetically near test: `"test:integration:docker": "node scripts/verify-release-integration.mjs"`. Reason (measured 2026-10-20): scripts/verify-release-integration.mjs line 59 resolves process.env.npm_execpath, which is present only under a `pnpm run` script context — a bare `pnpm exec node …` prints MISSING and throws RELEASE_PNPM_CLI_UNAVAILABLE on Linux where the APPDATA fallback does not exist. Plan 2's integration job calls this script; create it now so the harness invocation contract exists before the job does. Note in a comment above the script line that the pnpm-run context is load-bearing. Do NOT call `pnpm verify:release` anywhere in the workflow (it tails into the Windows-only phase06 E2E and can never pass on Linux). Do not touch apps/web/eslint.config.mjs, turbo.json, or vitest.config.ts.</action>
  <verify>
    <automated>pnpm install --frozen-lockfile && pnpm verify:release:schema && pnpm typecheck && pnpm lint && pnpm test</automated>
  </verify>
  <acceptance_criteria>
    - ci.yml contains, in this order within the quality job: `pnpm install --frozen-lockfile`, `pnpm verify:release:schema`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.
    - ci.yml contains `permissions:` with `contents: read`, `pull_request:` without `pull_request_target`, `branches: [main]` under push, and a concurrency block with `cancel-in-progress: true`.
    - ci.yml references exactly three actions, with these exact strings: `actions/checkout@v6`, `pnpm/action-setup@v6`, `actions/setup-node@v7`; no run: line contains `${{`.
    - The automated verify chain exits 0 locally (engine WARN about Node v25 is expected on this host and is not a failure while .npmrc does not yet exist).
    - `pnpm build` exits 0 when run once locally (turbo build of all seven packages; first cold run may exceed 60 s — report the duration in the task summary).
    - package.json scripts includes `"test:integration:docker": "node scripts/verify-release-integration.mjs"` and `pnpm run test:integration:docker` starts the owned-container harness (a missing-Docker host must exit non-zero, never skip).
  </acceptance_criteria>
  <done>The quality job is fully wired and the local replay of its exact command chain is green and committed; the integration harness now has a pnpm-run invocation context usable by plan 2.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking-human">
  <name>Task 2: Package-legitimacy checkpoint before installing typescript-eslint and globals</name>
  <files>package.json</files>
  <read_first>07-RESEARCH.md (Package Legitimacy Audit table and Standard Stack version pins), .planning/PROHIBITED-WORDS.md if it exists</read_first>
  <action>Before any install, present the audit evidence to the human and wait for an explicit approval. The audit verdicts (07-RESEARCH.md): `typescript-eslint` latest patch 8.72.0 — verdict [SUS] solely on the "too-new patch" recency signal, 55,569,191 weekly downloads, official repo github.com/typescript-eslint/typescript-eslint; `globals` 17.13.0 — verdict [SUS] on the same recency signal, 153,593,968 weekly downloads, canonical repo github.com/sindresorhus/globals. Both get pinned to the exact versions above; eslint stays 9.39.5 workspace-wide (eslint 10 is explicitly out of scope this phase because apps/web pins 9.39.5 and eslint-config-next declares eslint >=9.0.0). Ask the human to open npmjs.com/package/typescript-eslint and npmjs.com/package/globals, confirm the repository links and versions match, and reply APPROVED. If either package shows a different repository, a [SLOP] signal, or the human refuses, abort the phase and report — do not install and do not substitute another linter. After APPROVED, proceed immediately to Task 3 (the install happens in Task 3, not here).</action>
  <verify>
    <automated>n/a — blocking human gate mandated by the Package Legitimacy Audit for [SUS] packages; resumption requires an APPROVED response recorded in the task summary</automated>
  </verify>
  <acceptance_criteria>
    - An APPROVED decision from the human is recorded before Task 3 runs `pnpm add`.
    - The exact pins to be installed are 8.72.0 (typescript-eslint), 17.13.0 (globals), 9.39.5 (eslint).
  </acceptance_criteria>
  <done>Package legitimacy confirmed by the human; Task 3 unblocked.</done>
  <resume-signal>The human replies APPROVED after opening both npm pages and confirming the repository links and pinned versions; on refusal or mismatch the phase aborts and reports.</resume-signal>
  <what-built>Nothing on disk — the checkpoint produces a recorded legitimacy decision that gates Task 3's `pnpm add`.</what-built>
  <how-to-verify>The task summary contains the APPROVED decision with the date, the two npm URLs visited, and the confirmed pins (typescript-eslint 8.72.0, globals 17.13.0, eslint 9.39.5); Task 3 refuses to run without it.</how-to-verify>
</task>

<task type="auto">
  <name>Task 3: Extend flat ESLint to all six unlintered packages + coverage meta-test (CI-03)</name>
  <files>package.json, pnpm-lock.yaml, apps/api/eslint.config.mjs, apps/api/package.json, workers/data-sync/eslint.config.mjs, workers/data-sync/package.json, packages/config/eslint.config.mjs, packages/config/package.json, packages/database/eslint.config.mjs, packages/database/package.json, packages/domain/eslint.config.mjs, packages/domain/package.json, packages/football-data/eslint.config.mjs, packages/football-data/package.json, tests/unit/lint-coverage.test.ts</files>
  <read_first>apps/web/eslint.config.mjs (house flat-config style — do NOT modify this file), apps/web/package.json (line 10: `"lint": "eslint ."`, line 25: eslint 9.39.5), turbo.json (lines 12-14: lint dependsOn ^lint), pnpm-workspace.yaml (globs apps/*, packages/*, workers/*), tests/unit/coverage-contract.test.ts (house style for source-contract meta-tests), 07-RESEARCH.md (Pattern 2 skeleton), 07-PATTERNS.md (eslint pattern section)</read_first>
  <action>Prerequisite: Task 2 APPROVED. (1) Install root devDependencies with one command: `pnpm add -Dw typescript-eslint@8.72.0 globals@17.13.0 eslint@9.39.5` (exact pins; this rewrites pnpm-lock.yaml — commit it). (2) Create six identical flat configs — apps/api, workers/data-sync, packages/config, packages/database, packages/domain, packages/football-data — each named eslint.config.mjs with this shape (matching research Pattern 2): imports `tseslint` from "typescript-eslint" and `globals` from "globals"; default export `tseslint.config(` with (a) an ignores object listing `dist/**`, `node_modules/**`, and — for packages/database ONLY — additionally `src/generated/**` (the committed Prisma client must never be linted), (b) `...tseslint.configs.recommended` spread, (c) a scoped object `{ files: ["**/*.ts", "**/*.mts", "**/*.cts"], languageOptions: { globals: globals.node } }` so TypeScript files are part of the linted set without any type-aware rule (no projectService, no recommendedTypeChecked this phase — monorepo type-aware linting is slow per PITFALLS and is not required by CI-03). (3) Add `"lint": "eslint ."` to the scripts of exactly those six package.json files (mirroring apps/web/package.json line 10). Do not change turbo.json or the root lint script — fan-out already exists. (4) Run `pnpm lint`; fix every reported error in the package sources with minimal behavior-preserving edits (remove unused imports/variables, drop needless async, replace trivial `any` with `unknown` plus narrowing where safe). Where a rule fires on an established, intentional pattern and a source fix would distort the code, add a single-line `// eslint-disable-next-line <rule> -- <reason>` at the exact site — never disable a rule inside a config file and never add file-wide disables. (5) Negative probe (CI-03 empty/concurrency edge): create a temporary file packages/config/src/__lint_probe.ts containing an exported const plus one genuinely unused const (which triggers @typescript-eslint/no-unused-vars), run `pnpm lint`, confirm non-zero exit, then delete the probe and confirm `pnpm lint` returns to exit 0. Record both exit codes in the task summary. (6) Create tests/unit/lint-coverage.test.ts in the house coverage-contract.test.ts style (readFileSync/existsSync + describe/it, no network): read pnpm-workspace.yaml and assert it declares the globs apps/*, packages/*, workers/*; enumerate each directory under those globs, parse every package.json, and assert the collected package-name set is exactly [@bet-stats/api, @bet-stats/web, @bet-stats/data-sync, @bet-stats/config, @bet-stats/database, @bet-stats/domain, @bet-stats/football-data] (a new workspace package must consciously update this test); for each package assert scripts.lint equals "eslint ." and an eslint.config.mjs exists on disk.</action>
  <verify>
    <automated>pnpm vitest run --project unit tests/unit/lint-coverage.test.ts && pnpm lint</automated>
  </verify>
  <acceptance_criteria>
    - The automated verify exits 0; the lint meta-test asserts 7 named packages, each with `scripts.lint === "eslint ."` and an on-disk eslint.config.mjs.
    - `pnpm lint` output shows turbo running lint for all seven packages (not only @bet-stats/web).
    - The negative probe was executed and reverted: probe present → `pnpm lint` non-zero; probe removed → exit 0 (exit codes recorded in the task summary).
    - `git diff apps/web/eslint.config.mjs` is empty (the Next config is untouched).
    - packages/database/eslint.config.mjs ignores `src/generated/**`; no config file contains a `rules:` block that disables a rule wholesale.
    - `pnpm vitest run --project unit && pnpm typecheck && pnpm lint` all exit 0 after the source fixes (per-task sampling gate from 07-VALIDATION.md).
  </acceptance_criteria>
  <done>All seven workspace packages are lint-gated with one pinned ESLint 9.39.5 toolchain, `pnpm lint` is green, the negative probe proved the gate fails loudly, and the meta-test prevents future packages from silently escaping the gate.</done>
</task>

<task type="auto">
  <name>Task 4: CI-04 mutation-rejection gap closure — tests/integration/mutation-rejection.test.ts</name>
  <files>tests/integration/mutation-rejection.test.ts</files>
  <read_first>tests/integration/forecast-snapshots.test.ts (lines 1-11 env guard + pid namespacing; lines 32-46 ForecastSnapshot/ForecastMarket inserts and the /immutable/i trigger-assertion house pattern), tests/integration/value-receipt.test.ts (lines 20-52 ValueReceipt INSERT with pair-validation columns and the ManualOddsSnapshot/ManualOddsSelection seeding chain), tests/integration/value-settlement.test.ts (lines 39-58 full settlement seed: SourceObservation, ResultVersion, persist_settlement_receipt call, persist_value_settlement call, ClosingOddsObservation insert; line 85 existing UPDATE assertion), 07-RESEARCH.md (Pattern 3 table and gap list), 07-PATTERNS.md (mutation-rejection pattern section with the two trigger-family message table)</read_first>
  <action>Create ONE new integration test file tests/integration/mutation-rejection.test.ts closing the six CI-04 gaps. Copy the house skeleton exactly: import { afterAll, beforeAll, describe, expect, it } from "vitest"; import { createPrismaClient, type PrismaClient } from "@bet-stats/database"; the DATABASE_URL guard (`if (!databaseUrl) throw new Error("DATABASE_URL is required")`); `const run = process.pid.toString(); const id = (value: string) => `${value}-${run}`;` namespacing for every row id. In beforeAll, against the harness-provided DATABASE_URL, seed with raw SQL (namespaced ids throughout, `ON CONFLICT DO NOTHING` for shared-dimension rows): League/Season/Two Teams/Fixture with status FINISHED (copy value-settlement.test.ts lines 39-43, renaming ids with id()); two SourceObservation RESULTS rows + one ResultVersion (copy lines 44-45); one ForecastSnapshot in state ISSUED + one ForecastMarket row (copy the INSERT column lists from value-receipt.test.ts lines 46 and 50); one ManualOddsSnapshot + the HOME ManualOddsSelection (line 52 pattern); one VALUE_CANDIDATE ValueReceipt for HOME via the insertValue column list from value-receipt.test.ts lines 22-27; one ClosingOddsObservation (value-settlement line 53); then one SettlementReceipt via `SELECT * FROM persist_settlement_receipt(...)` and one ValueSettlement row via `SELECT * FROM persist_value_settlement(...)` exactly as value-settlement.test.ts lines 55-58 and 25-28 do (the DB functions satisfy the guarded INSERT semantics — never INSERT into ValueSettlement directly). Every seed INSERT that returns a count must be asserted to resolve to 1 so a zero-row no-op can never masquerade as protection. afterAll disconnects the client. Then one `it` block per gap table, each following the statement discipline: (i) raw `UPDATE ... WHERE id=$1` via prisma.$executeRawUnsafe with expect(...).rejects.toThrow, (ii) a `SELECT count(*)` proving the row still exists, (iii) raw `DELETE FROM ... WHERE id=$1` with expect(...).rejects.toThrow — UPDATE always first, so a missing DELETE trigger could never hide behind a row already deleted by a prior statement. The six gaps and their EXACT assertion patterns (two trigger families — this matters, PITFALL 5): 1. ValueReceipt → `DELETE FROM "ValueReceipt" WHERE id=$1` rejects /immutable/i (UPDATE half already covered in value-receipt.test.ts:60). 2. ValueSettlement → `DELETE FROM "ValueSettlement" WHERE id=$1` rejects /immutable/i (UPDATE half exists in value-settlement.test.ts:85). 3. ClosingOddsObservation → UPDATE `SET "decimalOdds"='9'` and DELETE both reject /immutable/i (trigger message 'ClosingOddsObservation is immutable'). 4. ForecastMarket → UPDATE `SET probabilities='[{"selection":"HOME","probability":0.9}]'::jsonb` and DELETE both reject /immutable/i (shared reject_append_only_change() function). 5. ResultVersion → UPDATE `SET "homeGoals"=9` and DELETE both reject /append-only/i — NOT /immutable/i: the prevent_historical_evidence_mutation() family raises '% is append-only'. 6. SourceObservation → UPDATE `SET "payloadHash"=...` and DELETE both reject /append-only/i (same family). Keep every assertion scoped to its own namespaced row id. Do not modify any existing test file, any migration, or any schema — the triggers already exist (research verified every DDL).</action>
  <verify>
    <automated>pnpm run test:integration:docker</automated>
  </verify>
  <acceptance_criteria>
    - The Docker harness run exits 0 (owned postgres:18-alpine + redis:8-alpine containers, prisma migrate deploy, full vitest integration project). This run doubles as this plan's wave-end integration sample per 07-VALIDATION.md; its wall time (~5-8 min) is expected to exceed the 60 s quick-gate target — the <60 s gate for this task is `pnpm typecheck`, run before the harness.
    - The new file contains exactly six table assertions with the message patterns: /immutable/i for ValueReceipt, ValueSettlement, ClosingOddsObservation, ForecastMarket; /append-only/i for ResultVersion, SourceObservation.
    - Every UPDATE assertion is followed by a row-existence SELECT and then the DELETE assertion for the same row.
    - Every seed INSERT that creates a guarded row asserts `.resolves.toBe(1)` (or an equivalent row-count check) before any rejection assertion.
    - The file contains no schema or migration changes: `git status` shows only tests/integration/mutation-rejection.test.ts added among source paths.
    - A missing-Docker host produces a non-zero harness exit with the docker CLI error surfaced (CI-02 fail-loud contract) — verified by the harness code path, no skip branch exists anywhere in the file.
  </acceptance_criteria>
  <done>All six CI-04 mutation gaps are closed by one namespaced, trigger-accurate integration test that is green under the owned-container harness and will run inside the CI integration job from its first push.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| GitHub event → workflow | push/pull_request events (including fork PRs) trigger jobs with untrusted head code executing in `run:` steps |
| npm registry → workspace | `pnpm add`/`pnpm install` pull external packages into the build chain |
| CI runner → local scripts | workflow `run:` steps execute repo-owned scripts (harness, vitest) on the runner |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-7-01 | Tampering | .github/workflows/ci.yml action refs | high | mitigate | Pin majors exactly (checkout@v6, pnpm/action-setup@v6, setup-node@v7); floating refs forbidden — plan 2 contract test asserts the exact strings and rejects `@main`-style refs |
| T-7-02 | Information Disclosure | fork-PR secret exfiltration | high | mitigate | `pull_request` (never `pull_request_target`), top-level `permissions: contents: read`, zero `secrets.` references — asserted by plan 2's ci-workflow-contract.test.ts |
| T-7-03 | Repudiation (budget) | provider free-tier budget | high | mitigate | No provider credentials, env names or live endpoints anywhere in CI; integration/e2e tests use only owned containers and deterministic stacks — contract test greps for provider secret names (API_FOOTBALL, FOOTBALL_DATA) |
| T-7-04 | Tampering | dependency install path | high | mitigate | `pnpm install --frozen-lockfile` is the only install command in the workflow; packageManager pin drives pnpm version; lockfile-keyed cache via `cache: pnpm` |
| T-7-05 | Tampering | frozen snapshot/receipt tables | high | mitigate | DB triggers (already shipped) + Task 4's raw-SQL mutation assertions, executed by the required integration job; repository-level guards deliberately NOT used (they protect one code path, triggers protect every writer) |
| T-7-06 | Denial of Service / Repudiation | integration gate silently skipping | medium | mitigate | No `continue-on-error`, no docker-presence guards; harness throws on missing docker CLI (scripts/verify-release-integration.mjs lines 9-11, 52-55); contract test enforces absence |
| T-7-SC | Tampering | npm installs (typescript-eslint, globals — [SUS] verdict) | high | mitigate | Blocking human checkpoint (Task 2) before install; exact version pins; [SLOP] would abort the phase |

## ASVS L1 Mapping (V8 Software Integrity)

- Frozen-lockfile install (V8) — T-7-04.
- Pinned action majors, least-privilege `permissions: contents: read`, no `pull_request_target` (V8) — T-7-01/T-7-02.
- Package legitimacy gate for [SUS] packages — T-7-SC.
</threat_model>

<threat_model_note>Every threat above has a disposition and a specific implementation reference; no mitigation is generic advice. High-severity findings (T-7-01..T-7-05, T-7-SC) fail the phase if unmet.</threat_model_note>

## Edge Coverage

Specless edge probe rows for CI-01..CI-04, resolved per plan. Resolution classes: explicit (acceptance criterion exists), backstop (test is the proof), FLAGGED ASSUMPTION.

| Req | Category | Resolution | Criterion / test | Enforced in |
|-----|----------|------------|------------------|-------------|
| CI-01 | adjacency | explicit | Push trigger restricted to `branches: [main]`; PR-branch pushes fire exactly one `pull_request` run, never a duplicate push run | Plan 1 Task 1 (ci.yml) + plan 2 contract test |
| CI-01 | empty | explicit | No `paths:`/`paths-ignore:` filters — an empty or docs-only commit still executes the full chain | Plan 1 Task 1 + plan 2 contract test asserts filter absence |
| CI-01 | ordering | explicit | Quality-job step order fixed: install → schema → typecheck → lint → test → build; contract test asserts monotonic order by index | Plan 1 Task 1 + plan 2 contract test |
| CI-01 | concurrency | explicit | Workflow `concurrency` group per ref with `cancel-in-progress: true` — superseded runs on the same ref are cancelled; cancelled is a non-success conclusion and therefore blocks a required check | Plan 1 Task 1 + plan 2 contract test |
| CI-02 | unclassified | backstop | ci-workflow-contract.test.ts fails on any of: `pull_request_target`, `continue-on-error`, `secrets.`, provider credential names, docker-presence guards, unpinned `uses:`, `${{ }}` inside run bodies | Plan 2 Task 3 |
| CI-03 | adjacency | backstop | tests/unit/lint-coverage.test.ts asserts every workspace package (fixed set of 7 names) declares `scripts.lint` and a config — a future package cannot sit adjacent to the gate unnoticed | Plan 1 Task 3 |
| CI-03 | empty | explicit | Scoped `files: ["**/*.ts", ...]` patterns put every package TS file in the linted set; negative probe proves a single unused const flips `pnpm lint` to non-zero | Plan 1 Task 3 |
| CI-03 | ordering | explicit | Lint covers all 7 packages (wave 1, this plan) BEFORE branch protection makes the check required (plan 3 Task 2) — CI-03's explicit ordering; plan 3 asserts the meta-test is green before enabling protection | Plan 1 Task 3 + plan 3 Task 2 |
| CI-03 | concurrency | explicit | turbo lint fan-out order is intentionally unspecified; the gate contract is the aggregate exit code — any single package failure exits non-zero (proved by the negative probe), and eslint writes no shared state so parallel package runs cannot interfere | Plan 1 Task 3 |
| CI-04 | unclassified | explicit + backstop | Enforcement is writer-agnostic: tests mutate via raw `prisma.$executeRawUnsafe` SQL, bypassing every repository guard, so the trigger (not code) is proven; empty-table semantics handled by asserting every seed INSERT resolves 1 (a zero-row UPDATE/DELETE affects nothing and cannot fire a row trigger — never claimed as protection); UPDATE-before-DELETE statement order with a row-existence check between them prevents false passes; vitest integration project runs with `fileParallelism: false` (vitest.config.ts:36) so no test race exists, and per-pid id namespacing makes reruns idempotent | Plan 1 Task 4 (backstop: required integration job from plan 3 onward) |

No row is dropped. No FLAGGED ASSUMPTION rows remain in this plan (Linux first-run E2E portability A4 is flagged in plan 2, Task 2, where it belongs).

## Prohibitions

Forbidden tokens in any artifact this plan produces (docs, comments, copy, task output claims): "guaranteed", "always green", "zero risk", "production-ready", "never fails", "bulletproof", "100% coverage", "future-proof". Explicit rules:

1. No acceptance criterion, comment, or summary may claim the pipeline is "guaranteed" or can "never fail" — CI detects regressions; it does not remove them.
2. No artifact may describe itself or the phase as "production-ready", "bulletproof", or "zero risk".
3. No coverage claim of "100% coverage" anywhere — claims state measured facts only.
4. No "always green" language: red runs are a designed outcome (see the deliberate-breakage drill in plan 3) and must not be described as something to avoid at all costs.
5. No "future-proof" language: the workflow states current pins and current jobs; later changes are later phases.
6. `grep -ri` over the files this plan creates must return zero matches for the token list above (checked in the plan summary).

<verification>
Phase-level checks for this plan: `pnpm install --frozen-lockfile && pnpm verify:release:schema && pnpm typecheck && pnpm lint && pnpm test` green (tracer replay); `pnpm build` green once; `pnpm run test:integration:docker` green with the new mutation-rejection file included; token grep over created files returns zero matches; `git status` shows no unexpected modified files (apps/web config, turbo.json, vitest.config.ts, migrations untouched).</verification>

<success_criteria>
1. ci.yml quality job exists with the exact step chain and security posture (read-only permissions, pinned majors, no interpolation).
2. `pnpm lint` covers 7/7 packages, exits 0, and fails a deliberate single-package violation (probe executed).
3. The lint-coverage meta-test fails if any package ever loses its lint script.
4. All six CI-04 mutation gaps are asserted green against real PostgreSQL through the Docker harness.
5. One commit set per task, gates run per task, phase artifacts contain none of the prohibited tokens.
</success_criteria>

<output>Create `.planning/phases/07-ci-pipeline-quality-gates/07-PLAN-1-SUMMARY.md` when done (subsystem: ci, tags: ci, lint, immutability, github-actions).</output>
