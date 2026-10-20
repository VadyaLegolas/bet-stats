---
phase: 07-ci-pipeline-quality-gates
plan: 2
type: execute
wave: 2
depends_on: [07-PLAN-1-ci-workflow-and-quality-gates]
files_modified:
  - .github/workflows/ci.yml
  - playwright.ci.config.ts
  - tests/unit/ci-workflow-contract.test.ts
  - .gitattributes
  - .npmrc
autonomous: false
requirements: [CI-01, CI-02, CI-03, CI-04]
user_setup: []
estimate:
  tokens: 95000
  raw_tokens: 95000
  tasks: 5
  confidence: low
must_haves:
  truths:
    - "ci.yml defines exactly three jobs — quality, integration, e2e-portable — all on ubuntu-latest, all installing with --frozen-lockfile, all using pinned action majors"
    - "The integration job's only test command is `pnpm run test:integration:docker`; the harness exits non-zero when the docker CLI is absent and the workflow contains no skip branch, no continue-on-error and no docker-presence guard"
    - "playwright.ci.config.ts has no webServer and no phase06 dependencies; running it with the two explicit portable spec files executes exactly tests/e2e/evidence-scorecard.spec.ts and tests/e2e/team-evidence-live.spec.ts"
    - "tests/unit/ci-workflow-contract.test.ts passes green and fails the build if any security or structure regression is introduced into ci.yml (pull_request_target, continue-on-error, secrets., provider credential names, unpinned uses, interpolation into run:, missing permissions/concurrency, path filters, reordered quality steps)"
    - ".gitattributes enforces LF endings and .npmrc matches the human decision recorded in Task 4; the local pnpm workflow remains usable (either the host runs Node 24 or the human chose the no-engine-strict option)"
    - "Prohibition tokens (see ## Prohibitions) appear in zero artifacts produced by this plan (grep-verified)"
  artifacts:
    - .github/workflows/ci.yml (three jobs)
    - playwright.ci.config.ts
    - tests/unit/ci-workflow-contract.test.ts
    - .gitattributes
    - .npmrc (unless the human chose the skip option in Task 4; decision recorded in the plan summary either way)
  key_links:
    - ci.yml integration job -> package.json test:integration:docker -> scripts/verify-release-integration.mjs -> vitest integration project (incl. tests/integration/mutation-rejection.test.ts from plan 1 = CI-04 in CI)
    - ci.yml e2e-portable job -> playwright.ci.config.ts -> tests/e2e/live-evidence-stack.ts globalSetup (owned postgres container, migrate, seed, corepack builds, api/web spawn, returned teardown) -> the two portable specs
    - tests/unit/ci-workflow-contract.test.ts -> ci.yml (a living security policy: the unit gate fails before GitHub ever runs a dangerous workflow)
---

<objective>
Complete the pipeline's job set: add the Docker-backed integration job (CI-01/CI-02), add the portable E2E job with its webServer-less Playwright config, encode the workflow's entire security posture as a unit-project contract test, and land the repo parity pins (.gitattributes, .npmrc) behind a human decision.

