---
phase: 07-ci-pipeline-quality-gates
plan: 3
type: execute
wave: 3
depends_on: [07-PLAN-1-ci-workflow-and-quality-gates, 07-PLAN-2-integration-e2e-jobs-and-repo-pins]
files_modified: []
autonomous: false
requirements: [CI-01, CI-02, CI-03, CI-04]
user_setup:
  - service: github
    why: "The pipeline must execute on the real remote and branch protection requires repository admin"
    dashboard_config:
      - task: "Confirm GitHub Actions is enabled for VadyaLegolas/bet-stats (a disabled Actions tab blocks every job — research assumption A3)"
        location: "https://github.com/VadyaLegolas/bet-stats/settings/actions"
      - task: "Confirm the pushing account holds admin rights (the branch-protection API call returns 403 otherwise)"
        location: "https://github.com/VadyaLegolas/bet-stats/settings/access"
estimate:
  tokens: 60000
  raw_tokens: 60000
  tasks: 3
  confidence: low
must_haves:
  truths:
    - "A pull request against main triggers all three checks (quality, integration, e2e-portable) and every conclusion is success — the first real-GitHub proof of CI-01/CI-02, including the Linux behavior of the two portable E2E specs (research A4)"
    - "Branch protection on main requires exactly the contexts quality, integration, e2e-portable and disallows force pushes (gh api proof recorded)"
    - "Each deliberate breakage turns exactly the corresponding job red: a type error and a failing unit test fail quality; a raw UPDATE against a seeded ForecastSnapshot row without rejection handling fails integration (CI-04 enforced live)"
    - "While a required check is red, `gh pr merge` is refused by GitHub (merge-blocked proof captured from the command output)"
    - "The drill branch is closed without merge, no ci-drill file exists on main, and main's latest CI run concludes success (success criterion 4 complete)"
    - "Prohibition tokens (see ## Prohibitions) appear in zero artifacts produced by this plan (grep-verified)"
  artifacts: []
  key_links:
    - push to GitHub -> .github/workflows/ci.yml -> three required checks -> branch protection merge gate (the loop success criterion 4 closes)
    - tests/integration/mutation-rejection.test.ts -> integration job on a real runner -> the drill's frozen-table mutation going red proves the DB-trigger enforcement is CI-visible
---

<objective>
Prove the pipeline on the real remote: observe the first green three-job run, enable branch protection that makes those checks required, then deliberately break the pipeline in the three sanctioned ways (type error, failing test, frozen-table mutation) and prove each red run blocks the merge before reverting to green.

Purpose: a pipeline nobody is forced to pass is decorative; this plan converts the workflow into an enforced merge gate and executes the ROADMAP's success criterion 4 end-to-end.

Output: recorded GitHub run evidence (run IDs, conclusions), branch protection enabled via gh api, and a closed drill branch; no product-code files change in this plan.

<assumption_delta>
None (scan detected:false, 2026-10-20). Research assumptions resolved here rather than by a delta: A3 (Actions enabled) is checked in Task 1 and routes to user_setup if false; A4 (portable specs pass on Linux) is proven for real in Task 1 with a fix-forward loop; the posix teardown path (process.kill(-pid) without detached spawn in live-evidence-stack stopOwned, currently swallowed ESRCH) only matters if the e2e job hangs after tests — address it in the fix-forward loop only if observed.
</assumption_delta>

<api_coverage_scan>
No outbound provider calls: the drill executes repo-owned CI only. CI-02's no-live-provider contract is already unit-enforced (plan 2 contract test) and now additionally proven by real runner logs available to the operator. No external_apis block required; no {N}-api-coverage.json emitted.
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
@.planning/phases/07-ci-pipeline-quality-gates/07-VALIDATION.md
@.planning/phases/07-ci-pipeline-quality-gates/07-PLAN-1-ci-workflow-and-quality-gates.md
@.planning/phases/07-ci-pipeline-quality-gates/07-PLAN-2-integration-e2e-jobs-and-repo-pins.md
@tests/integration/forecast-snapshots.test.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: First real pipeline run on GitHub (Linux proof, A3/A4 resolution)</name>
  <files></files>
  <read_first>.github/workflows/ci.yml (final state from plans 1-2), tests/e2e/live-evidence-stack.ts (fix-forward reference for Linux issues), tests/e2e/evidence-scorecard.spec.ts, tests/e2e/team-evidence-live.spec.ts, 07-RESEARCH.md (Assumptions A1/A3/A4, Environment Availability)</read_first>
  <action>Plans 1-2 land on main via their own commits, so pushes to main have already triggered CI runs. Verify the toolchain, then observe. (1) Check `gh --version` and `gh auth status`; on an auth error create the standard auth checkpoint (user runs `gh auth login`, then retry) — do not proceed without auth. (2) Confirm the repo remote is github.com/VadyaLegolas/bet-stats on main and list the newest runs: `gh run list --repo VadyaLegolas/bet-stats --workflow CI --limit 5 --json databaseId,name,conclusion,status,headBranch`. (3) Watch the newest main run to completion: `gh run watch <run-id> --repo VadyaLegolas/bet-stats` and confirm all three jobs — quality, integration, e2e-portable — concluded success. If Actions is disabled on the repo (A3), stop and hand the user the dashboard_config entry from user_setup; never enable it via API without asking. (4) Linux fix-forward loop for e2e-portable (A4 — the specs were authored on Windows): if the e2e job fails, pull logs with `gh run view <id> --repo VadyaLegolas/bet-stats --log-failed`, diagnose, and apply the minimal targeted fix — most likely suspects in order: corepack availability (add/adjust the `corepack enable` step), the posix teardown path in live-evidence-stack stopOwned (process.kill(-pid) without a detached spawn throws ESRCH that is currently swallowed; if the job hangs after tests, make the posix branch kill the individual recorded child PIDs the way the win32 branch does — a cross-platform, behavior-preserving change), or path/case issues. Commit each fix to main with a conventional message, push, re-run via `gh run rerun <id> --repo VadyaLegolas/bet-stats`, and repeat until green. If a spec fails on a genuine behavioral difference that cannot be fixed minimally, STOP and report the blocker with the failing log excerpt — do NOT remove a spec from the CI file list, do NOT mark the job continue-on-error, do NOT weaken an assertion. The same discipline for any other red job: fix the cause, never the gate. Record every run id and conclusion in the task summary.</action>
  <verify>
    <automated>gh run list --repo VadyaLegolas/bet-stats --workflow CI --limit 1 --json conclusion,headBranch,workflowName --jq ".[0] | select(.conclusion == \"success\" and .headBranch == \"main\")"</automated>
  </verify>
  <acceptance_criteria>
    - The newest main run of workflow CI concludes success and includes exactly the jobs quality, integration, e2e-portable (captured with `gh run view <id> --json jobs`).
    - Each fix-forward commit (if any) is minimal, conventional-commits styled, and its re-run went green; no gate was weakened (git diff of ci.yml across fix commits touches no permissions, no job removal, no assertion removal — cite the diff in the summary).
    - The integration job's log shows the mutation-rejection tests executing (grep the job log for `mutation-rejection`).
    - The e2e job's log shows both portable specs passing (`grep` the job log for `evidence-scorecard.spec.ts` and `team-evidence-live.spec.ts` with a 100% pass line).
    - No drill or temporary file has been pushed at this point: `git status --porcelain` empty and main tree contains no ci-drill file.
  </acceptance_criteria>
  <done>All three checks are green on real Linux runners; A3 and A4 are resolved with evidence; any Linux portability fix is committed minimally and recorded.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking-human">
  <name>Task 2: Enable branch protection on main (required checks)</name>
  <files></files>
  <read_first>Task 1's recorded green run (the check names must exist in run history before GitHub accepts them as required), 07-VALIDATION.md (Manual-Only Verifications table)</read_first>
  <action>Branch protection is a repository-settings mutation and needs the human's confirmation (and admin rights). Prepare the protection payload as a JSON file (write it to a temp path with the Write tool — never via a heredoc) containing exactly these fields: required_status_checks: { "strict": false, "contexts": ["quality", "integration", "e2e-portable"] }; "enforce_admins": false (solo-operator workflow: normal PR merges are fully gated; the admin bypass is an accepted, recorded emergency escape — severity-low residual, see threat model); "required_pull_request_reviews": null; "restrictions": null; "allow_force_pushes": false; "allow_deletions": false. Show the payload to the human, get an explicit go-ahead, then apply it: `gh api -X PUT repos/VadyaLegolas/bet-stats/branches/main/protection --input <payload-file>`. If the call returns 403/404, escalate to the user (admin rights or repo plan limits — private-repo protection needs GitHub Pro/Team; if the API refuses on plan grounds, the human must either upgrade or accept running without enforced protection — record that decision explicitly as a deviation with the red-run evidence standing in for the merge gate). Read back the protection and paste it into the summary: `gh api repos/VadyaLegolas/bet-stats/branches/main/protection --jq "{contexts: .required_status_checks.contexts, force_pushes: .allow_force_pushes.enabled, admin_bypass: .enforce_admins.enabled}"`. Precondition for proceeding to Task 3: the read-back shows all three contexts.</action>
  <verify>
    <automated>gh api repos/VadyaLegolas/bet-stats/branches/main/protection --jq ".required_status_checks.contexts | sort | join(\",\")" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const v=d.trim();if(v!=='e2e-portable,integration,quality'){console.error('protection contexts mismatch: '+v);process.exit(1);}console.log('protection ok: '+v);})"</automated>
  </verify>
  <acceptance_criteria>
    - The human explicitly approved the exact payload before the PUT (recorded in the summary with the payload file content).
    - The automated read-back prints `protection ok: e2e-portable,integration,quality`.
    - The recorded residual risk: enforce_admins is false (documented admin escape) and allow_force_pushes is false.
    - If the API refused due to the repo plan, the deviation is recorded with the user's explicit choice.
  </acceptance_criteria>
  <done>main requires all three checks; force pushes are disabled; the read-back proof is in the summary.</done>
  <resume-signal>The human approves the exact protection payload shown to them; the PUT is applied and the automated read-back passes, or the deviation path is explicitly chosen and recorded.</resume-signal>
  <what-built>Branch protection on main: required status checks quality, integration, e2e-portable; force pushes and deletions disallowed; admin bypass off-for-everyday-merges (enforce_admins false, recorded).</what-built>
  <how-to-verify>The checkpoint's automated read-back prints `protection ok: e2e-portable,integration,quality`; the raw `gh api .../protection` JSON is pasted into the task summary; Task 3's merge-refusal capture proves enforcement live.</how-to-verify>