Purpose: every gate the ROADMAP names then exists as a concrete CI job, and the workflow can no longer regress silently on any security-relevant axis (the contract test is the backstop for CI-02's "never calls live providers / never skips" contract).

Output: ci.yml with three jobs, playwright.ci.config.ts, tests/unit/ci-workflow-contract.test.ts, .gitattributes, .npmrc.

<assumption_delta>
None (scan detected:false, 2026-10-20). Corrected fact carried from plan 1 measurements: the integration harness must run through `pnpm run test:integration:docker` (npm_execpath is absent under `pnpm exec` — measured MISSING). Additionally this plan notes a research inventory gap: the repo has FOUR Playwright configs (playwright.config.ts, playwright.phase05.config.ts, playwright.phase06.config.ts, playwright.live-evidence.config.ts), not the three research read; playwright.live-evidence.config.ts is the exact template for the new ci config (it already wires globalSetup live-evidence-stack + baseURL LIVE_WEB_ORIGIN).
</assumption_delta>

<api_coverage_scan>
No task in this plan adds outbound HTTP calls. The E2E stacks manage loopback services and owned Docker containers only; live football providers are absent from CI by design (CI-02) and asserted absent by the contract test. No external_apis block required; no {N}-api-coverage.json emitted.
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
@.planning/phases/07-ci-pipeline-quality-gates/07-PLAN-1-ci-workflow-and-quality-gates.md
@playwright.live-evidence.config.ts
@playwright.config.ts
@scripts/verify-release-integration.mjs
@tests/unit/coverage-contract.test.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add the integration job to ci.yml (CI-01/CI-02)</name>
  <files>.github/workflows/ci.yml</files>
  <read_first>.github/workflows/ci.yml (as created by plan 1 Task 1), 07-RESEARCH.md (Pattern 4 integration job skeleton, lines 295-304, and Pattern 1 "call the harness verbatim"), scripts/verify-release-integration.mjs (full file), package.json (the test:integration:docker script)</read_first>
  <action>Extend ci.yml with a second job named `integration`, following the Pattern 4 skeleton with these exact values: runs-on ubuntu-latest (Linux-only by contract — containers are unsupported on Windows runners, actions/runner#904); the same four-step prologue as quality (actions/checkout@v6, pnpm/action-setup@v6 with no version input, actions/setup-node@v7 with node-version 24 and cache: pnpm, `pnpm install --frozen-lockfile`); then exactly one test step: `pnpm run test:integration:docker`. Do NOT add a `prisma generate` step (measured: the generated client at packages/database/src/generated/prisma is committed — 59 tracked files, clean git status — so typecheck and the harness need no generation). Do NOT wrap the harness, do NOT add `continue-on-error`, do NOT add any `if docker info`-style guard, do NOT add any other test command to this job — the harness itself fails loudly when Docker is absent (execFileSync("docker", …) throws, catch stops owned containers and rethrows, nonzero exit; scripts lines 9-11 and 52-55). Keep job-level comments minimal: one line noting the owned-container harness owns postgres/redis lifecycle and migrate-deploy. Local proof runs in this task's verify; the GitHub proof is plan 3.</action>
  <verify>
    <automated>pnpm run test:integration:docker && node -e "const s=require('node:fs').readFileSync('.github/workflows/ci.yml','utf8'); const job=s.split('integration:')[1]??''; if(!job.includes('pnpm run test:integration:docker')) { console.error('integration job missing harness invocation'); process.exit(1);} if(s.includes('continue-on-error')||/if\s+docker\s+info/.test(s)) { console.error('forbidden skip construct present'); process.exit(1);} console.log('integration job contract ok');"</automated>
  </verify>
  <acceptance_criteria>
    - The automated harness run exits 0 locally (owned containers, migrate deploy, full integration project including plan 1's mutation-rejection file; ~5-8 min expected — this is the plan's wave-end integration sample per 07-VALIDATION.md; the <60 s quick gate is `pnpm typecheck`).
    - ci.yml now contains both job keys `quality:` and `integration:`; the integration job's test surface is exactly `pnpm run test:integration:docker` (no bare `vitest`, no second test command in that job).
    - ci.yml contains zero occurrences of `continue-on-error` and zero docker-presence guards (node assertion above).
    - The integration job carries the same pinned action majors and `permissions` (workflow-level read-only) as quality — no job-level permission elevation.
  </acceptance_criteria>
  <done>The CI-01/CI-02 integration job is defined, calls the proven owned-container harness verbatim, and the harness run is green locally with CI-04's mutation tests included.</done>
</task>

<task type="auto">
  <name>Task 2: Portable E2E — playwright.ci.config.ts + e2e-portable job</name>
  <files>playwright.ci.config.ts, .github/workflows/ci.yml</files>
  <read_first>playwright.live-evidence.config.ts (the exact template: globalSetup + baseURL LIVE_WEB_ORIGIN — this is the config team-evidence-live already runs under), playwright.config.ts (the webServer shape that must NOT be copied — Pitfall 6), tests/e2e/live-evidence-stack.ts (lines 12-13 origins; lines 107-141 globalSetup returning liveEvidenceGlobalTeardown; lines 78-89 cross-platform corepack spawn), tests/e2e/live-evidence-stack.ts lines 123-127 and 131 (the `corepack pnpm` calls the CI job must make available), tests/e2e/evidence-scorecard.spec.ts lines 1-9 (self-managed evaluation stack via beforeAll setup), tests/e2e/team-evidence-live.spec.ts (relative page.goto -> depends on baseURL), 07-RESEARCH.md (Portable E2E invocation block, lines 386-394)</read_first>
  <action>(1) Create playwright.ci.config.ts as a near-verbatim copy of playwright.live-evidence.config.ts with these exact members: imports of defineConfig and devices from "@playwright/test" and LIVE_WEB_ORIGIN from "./tests/e2e/live-evidence-stack"; testDir "./tests/e2e"; fullyParallel false; forbidOnly true; retries 0; workers 1; reporter [["list"]]; globalSetup "./tests/e2e/live-evidence-stack.ts"; use { baseURL: LIVE_WEB_ORIGIN, trace: "retain-on-failure" }; projects [{ name: "chromium", use: { ...devices["Desktop Chrome"], timezoneId: "Europe/Warsaw" } }]. The globalSetup is mandatory (team-evidence-live.spec.ts has no per-spec setup — it relies on the evidence stack boot and the teardown returned by the setup function) and there must be NO webServer key anywhere (Pitfall 6: the default config's webServer requires an inherited DATABASE_URL the config never sets and double-boots against the spec-owned stacks). evidence-scorecard.spec.ts needs no config support: it boots its own evaluation stack in beforeAll and navigates with absolute origins, so it simply ignores the baseURL. (2) Extend ci.yml with the third job `e2e-portable`: runs-on ubuntu-latest; the same four-step prologue (checkout@v6, pnpm/action-setup@v6 no version input, setup-node@v7 node-version 24 cache pnpm, `pnpm install --frozen-lockfile`); then `corepack enable` (the stacks shell out to `corepack pnpm --filter … build` — Node 24 bundles corepack; research assumption A1, harmlessly idempotent), then `pnpm exec playwright install chromium --with-deps`, then `pnpm exec playwright test -c playwright.ci.config.ts tests/e2e/evidence-scorecard.spec.ts tests/e2e/team-evidence-live.spec.ts` (the two-file explicit list keeps the job's surface closed — no future spec silently joins CI). Do not set any provider credentials or DATABASE_URL in this job's env; the stacks own their own containers, migrations, seeds and process lifecycle.</action>
  <verify>
    <automated>pnpm exec playwright test -c playwright.ci.config.ts --list</automated>
  </verify>
  <acceptance_criteria>
    - `--list` output names exactly two spec files: tests/e2e/evidence-scorecard.spec.ts and tests/e2e/team-evidence-live.spec.ts, with their test titles; nothing else is discovered.
    - playwright.ci.config.ts contains no `webServer` and no `globalSetup` other than ./tests/e2e/live-evidence-stack.ts; `git diff playwright.live-evidence.config.ts` is empty (the pre-existing config is untouched).
    - Full local run executed once and recorded: `pnpm exec playwright test -c playwright.ci.config.ts tests/e2e/evidence-scorecard.spec.ts tests/e2e/team-evidence-live.spec.ts` exits 0 on the Docker-capable dev host (this is research assumption A4's local half; Linux behavior is proven by plan 3's first CI run — if it fails on Linux, fix forward there, do not weaken this config).
    - ci.yml's e2e-portable job contains, in order: `pnpm install --frozen-lockfile`, `corepack enable`, `pnpm exec playwright install chromium --with-deps`, `pnpm exec playwright test -c playwright.ci.config.ts` with the two spec paths.
    - No job in ci.yml declares an env var named API_FOOTBALL, FOOTBALL_DATA, or any `secrets.` reference.
  </acceptance_criteria>
  <done>The two portable specs run under a webServer-less CI config both locally and (from plan 3) on GitHub; the seven Windows-only phase06 specs and the nine default-config specs stay out of default CI as decided.</done>
</task>

<task type="auto">
  <name>Task 3: Workflow security contract test — tests/unit/ci-workflow-contract.test.ts (CI-02 backstop)</name>
  <files>tests/unit/ci-workflow-contract.test.ts</files>
  <read_first>tests/unit/coverage-contract.test.ts (house style: readFileSync + describe/it source-contract tests, no network), .github/workflows/ci.yml (current full content), 07-RESEARCH.md (Security Domain threat patterns table), 07-VALIDATION.md (Per-Task Verification Map row for CI-02)</read_first>
  <action>Create tests/unit/ci-workflow-contract.test.ts in the house source-contract style — read ci.yml as TEXT with readFileSync and assert with string/regex checks; do NOT add a YAML parsing dependency for this. The test file reads .github/workflows/ci.yml and asserts all of the following, grouped into named describe/it blocks so a failure names the violated policy. Structure asserts: file exists; contains `name: CI`; contains the three job keys `quality:`, `integration:`, `e2e-portable:`; every job block contains `runs-on: ubuntu-latest`; a top-level `permissions:` block containing `contents: read`; a `concurrency:` block containing `cancel-in-progress: true`; on: contains `pull_request:` and push with `branches: [main]`. Trigger-safety asserts: the text does NOT contain `pull_request_target`, `paths:`, `paths-ignore:`. Skips-and-secrets asserts: the text does NOT contain `continue-on-error`, `secrets.`, `API_FOOTBALL`, `FOOTBALL_DATA`, `if docker info`. Supply-chain asserts: the text contains `actions/checkout@v6`, `pnpm/action-setup@v6`, `actions/setup-node@v7`; every `uses:` line matches /uses:\s*[\w-]+\/[\w-]+@v\d+/ (no branch or floating refs); the pnpm/action-setup step has no `version:` input (assert the block following `pnpm/action-setup@v6` within 200 chars does not contain `version:`); `node-version: 24` and `cache: pnpm` are present. Install-path asserts: every occurrence of `pnpm install` is followed by `--frozen-lockfile` (regex /pnpm install(?!\s*--frozen-lockfile)\S*/ finds nothing — implement as: every line containing `pnpm install` also contains `--frozen-lockfile`). Interpolation asserts: no line matches /run:.*\$\{\{/ (env-var indirection is the only sanctioned way to pass expressions to shell). Ordering asserts: in the quality job text, indexOf is strictly increasing for `pnpm install --frozen-lockfile` < `pnpm verify:release:schema` < `pnpm typecheck` < `pnpm lint` < `pnpm test` < `pnpm build`. Integration-job asserts: the integration job block contains `pnpm run test:integration:docker` and does NOT contain `vitest` (the harness owns the test invocation). E2E-job asserts: the e2e-portable block contains `corepack enable`, `playwright install chromium --with-deps` and `playwright.ci.config.ts`. Keep every assertion string derived from the values above so the test documents the policy it enforces; a reviewer must be able to fix a red run from the assertion message alone.</action>
  <verify>
    <automated>pnpm vitest run --project unit tests/unit/ci-workflow-contract.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - The automated verify exits 0 against the three-job ci.yml produced by Tasks 1-2.
    - Negative self-check executed within the task (then reverted): temporarily inserting `continue-on-error: true` into ci.yml makes the test red with a message naming the policy; `git diff .github/workflows/ci.yml` after revert is empty. Record the red-run proof in the task summary.
    - The test has no network access, no new dependency, and lives in the unit project (runs inside `pnpm test`, therefore inside the CI quality job itself — the policy guards the workflow that runs the policy).
    - Assertion messages name the violated contract for every check (no bare expect(x).toBe(true) without context).
  </acceptance_criteria>
  <done>The workflow's security posture (CI-02 backstop, V8 controls) is executable policy enforced on every push via the unit gate, and the deliberate self-check proved it fails loudly on regression.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking-human">
  <name>Task 4: engine-strict decision — local Node 25 vs the engines pin</name>
  <files>.npmrc</files>
  <read_first>package.json lines 6-10 (packageManager pnpm@10.34.5, engines node >=24.0.0 <25), package.json line 19 (verify:release:prerequisites already rejects non-24 Node), .planning/research/STACK.md (Node 24 LTS runtime), 07-RESEARCH.md Standard Stack (.npmrc engine-strict=true entry)</read_first>
  <action>Present the human with the measured conflict and wait for an explicit choice before creating .npmrc. Measured 2026-10-20 on this host: Node is v25.2.1 while package.json engines demands >=24.0.0 <25; today pnpm emits only a WARN, but adding `.npmrc` with `engine-strict=true` (the research default) turns that into `ERR_PNPM_UNSUPPORTED_ENGINE` with exit 1 for EVERY pnpm command on this host (verified via `pnpm --config.engine-strict=true run verify:release:schema`). Note that the repo's own release gate (verify:release:prerequisites) already hard-rejects non-24 Node, so the project intent is Node 24; CI pins node-version 24 regardless. Options to present: (A) [recommended] create .npmrc with engine-strict=true AND switch the local/session Node to 24 (nvm/volta/winget — any method), restoring full local pnpm usage under the enforced pin; (B) create .npmrc with engine-strict=true and accept that local pnpm commands fail on Node 25 until the host switches (plan 3 runs no local pnpm, so the phase can still complete; the dev host stays non-compliant meanwhile); (C) skip .npmrc entirely — pins remain enforced in CI via node-version 24 plus frozen-lockfile, and the dev host keeps WARN-level engine feedback (this explicitly downgrades the research default and must be recorded as the human's decision in the plan summary). Record the choice verbatim in the task summary and in the plan SUMMARY; only option A or B permits creating the file in Task 5.</action>
  <verify>
    <automated>n/a — blocking human gate: the choice changes local developer ergonomics on the actual host; resumption requires an explicit A, B, or C decision recorded in the task summary</automated>
  </verify>
  <acceptance_criteria>
    - A, B or C is explicitly chosen by the human and recorded with the date and the measured evidence above.
    - If the choice is C, the summary states that .npmrc was deliberately not created and why (user decision, deviates from the research default).
  </acceptance_criteria>
  <done>The engine-strict outcome is a recorded human decision, not an agent guess.</done>
  <resume-signal>The human picks option A, B or C explicitly; Task 5 proceeds immediately with the matching file outcome.</resume-signal>
  <what-built>Nothing on disk — the checkpoint produces the recorded engine-strict decision that determines whether .npmrc is created.</what-built>
  <how-to-verify>The task summary names the chosen option with the date and the measured ERR_PNPM_UNSUPPORTED_ENGINE evidence; Task 5's file presence matches the choice exactly.</how-to-verify>
</task>

<task type="auto">
  <name>Task 5: Repo parity pins — .gitattributes (+ .npmrc per decision)</name>
  <files>.gitattributes, .npmrc</files>
  <read_first>Task 4's recorded decision (same plan), 07-RESEARCH.md Pitfall 3 (lockfile/line-ending drift) and Code Examples (.gitattributes block), .gitignore (binary assets context)</read_first>
  <action>Create .gitattributes at the repo root with exactly these lines: `* text=auto eol=lf`, `*.png binary`, `*.jpg binary`. Then, ONLY if Task 4's decision was A or B, create .npmrc with the single line `engine-strict=true`; if the decision was C, do not create .npmrc. After writing .gitattributes, measure (do not assume) the current drift: run `git add -n --renormalize .` and capture the output. If it lists files, do NOT stage or commit any renormalization — record the file list in the task summary and leave the drift as an explicit follow-up decision for the user (a mass line-ending rewrite must never ride along in this plan's commits). The pins' value is prospective: new and CI-checked-out files are LF-normalized from this commit forward, protecting pnpm-lock.yaml and Prisma sources from CRLF drift between the Windows dev host and Linux runners.</action>
  <verify>
    <automated>node -e "const fs=require('node:fs'); const g=fs.readFileSync('.gitattributes','utf8'); if(!g.split(/\r?\n/).includes('* text=auto eol=lf')) { console.error('.gitattributes missing LF rule'); process.exit(1);} const decision=process.env.PHASE7_ENGINE_STRICT_DECISION||'see-task-4-summary'; const nrc=fs.existsSync('.npmrc')?fs.readFileSync('.npmrc','utf8'):''; console.log('gitattributes ok; engine-strict='+(nrc.includes('engine-strict=true')?'present':decision));"</automated>
  </verify>
  <acceptance_criteria>
    - .gitattributes exists with the exact rule lines listed above.
    - .npmrc exists with `engine-strict=true` iff Task 4 chose A or B; absent iff C — and the choice is cross-referenced in the task summary.
    - `git add -n --renormalize .` output was captured; if non-empty, zero renormalization changes were staged and the file list is recorded in the summary.
    - If the decision was A or B and the host now runs Node 24: `pnpm install --frozen-lockfile` exits 0. If the host is still on Node 25 under decision A/B: `pnpm --version` is expected to exit non-zero with ERR_PNPM_UNSUPPORTED_ENGINE — that is the recorded consequence of the decision, not a defect; state it plainly in the summary. If the decision was C: `pnpm install --frozen-lockfile` exits 0 on the current host (WARN-level engine message expected).
  </acceptance_criteria>
  <done>Line-ending parity is enforced repo-wide and the engine-strict outcome matches the human's recorded decision; no unrelated drift was committed.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Workflow → Docker daemon on the runner | integration and e2e jobs execute docker run commands via repo-owned harnesses |
| Workflow → npm/browser CDNs | `playwright install chromium --with-deps` fetches browser binaries and OS packages on the runner |
| Dev host ↔ CI host parity | git line endings and Node/pnpm pins cross the Windows-dev / Linux-CI boundary via the lockfile |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-7-07 | Tampering (workflow injection) | `run:` bodies in ci.yml | high | mitigate | No `${{ }}` interpolation into any shell string (env-var indirection only); contract test asserts no `run:` line contains an expression |
| T-7-02 | Information Disclosure | fork PRs hitting CI | high | mitigate | Contract test pins `pull_request` + read-only permissions + zero `secrets.` references; the harness injects only dummy test secrets (scripts lines 87-88) so fork runs need none |
| T-7-03 | Repudiation (budget) | free-tier provider quota | high | mitigate | Contract test fails on `API_FOOTBALL`/`FOOTBALL_DATA` appearing anywhere in the workflow; e2e job env carries no provider credentials; the only provider-shaped code in CI-bound tests uses loopback stubs and deterministic factories |
| T-7-05 | Tampering | frozen tables via any writer | high | mitigate | The required integration job runs plan 1's raw-SQL mutation-rejection tests on every push (CI-04); missing-Docker and test failures block, never skip (contract test forbids continue-on-error and docker guards) |
| T-7-08 | Tampering | unpinned or re-pointed actions | medium | mitigate | Contract test enforces `@vN`-only `uses:` refs and the exact majors; SHA-pinning remains optional hardening out of scope |
| T-7-09 | Tampering | CRLF drift corrupting lockfile/schema parity | medium | mitigate | .gitattributes LF normalization; renormalization is dry-run-only in this plan so no silent mass rewrite ships |
| T-7-10 | Denial of Service | e2e stacks leaking containers/processes on the runner | low | accept | Stacks own deterministic teardown (globalSetup-returned teardown; owned container names); an ephemeral CI runner bounds any leak — flagged as A4 fix-forward if the e2e job hangs post-run on Linux |
| T-7-SC | Tampering | .npmrc engine-strict changing local supply-chain posture | low | mitigate | Decision is human-owned (Task 4); CI enforcement (node-version 24, frozen-lockfile) does not depend on it |

## ASVS L1 Mapping (V8 Software Integrity)

- `--frozen-lockfile` everywhere + lockfile-keyed cache — T-7-04 (carried from plan 1, now asserted by contract test).
- Pinned actions, least privilege, no `pull_request_target`, no secrets in PR jobs — T-7-01/T-7-02/T-7-07/T-7-08.
- No provider credentials in CI — T-7-03.
- LF/Node/pnpm pin parity — T-7-09.
</threat_model>

## Edge Coverage

Every specless probe row, resolved. Resolution classes: explicit (acceptance criterion), backstop (test is the proof), FLAGGED ASSUMPTION.

| Req | Category | Resolution | Criterion / test | Enforced in |
|-----|----------|------------|------------------|-------------|
| CI-01 | adjacency | explicit | Push on main and pull_request events never double-run a commit: push is branches:[main]-scoped, PR heads are not main | Plan 2 Task 3 (contract test asserts triggers) |
| CI-01 | empty | explicit | No path filters — docs-only or empty commits still execute all three jobs | Plan 2 Task 3 (asserts absence of paths:/paths-ignore:) |
| CI-01 | ordering | explicit | Quality step order locked by index assertions; job failure stops that job's later steps (GitHub default) so a red gate can never be reported by steps that did not run | Plan 2 Task 3 |
| CI-01 | concurrency | explicit | `concurrency` + `cancel-in-progress: true` per ref: a newer push cancels superseded runs; cancelled is a non-success conclusion and blocks a required check — no stale run can green-light a newer commit | Plan 1 Task 1 (definition) + Plan 2 Task 3 (assertion) |
| CI-02 | unclassified | backstop | ci-workflow-contract.test.ts is the proof: it fails the unit gate (hence the quality job) on pull_request_target, continue-on-error, secrets., provider names, docker guards, unpinned actions, run:-interpolation, missing permissions/concurrency, path filters, reordered steps, second test command in the integration job; plus the measured negative: removing the docker CLI from the environment makes `pnpm run test:integration:docker` exit non-zero (harness throw, scripts:9-11) | Plan 2 Tasks 1+3 |
| CI-03 | adjacency | backstop | Plan 1's lint-coverage meta-test still runs inside `pnpm test`, which this plan's jobs invoke — a package without lint scripts fails CI from the first push of the complete pipeline | Plan 1 Task 3 (definition), Plan 2 job wiring |
| CI-03 | empty | explicit | Unchanged from plan 1 (scoped TS file patterns + negative probe); this plan adds no lint-scope change — ci.yml's `pnpm lint` step is contract-tested to remain in the quality chain | Plan 2 Task 3 (ordering assertion includes the lint step) |
| CI-03 | ordering | explicit | Branch protection (the "required gate" moment) happens only in plan 3, after this plan's pipeline is proven; plan 3 Task 2 re-asserts the lint meta-test green before enabling required checks | Plan 3 Task 2 |
| CI-03 | concurrency | explicit | Unchanged from plan 1 (aggregate exit code is the contract; fan-out order unspecified); e2e and integration jobs run in parallel with quality on separate runners with disjoint workspaces — no shared mutable state between jobs | Plan 2 job layout |
| CI-04 | unclassified | explicit + backstop | Same resolution as plan 1 (writer-agnostic raw SQL, seed-count assertions, UPDATE-before-DELETE with row-existence check, fileParallelism:false) — this plan's contribution is the enforcement wiring: the integration job runs the tests as a CI job on every push, and the contract test pins that invocation to the harness | Plan 2 Tasks 1+3 |

FLAGGED ASSUMPTION (surfaced, not dropped): research A4 — the two portable specs were authored on Windows; their first Ubuntu run is unproven. Local full-run success is required by Task 2's acceptance; Linux success is proven by plan 3's first CI run, with fix-forward budgeted there (most likely A1-style corepack or the posix process-group teardown path in live-evidence-stack stopOwned — `process.kill(-pid)` without a detached spawn can throw ESRCH and is currently swallowed; on an ephemeral runner this cannot leak past the job).

## Prohibitions

Forbidden tokens in any artifact this plan produces (docs, comments, copy, task output claims): "guaranteed", "always green", "zero risk", "production-ready", "never fails", "bulletproof", "100% coverage", "future-proof". Explicit rules:

1. No summary or comment may describe the pipeline as able to "never fail" or as "always green" — plan 3 deliberately turns it red; red is correct behavior for a real defect.
2. No "production-ready", "bulletproof", "zero risk" phrasing about the workflow, harness, or config.
3. No "guaranteed" claims about GitHub uptime, runner availability, or third-party action behavior.
4. No "100% coverage" claim — coverage statements name the exact seven packages or the exact two specs, with counts.
5. No "future-proof" phrasing — pins and job lists state the present; extension is a later phase's problem.
6. `grep -ri` over this plan's created files returns zero matches for the token list above (checked in the plan summary).

<verification>
Plan-level checks: `pnpm run test:integration:docker` green (Task 1); `pnpm exec playwright test -c playwright.ci.config.ts --list` shows exactly two specs (Task 2); `pnpm vitest run --project unit tests/unit/ci-workflow-contract.test.ts` green with a recorded negative self-check (Task 3); .gitattributes/.npmrc match the recorded decision and the renormalize dry-run was captured (Task 5); token grep zero matches; no existing playwright config, harness script, or package.json modified by this plan.</verification>

<success_criteria>
1. ci.yml has exactly three ubuntu-latest jobs with the pinned prologue, and the integration/e2e bodies are the proven local implementations replayed verbatim.
2. The unit gate now enforces the workflow's full security contract (CI-02 backstop) on every push, proven by a recorded regression self-check.
3. The portable E2E pair runs under a webServer-less config with a closed two-file spec list; the Windows-only suites remain out of default CI.
4. Line-ending and engine pins land exactly as the human decided, with no collateral renormalization.
5. Every task green per the sampling contract; plan artifacts contain none of the prohibited tokens.
</success_criteria>

<output>Create `.planning/phases/07-ci-pipeline-quality-gates/07-PLAN-2-SUMMARY.md` when done (subsystem: ci, tags: ci, e2e, workflow-security, pins).</output>