</task>

<task type="auto">
  <name>Task 3: Deliberate-breakage drill — red pipeline, blocked merge, revert to green (success criterion 4)</name>
  <files></files>
  <read_first>tests/integration/forecast-snapshots.test.ts (lines 13-21 fixture seed, lines 32-46 ForecastSnapshot INSERT + UPDATE assertion — the drill reuses the INSERT verbatim), .github/workflows/ci.yml, 07-VALIDATION.md (Manual-Only drill instructions), package.json (engines note: the drill commits build on CI under Node 24 regardless of the local host)</read_first>
  <action>Execute three drills on one throwaway branch, one drill commit at a time, so each red run is attributable to exactly one breakage. Setup: create branch `ci/phase7-drill` from main, push it, and open the PR: `gh pr create --repo VadyaLegolas/bet-stats --base main --head ci/phase7-drill --title "Phase 7 CI drill" --body "Deliberate breakage drill; closed unmerged by design."`. PR note: the PR-body sentence is operational, not a claim about the product. DRILL 1 — type error (CI-01 quality): add file apps/api/src/ci-drill-type-error.ts containing `export const ciDrillProbe: number = "type-error-drill";`, commit `test(ci): deliberate type error drill`, push, wait the run with `gh run watch`, assert the quality job concluded failure (`gh run view <run-id> --json jobs --jq` the quality job conclusion == "failure"), then attempt the merge while red — `gh pr merge ci/phase7-drill --repo VadyaLegolas/bet-stats --squash` MUST be refused (capture the refusal output verbatim: this is the merge-blocked proof for success criterion 4). Revert with `git revert --no-edit HEAD`, push, wait for green. DRILL 2 — failing test (CI-01 test gate): add tests/unit/ci-drill-failing.test.ts with a single vitest test asserting expect(1).toBe(2) (describe/it form, imported from vitest), commit `test(ci): deliberate failing-test drill`, push, assert the quality job failed on the test step, revert, push, green. DRILL 3 — frozen-table mutation (CI-04 enforced live): add tests/integration/ci-drill-mutation.test.ts that (a) throws without DATABASE_URL, (b) in beforeAll seeds the minimal chain with raw SQL copied from forecast-snapshots.test.ts lines 14-21 and 33-35 under drill-prefixed ids (League/Season/Team/Fixture + one ISSUED ForecastSnapshot — the INSERT is allowed by the guard trigger; the seed is REQUIRED because a row-trigger cannot fire on a zero-row statement, and the drill must go red on purpose), (c) runs one test executing `prisma.$executeRawUnsafe('UPDATE "ForecastSnapshot" SET assumptions=... WHERE id=$1', <drill id>)` with NO rejection handling — the `ForecastSnapshot_guarded_immutable` trigger raises, the test fails, and the integration job turns red, proving CI-04's DB-layer enforcement is visible in CI. Commit `test(ci): deliberate frozen-table mutation drill`, assert the integration job conclusion == failure while quality and e2e-portable stay green (isolation proof), revert, push, green. Teardown: confirm the PR diff is now empty, close it unmerged with `gh pr close ci/phase7-drill --repo VadyaLegolas/bet-stats --delete-branch`, verify main's newest run is success and that no drill file exists on main (`gh api repos/VadyaLegolas/bet-stats/contents/apps/api/src/ci-drill-type-error.ts` returns 404; same for both test files). Wall-time note: six full runs at three jobs each — expect roughly 40-60 Actions minutes; do not batch drills into one commit. Record every run id, job conclusion, the merge-refusal output, and the close confirmation in the task summary. Local pnpm is not required anywhere in this task (important when plan 2's engine-strict decision left the dev host on Node 25).</action>
  <verify>
    <automated>gh run list --repo VadyaLegolas/bet-stats --workflow CI --branch main --limit 1 --json conclusion --jq ".[0].conclusion" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const v=d.trim().replace(/\"/g,'');if(v!=='success'){console.error('main not green: '+v);process.exit(1);}console.log('main green');})" && gh pr view ci/phase7-drill --repo VadyaLegolas/bet-stats --json state --jq .state 2>nul || echo "PR already closed"</automated>
  </verify>
  <acceptance_criteria>
    - Drill 1: quality job conclusion == "failure" on the type-error commit; `gh pr merge` refusal output captured verbatim; green after revert.
    - Drill 2: quality job conclusion == "failure" on the failing-test commit; green after revert.
    - Drill 3: integration job conclusion == "failure" while quality and e2e-portable concluded "success" on the same run (isolation captured from --json jobs); green after revert.
    - Every red run happened with branch protection active — the merge attempt was refused, proving the required checks block merges (success criterion 4).
    - The drill PR is closed unmerged with its branch deleted; `git log --oneline main -- apps/api/src/ci-drill-type-error.ts tests/unit/ci-drill-failing.test.ts tests/integration/ci-drill-mutation.test.ts` is empty on main; the three 404 content checks pass.
    - Main's newest CI run concludes success; the phase gate (first green run of all three jobs on main plus a proven red-blocks-merge drill) is recorded in the task summary with run ids.
    - No drill artifact, temporary branch, or protection payload file remains in the working tree.
  </acceptance_criteria>
  <done>All three sanctioned breakages turned exactly the right job red, the merge was refused while red, everything reverted to green, and the drill branch is closed unmerged — CI-01..CI-04 proven end-to-end.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Operator account → GitHub settings | branch protection is a settings mutation reachable by the admin account and the gh token |
| Drill branch → main | deliberately broken commits pass through the PR merge path that protection must block |
| gh CLI session → remote | every drill command carries the operator's credentials |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-7-11 | Tampering | merge path on main | high | mitigate | Required contexts quality/integration/e2e-portable; Task 3 proves refusal on a red PR by attempting the merge and capturing the output |
| T-7-12 | Tampering | protected history rewrite | medium | mitigate | `allow_force_pushes: false` and `allow_deletions: false` in the protection payload; read-back asserted |
| T-7-13 | Information Disclosure / Integrity | deliberate defects leaking to main | medium | mitigate | Drill commits live only on ci/phase7-drill, the PR is closed unmerged with branch deletion, and three 404 content checks prove main never carried the drill files |
| T-7-14 | Spoofing | admin bypass of protection | low | accept | enforce_admins: false is a recorded, solo-operator emergency escape; every normal merge path is gated; re-evaluate if collaborators join |
| T-7-SC | Information Disclosure | gh credentials in commands/logs | medium | mitigate | Protection payload written to a temp file and passed via --input (no token interpolation); gh stores auth in its own keyring; no token ever appears in a command string, commit, or workflow file |

## ASVS L1 Mapping (V4 Access Control / V8 Software Integrity)

- Merge-gate enforcement with required status checks — T-7-11 (the phase's access-control surface is the merge path itself).
- No history rewrite on the protected branch — T-7-12.
- Credential hygiene for the operator token — T-7-SC.
</threat_model>

## Edge Coverage

Every specless probe row, resolved. Resolution classes: explicit (acceptance criterion), backstop (test is the proof), FLAGGED ASSUMPTION.

| Req | Category | Resolution | Criterion / test | Enforced in |
|-----|----------|------------|------------------|-------------|
| CI-01 | adjacency | explicit | Drills run one commit at a time on one branch so each red run attributes to exactly one breakage — no adjacent breakages blur the signal; the PR-vs-main adjacency (push to main AND open PR) cannot double-run because drill pushes target ci/phase7-drill only | Plan 3 Task 3 |
| CI-01 | empty | explicit | The merge-blocked proof uses a real red run, not a hypothetical; an empty-drill (no-op commit) is explicitly not used as evidence — zero-diff pushes prove nothing and are excluded from the drill | Plan 3 Task 3 |
| CI-01 | ordering | explicit | The quality-step order proven in plans 1-2 manifests here: the type-error red stops quality at typecheck, before lint/test/build — the job log excerpt shows later steps skipped (GitHub step ordering), captured with the drill evidence | Plan 3 Task 1/3 |
| CI-01 | concurrency | explicit | `gh run watch` serializes the operator on the run the drill commit produced; the workflow's per-ref cancel-in-progress (plans 1-2) means a rapid follow-up push cancels the stale run — drills always wait for the run of the exact head SHA they pushed (assert headSha matches before reading conclusions) | Plan 3 Task 3 |
| CI-02 | unclassified | backstop | Unit-level backstop shipped in plan 2; plan 3 adds live evidence: integration and e2e job logs on real runners show only owned containers/loopback stacks and zero provider-credential env (log inspection recorded in Task 1) | Plan 2 Task 3 + Plan 3 Task 1 |
| CI-03 | adjacency | backstop | Meta-test from plan 1 runs inside every quality job of every drill run — coverage regressions surface in the same gate the drill exercises | Plan 1 Task 3 |
| CI-03 | ordering | explicit | CI-03's ordering requirement is satisfied at this moment: branch protection (making lint a REQUIRED gate) is enabled only after the full lint-covered pipeline went green on main (Task 1 evidence precedes Task 2's PUT) | Plan 3 Task 2 |
| CI-03 | concurrency | explicit | Unchanged from plan 1: aggregate exit code is the contract; protection requires the check by name, so fan-out order can never affect the merge decision | Plan 3 Task 2 |
| CI-04 | unclassified | explicit + backstop | Drill 3 is the live backstop: a raw UPDATE with a seeded row, run with zero rejection handling, fails the required integration job on a real runner while the other two jobs stay green — proving the trigger (not test plumbing) is what blocks mutations, and that a zero-row statement would NOT have fired (seed requirement documented in the drill) | Plan 3 Task 3 |

FLAGGED ASSUMPTION: if the repository's GitHub plan refuses branch-protection APIs on a private repo, the merge gate cannot be enforced this phase; the Task 2 checkpoint records the user's explicit choice (upgrade, or accept red-run evidence as the practical gate) — the phase does not silently declare protection enabled without the read-back proof.

## Prohibitions

Forbidden tokens in any artifact this plan produces (summaries, PR bodies, commit messages, task output claims): "guaranteed", "always green", "zero risk", "production-ready", "never fails", "bulletproof", "100% coverage", "future-proof". Explicit rules:

1. The drill proves the pipeline CAN go red — no summary may frame red runs as anomalies or claim the pipeline is "always green" or can "never fail".
2. No "guaranteed" merge-safety or "zero risk" claims: protection gates checks; it does not remove the need for review.
3. No "production-ready"/"bulletproof" language about the pipeline or protection config.
4. No "100% coverage" claims about drill coverage — three sanctioned breakages were exercised, stated as exactly that.
5. No "future-proof" language about required-check lists — the three contexts are today's job ids.
6. `grep -ri` over the plan summary and any file this plan creates returns zero matches for the token list above.

<verification>
Plan-level checks: newest main workflow run concludes success with all three jobs (Task 1); protection read-back shows exactly e2e-portable,integration,quality with force pushes disabled (Task 2); the drill summary contains three failure run ids, one merge-refusal capture, three green reverts, a closed unmerged PR, and three 404 content checks (Task 3); token grep zero matches.</verification>

<success_criteria>
1. Success criterion 1-3 of the ROADMAP phase are observable in GitHub: full pipeline on PR, Linux-only Docker integration failing loudly, lint and mutation gates required.
2. Success criterion 4 is executed, not assumed: type error, failing test, and frozen-table mutation each turned the pipeline red and the merge was refused while red.
3. Branch protection read-back proof recorded; deviations (if any) carry the user's explicit decision.
4. Zero drill residue on main; phase gate evidence (run ids, conclusions) recorded for /gsd-verify-work.
</success_criteria>

<output>Create `.planning/phases/07-ci-pipeline-quality-gates/07-PLAN-3-SUMMARY.md` when done (subsystem: ci, tags: ci, branch-protection, drill, verification).</output>
