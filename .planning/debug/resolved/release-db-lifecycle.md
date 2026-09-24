---
status: resolved
trigger: "Phase 06 Plan 06-09 release verification integration gate repeatedly loses its owned PostgreSQL/Redis resources during replay suites."
created: 2026-09-23T00:00:00+02:00
updated: 2026-09-24T12:00:00+02:00
---

## Current Focus

hypothesis: Resolved — all deterministic release lifecycle, fixture, queue identity, child supervision, and cross-project E2E isolation defects are fixed; the isolated `ERR_NO_BUFFER_SPACE` was transient environment noise and did not recur from a clean preflight.
test: Completed one clean full `pnpm verify:release` retry under Node 24.14.0, pnpm 10.34.5, and Docker 29.7.2.
expecting: Satisfied — typecheck 7/7, unit 236/236, integration 451/451, build 7/7, and Playwright 54/54 passed.
next_action: None; session archived after successful end-to-end verification. Scoped fix commit: 8920720.
bug_class: Bohrbug with one transient environment failure during verification

reasoning_checkpoint:
  hypothesis: "A post-readiness API exit hangs the integration owner because supervision.failure was only observed by a detached catch, while observe() discarded the diagnostic tail after streaming it."
  confirming_evidence:
    - "The implementation raced supervision.failure only while waiting for web readiness; after that it attached a detached catch and returned no failure handle to the Vitest owner."
    - "The RED owner oracle failed because runSupervisedLiveOwner did not exist; the prior full run showed the API exit after both services reached readiness and the parent then hung."
  falsification_test: "An indefinitely pending owner that races supervision.failure does not reject promptly after a simulated API status-1 exit, or the rejection omits the supplied API diagnostic."
  fix_rationale: "Returning the supervision handle, racing the Vitest-owned callback against it, and retaining a bounded redacted output tail connects the child failure to awaited control flow while preserving the underlying cause."
  blind_spots: "The focused Docker harness may not reproduce the original API crash; the complete release gate remains a separate final verification after this focused lifecycle check."
  candidate_causes:
    - "code: missing awaited consumer for the post-readiness supervision rejection and no retained child diagnostic."
    - "environment: a real PostgreSQL/Redis/API failure triggers the child exit, but should not be able to hang the owner regardless of its specific cause."
  and_gate: "yes — the hang requires both a child exit and the missing owner race; cause loss additionally requires output streaming without retention."

prior_reasoning_checkpoint:
  hypothesis: "The mobile failures occur because Playwright runs the complete stateful suite once per project against one shared release database while these tests assume fresh per-project state and desktop-visible navigation."
  confirming_evidence:
    - "Both operator artifacts render Showing 1–2 of 2; release-degradation seeds the additional release-dead-letter record during the first project."
    - "The privacy mobile run reuses release-privacy-subject after the desktop withdrawal permanently sets retentionBlockedAt, so opt-in fails and the history-view POST is non-ok."
    - "The mobile snapshot exposes a Menu button and no navigation links; the existing accessibility test opens Menu before asserting those links."
  falsification_test: "A fresh focused mobile run with a project-scoped privacy subject and non-hard-coded pagination still fails with the same API/UI evidence."
  fix_rationale: "Project-scoped subject identity removes the cross-project persistent-state collision; semantic role locators and opening the mobile menu assert the intended contracts; a bounded pagination pattern tests pagination without assuming global fixture cardinality."
  blind_spots: "The focused run does not cover every phase-06 spec or the complete release command; those remain the next verification step after focused green."
  candidate_causes:
    - "code/test: hard-coded global count, reused subject identity, ambiguous text locator, and unopened responsive menu."
    - "data: one shared release database accumulates records and privacy block state across Playwright projects."
    - "config/environment: phase06 defines two serial browser projects under one global setup rather than recreating dependencies per project."
  and_gate: "yes — the privacy API failure needs both shared database lifetime and reused subject identity; the missing Fixtures assertion needs the mobile project plus a collapsed menu."

## Symptoms

expected: `pnpm verify:release` runs every integration suite against owned PostgreSQL 18 and Redis 8, then cleans resources after all suites complete.
actual: The full integration gate and a serial retry both lose the owned database before replay suites finish.
errors: "ECONNREFUSED 127.0.0.1:56405 in replay and replay-boundary; serial reproduction ECONNREFUSED 127.0.0.1:51732 in replay."
reproduction: Run the full integration stage of `pnpm verify:release`; prerequisites, frozen install, Prisma validate, typecheck 7/7, and unit 232/232 pass before the integration failure.
started: Discovered while executing Phase 06 Plan 06-09 Task 3.

## Eliminated

- hypothesis: Product behavior or degradation assertions are failing.
  evidence: D-16 production-like suite passes 7/7, desktop/mobile gate passes 22/22, and correction lineage passes 2/2.
- hypothesis: The dead-letter test alone deterministically leaks its worker into the immediately following RESULTS test.
  evidence: A fresh two-test run selecting exactly dead-letter then RESULTS passed 2/2; leakage needs additional full-file/full-run timing pressure.
  timestamp: 2026-09-23T22:08:00+02:00
- hypothesis: The OPEN durable-policy worker is unready and leaves its exact job waiting.
  evidence: In the full-file failure the worker reported running=true and the exact job was missing, not waiting; the plan matched an earlier test's identical replay identity whose job had been deliberately removed.
  timestamp: 2026-09-24T06:20:00+02:00

## Evidence

- timestamp: 2026-09-24T12:00:00+02:00
  checked: Clean preflight before the final authorized release retry
  found: Windows reported 23 TCP connections in TIME_WAIT, with no owned release containers, processes, listeners, or live-release state remaining.
  implication: The retry began from a clean lifecycle state without evidence of persistent owned-resource leakage or TCP table saturation.

- timestamp: 2026-09-24T12:00:00+02:00
  checked: Final clean `pnpm verify:release` under Node 24.14.0, pnpm 10.34.5, and Docker 29.7.2
  found: Exit 0. Prerequisites, frozen install, Prisma validation, typecheck 7/7, unit 25 files/236 tests, integration 55 files/451 tests, build 7/7, and Playwright 54/54 all passed.
  implication: The original lifecycle failure and every discovered regression are resolved end to end; the prior desktop `ERR_NO_BUFFER_SPACE` did not recur.

- timestamp: 2026-09-24T11:38:00+02:00
  checked: Read-only retained Playwright trace, network record, Windows TCP state, release-stack state/listeners, process inventory, and elevated Docker container inventory after the lone desktop failure
  found: The trace shows Chromium created a fresh context/page, then the first document GET failed in about 25 ms with response status -1, no headers/body/timing, and `_failureText: net::ERR_NO_BUFFER_SPACE`; therefore no HTTP response or application assertion was reached. The same mobile case later passed in the same run. Current Windows state is not saturated (26 TIME_WAIT, 50 ESTABLISHED, 6 CLOSE_WAIT against a 16,384-port dynamic range), ports 3240/3241 have no listeners, the live-release state file is absent, no Playwright Chrome or release-owned Node process is present, and Docker lists no bet-stats/Testcontainers containers (only three unrelated month-old exited containers).
  implication: This is high-confidence host/browser transport failure rather than a product defect, and persistent child/container leakage from the release harness is not supported. The specific transient resource-exhaustion mechanism is only medium/low confidence because socket state was sampled after cleanup, not at failure time. Cleanup invariants now satisfy a safe criterion for exactly one retry with contemporaneous diagnostics required on recurrence.

- timestamp: 2026-09-24T11:15:00+02:00
  checked: Authorized full `pnpm verify:release` after the awaited supervisor-owner fix
  found: Node v24.14.0, pnpm 10.34.5, Docker 29.7.2, frozen install, Prisma validation, typecheck 7/7, unit 25 files/236 tests, integration 55 files/451 tests, and build 7/7 passed. Playwright passed 53/54. The only failure was desktop-chromium `tests/e2e/release-degradation.spec.ts:66` line 73: `page.goto('/internal/operations?page=1&pageSize=25&windowHours=24')` failed with `net::ERR_NO_BUFFER_SPACE`; the identical mobile test subsequently passed.
  implication: Database ownership, supported runtime propagation, supervisor consumption, integration lifecycle, build, and nearly the entire browser matrix are green. The remaining failure is an environment/transport candidate requiring trace and Windows socket-resource inspection before any retry; no second full run is authorized.

- timestamp: 2026-09-24T10:25:00+02:00
  checked: Identical focused live-provider harness retry under Node 24.14.0 and Docker 29.7.2
  found: API and web reached readiness, the Vitest owner completed, both process trees closed cleanly, and live-provider-harness-smoke passed 3/3 in 58.81s.
  implication: The real owned lifecycle remains green with the awaited owner-race implementation; the complete PATH-correct release gate is now the next verification step.

- timestamp: 2026-09-24T10:21:00+02:00
  checked: First focused Docker harness invocation after owner-race fix
  found: The wrapper stopped before Vitest because Prisma migrate deploy was invoked from the repository root and therefore could not resolve the datasource URL from packages/database/prisma.config.ts.
  implication: This was an invocation error and exercised neither the live harness nor the fix; rerun the single self-owning live-provider-harness-smoke file directly under Node 24.

- timestamp: 2026-09-24T10:18:00+02:00
  checked: Test-first post-readiness owner-race and diagnostic oracle under Node 24
  found: The new test failed RED with `runSupervisedLiveOwner is not a function`, then passed GREEN as part of 4/4 focused lifecycle tests after the owner race and bounded diagnostic tail were implemented.
  implication: The previously missing awaited consumer is directly covered; a simulated API status-1 exit now terminates the web sibling and rejects the pending owner with the underlying API diagnostic.

- timestamp: 2026-09-24T09:40:00+02:00
  checked: Final authorized PATH-correct elevated full `pnpm verify:release`
  found: Node v24.14.0, pnpm 10.34.5, Docker 29.7.2, frozen install, Prisma validation, typecheck 7/7, and unit 25 files/235 tests passed. During owned integration, API and web reached readiness, then pnpm emitted `ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL @bet-stats/api@0.0.0 dev: node --enable-source-maps dist/main.js` with exit status 1. Despite child supervision, the parent produced no further output for about three minutes and required Ctrl-C; no integration summary, build, or E2E ran.
  implication: The supervisor implementation alone does not connect a post-readiness child failure to the Vitest owner's awaited lifecycle. The next investigation must prove the missing consumer path and capture the API's underlying fatal cause before another complete run.

- timestamp: 2026-09-24T09:28:00+02:00
  checked: Cross-project held-out subset with release-degradation, operator-overview, and privacy-retention under Node 24 and the owned Docker release stack
  found: All 24/24 tests passed. Desktop release-degradation seeded the second failed-work record before the mobile project began; mobile operator-overview still passed both viewport cases, and mobile privacy passed all three cases with its project-scoped identity.
  implication: The exact cross-project data-pollution condition is now covered and green. The fix is focused, additive rather than behavior-deleting, and adjacent degradation behavior remains green; the complete release gate is the remaining verification step.

- timestamp: 2026-09-24T09:22:00+02:00
  checked: Held-out mobile-only subset containing release-degradation, operator-overview, and privacy-retention
  found: All 12/12 tests passed, but Playwright ordered operator-overview before release-degradation, so this run did not recreate the original operator predecessor sequence.
  implication: Mobile project behavior and adjacent degradation tests are green; one cross-project three-file run is required because desktop release-degradation state persists into mobile operator-overview.

- timestamp: 2026-09-24T09:18:00+02:00
  checked: Focused GREEN rerun of operator-overview and privacy-retention across both configured projects under Node 24 and the owned Docker release stack
  found: All 10/10 tests passed: desktop 5/5 and mobile 5/5. Each project used an independent signed privacy subject, semantic status-heading lookup was unique, and the mobile missing-subject case opened the responsive menu before asserting Fixtures.
  implication: The privacy cross-project collision and mobile locator/navigation defects are fixed. A held-out mobile run including release-degradation is still needed to exercise the operator count pollution directly.

- timestamp: 2026-09-24T09:12:00+02:00
  checked: Focused RED run of operator-overview and privacy-retention across desktop-chromium then mobile-chromium under Node 24 and the owned release stack
  found: Desktop passed 5/5; mobile operator passed 2/2 because release-degradation was absent from the focused set; mobile privacy reproduced 3/3 failures: ambiguous off-state text, non-ok retained-history POST after the desktop project blocked the shared subject, and hidden Fixtures link behind the collapsed menu. Total 7 passed, 3 failed.
  implication: The focused run confirms all privacy mechanisms directly. The operator artifact plus focused pass differentiates data pollution from responsive rendering: its hard-coded total fails only when another spec has added a valid failure record.

- timestamp: 2026-09-24T09:05:00+02:00
  checked: Phase-06 project matrix and all five retained failure contexts plus first operator screenshot
  found: Both projects run every selected spec against one global release stack. The two operator artifacts contain the required record and render `Showing 1–2 of 2`, not a missing responsive element. Privacy artifacts show a strict locator resolving heading plus explanatory paragraph, a failed consent operation followed by non-ok history POST, and mobile navigation collapsed to a Menu button.
  implication: The five failures are multiple deterministic test-isolation/oracle defects sharing the two-project matrix, not one product regression.

- timestamp: 2026-09-24T08:10:00+02:00
  checked: Authorized PATH-correct elevated full `pnpm verify:release` after live child supervision fix
  found: Node v24.14.0, pnpm 10.34.5, Docker 29.7.2, frozen install, Prisma validation, typecheck 7/7, unit 25 files/235 tests, integration 55 files/451 tests, and build 7/7 all passed. Playwright ran 54 tests: desktop-chromium passed 27/27; mobile-chromium passed 22 and failed 5. The first failure was `tests/e2e/operator-overview.spec.ts:30` (`desktop renders...`) at line 41 because `/Showing 1–1 of 1/` was not found. Remaining failures were the same operator-overview mobile case plus privacy-retention duplicate strict text, a retention API non-ok response, and a missing Fixtures navigation link. Overall result was 49 passed, 5 failed, exit 1.
  implication: The release database ownership, supported runtime propagation, complete integration suite, child cleanup, and production build are now green. Investigation must move to the first mobile Playwright failure without rerunning the complete gate.

- timestamp: 2026-09-24T07:43:00+02:00
  checked: Focused live-provider harness reproduction before the child-supervision fix
  found: The first isolated Node 24 + Docker run exited nonzero before child startup because Prisma migrate deploy hit a schema-engine error; it terminated promptly and therefore did not reproduce the post-readiness hang.
  implication: This run neither confirmed nor refuted the child-lifecycle hypothesis; a deterministic unit oracle was required at the ownership boundary.
- timestamp: 2026-09-24T07:43:00+02:00
  checked: Test-first child supervision oracle
  found: The new unit case failed RED with `superviseLiveChildren is not a function`, then passed 3/3 after implementing unexpected-exit propagation and sibling termination.
  implication: The regression test proves the previously absent contract: a child status-1 exit rejects the owner only after terminating the sibling.
- timestamp: 2026-09-24T07:43:00+02:00
  checked: Real focused Node 24 + Docker live-provider harness after the fix
  found: API and web reached readiness, teardown awaited both process trees, and the focused file passed 3/3 in 57.20s with exit code 0 and no recursive pnpm failure/hang.
  implication: Expected teardown is now distinguished from unexpected failure, and real child handles close promptly; the complete release gate is the remaining verification step.

- timestamp: 2026-09-24T06:02:00+02:00
  checked: First OPEN-only readiness diagnostic attempt
  found: The installed BullMQ worker exposes no usable public `client` value under its Redis adapter, so reading `client.status` threw before queueing; this did not exercise the product path.
  implication: Use BullMQ's public `isRunning()` readiness observation and exact job state only; do not infer dependency readiness from the module-level `worker.initialized` log, which is based on unrelated process environment flags.
- timestamp: 2026-09-24T06:05:00+02:00
  checked: OPEN diagnostic with worker created before queueing
  found: The worker reported `isRunning() === true`, but queueing after the circuit was set OPEN correctly created no ReplayDelivery; the diagnostic had changed the scenario's required ordering and therefore was not a valid reproduction.
  implication: Preserve the original queue-before-policy-mutation ordering, observe worker running state immediately after creation, and inspect that already-created exact delivery job on timeout.
- timestamp: 2026-09-24T06:07:00+02:00
  checked: Order-preserving focused OPEN durable-policy case under Node 24
  found: The exact case passed 1/1 without a readiness wait.
  implication: There is no deterministic per-case startup defect; the complete 21-test file is required to determine whether prior-test lifecycle pressure still exposes a waiting job/unready worker conjunction.
- timestamp: 2026-09-24T06:20:00+02:00
  checked: Complete replay-boundary file with OPEN-only readiness and job-state diagnostics
  found: OPEN failed 20/21 with worker running=true, exact BullMQ job missing, zero execution attempts, and the durable plan still QUEUED; the earlier tamper test uses the identical 2026-09-03 replay scope and removes that exact unexecuted job.
  implication: The startup-race hypothesis is eliminated. The failure is deterministic test-data identity collision plus intentional exact queue cleanup, not worker readiness.
- timestamp: 2026-09-24T06:23:00+02:00
  checked: Complete replay-boundary file after assigning tamper/idempotency an unused 2026-09-08 scope
  found: All 21/21 tests passed under Node 24 with no readiness wait or global queue cleanup.
  implication: The identity collision was the complete cause of the OPEN failure, and the minimal fixture isolation fix is locally verified.
- timestamp: 2026-09-24T06:25:00+02:00
  checked: First combined affected-suite invocation
  found: replay and replay-boundary passed 41 tests, but provider-policy and value-receipt correctly refused collection because the direct Vitest command did not provide the parent-owned DATABASE_URL.
  implication: This is a harness invocation error, not a product/test regression; rerun the same four files through the owned dependency gate before the full release command.
- timestamp: 2026-09-24T06:27:00+02:00
  checked: Four affected suites through the parent-owned PostgreSQL/Redis gate
  found: Provider-policy, value-receipt, replay, and replay-boundary passed 4/4 files and 59/59 tests together under Node 24.
  implication: Focused regression coverage is green; proceed to the single authorized full release verification.
- timestamp: 2026-09-24T06:30:00+02:00
  checked: Single full `pnpm verify:release` invocation
  found: The gate stopped at `verify:release:prerequisites` before install/tests because pnpm child scripts resolved inherited PATH to Node v25.2.1 even though the pnpm CLI itself was launched by Node v24.14.0.
  implication: No release assertions ran and no code regression was observed, but the one-full-run constraint has been consumed; commit/archive remain correctly deferred pending a newly authorized PATH-correct release attempt.

- timestamp: 2026-09-24T05:28:14+02:00
  checked: Authorized PATH-correct replacement `pnpm verify:release`
  found: The shared PowerShell environment reported Node v24.14.0 and pnpm 10.34.5, then `verify:release:prerequisites` failed with `permission denied while trying to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine`; exit code 1. No install, schema, typecheck, unit, integration, build, or Playwright stage ran.
  implication: The runtime-path condition is corrected, but the complete release gate remains unverified because Docker API access was denied before assertions. The one authorized run was consumed, so commit and archive remain deferred.

- timestamp: 2026-09-24T05:35:23+02:00
  checked: Authorized elevated PATH-correct full `pnpm verify:release`
  found: The shared environment reported Node v24.14.0 and pnpm 10.34.5. Docker server 29.7.2, frozen install, Prisma validation, Turbo typecheck 7/7, and unit tests 25 files/234 tests all passed. In the subsequent owned integration/live harness, Nest API started successfully and Next web became ready, then pnpm emitted `ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL @bet-stats/api@0.0.0 dev: node --enable-source-maps dist/main.js` with exit status 1. The shell remained hung with the web child alive until interrupted; overall exit code 1.
  implication: The prior Node/Docker prerequisite blockers are cleared and the release failure has advanced to API child termination plus incomplete live-harness sibling cleanup. No second full run is authorized; inspect the API exit evidence and harness ownership with focused/read-only methods before any rerun.

- timestamp: 2026-09-23T00:00:00+02:00
  checked: Full release verification integration stage
  found: replay.test reports 11 failures and replay-boundary reports 21 failures after owned PostgreSQL/Redis become unreachable on port 56405.
  implication: The failure is resource lifecycle/orchestration, not an individual replay assertion.
- timestamp: 2026-09-23T00:05:00+02:00
  checked: Serial integration retry with maxWorkers=1 and no file parallelism
  found: replay.test again reports 11 ECONNREFUSED failures on a new owned port 51732.
  implication: File-level parallelism is not sufficient to explain or fix the lifecycle bug.
- timestamp: 2026-09-23T00:10:00+02:00
  checked: Cleanup audit after failed runs
  found: No bet-stats/Testcontainers containers or owned Nest, Next, Vitest, or Playwright processes remain; unrelated exited containers were untouched.
  implication: A suite or shared teardown likely stops resources too early and cleanup ownership must be centralized.
- timestamp: 2026-09-23T16:45:00+02:00
  checked: Fresh Node 24 full integration reproduction
  found: Four suites failed collection because DATABASE_URL was absent; replay and replay-boundary also emitted ECONNREFUSED after their exact suite-owned containers were destroyed.
  implication: The release command has no durable parent owner spanning the complete Vitest child lifetime.
- timestamp: 2026-09-23T16:55:00+02:00
  checked: Focused test-first lifecycle oracle
  found: The new test failed RED because scripts/verify-release-integration.mjs did not exist, then passed 2/2 after implementing ordered parent ownership and finally cleanup.
  implication: The regression oracle directly enforces resource lifetime on both success and failing child exits.
- timestamp: 2026-09-23T17:12:00+02:00
  checked: First centralized owner run under explicit Node 24
  found: The owner and pnpm parent used Node 24, but Vitest workers and spawned integration app processes resolved G:\Programs\PhpWebStudy-Data\env\node\node.exe v25 from inherited PATH.
  implication: Runtime ownership is not transitive; the release integration gate does not actually enforce Node 24 for descendants.
- timestamp: 2026-09-23T20:59:00+02:00
  checked: Focused runtime-path regression oracle under Node 24
  found: The assertion failed RED with an absent child PATH prefix, then passed 2/2 after prepending dirname(process.execPath) while preserving the inherited PATH.
  implication: The owner now propagates its supported runtime transitively to pnpm, Vitest workers, and spawned integration processes.
- timestamp: 2026-09-23T21:09:00+02:00
  checked: Focused replay.test.ts under Node 24
  found: All 11 failures were RECOVERY_REASON_INVALID from a stale request fixture, not database loss; after adding the required audited reason the suite passed 20/20 with no ECONNREFUSED.
  implication: The earlier connection errors were teardown noise after assertion failures; replay resource lifetime itself is stable.
- timestamp: 2026-09-23T21:15:00+02:00
  checked: Focused Phase 01 security and forecast/Phase 03 suites
  found: Phase 01 prohibited an implemented Phase 05 api-football path; forecast-api and Phase 03 imported createPrismaForecastRepository from a module that no longer exports it; Phase 03 expected the superseded POST_CUTOFF_SOURCE_INPUT code. Focused reruns passed 5/5, 6/6, and 13/13 after contract-aligned test updates.
  implication: These were deterministic stale test contracts, not lifecycle defects.
- timestamp: 2026-09-23T21:19:00+02:00
  checked: Focused value-receipt setup
  found: Its beforeAll inserted three ForecastSnapshot rows with the same fixture/kind/revision unique key; distinct lifecycle revisions are required. Evidence-publication passed 4/4 in the same run.
  implication: The value receipt skip is a fixture construction bug; a revision fix is applied but still needs an isolated green rerun.
- timestamp: 2026-09-23T21:24:00+02:00
  checked: Final complete integration attempt after deterministic fixes
  found: value-receipt and replay skipped during setup, privacy-retention partially skipped, and replay-boundary RESULTS failed only in full-file order; focused replay passed 20/20 and focused RESULTS passed alone and in two predecessor subsets.
  implication: Remaining failures are cross-file/order-dependent integration isolation, not loss of the parent-owned database.
- timestamp: 2026-09-23T21:40:00+02:00
  checked: Focused value-receipt.test.ts against a fresh parent-owned PostgreSQL/Redis pair under Node 24
  found: The file fails in beforeAll with P0001 "forecast revision must link its predecessor" and skips all 10 tests.
  implication: The current failure is intrinsic to the value-receipt fixture; predecessor search is premature and the revision fixture must satisfy the database lineage invariant.
- timestamp: 2026-09-23T21:50:00+02:00
  checked: Corrected value-receipt lineage fixture against a second fresh parent-owned database
  found: The exact file passes 10/10 after revisions 2 and 3 link their immediate predecessors.
  implication: Missing fixture lineage was the complete focused-file cause; full-project verification can now test for independent cross-file leakage.
- timestamp: 2026-09-23T21:58:00+02:00
  checked: Complete 55-file integration project under the parent-owned Node 24 gate
  found: 53 files and 442 tests passed; provider-policy-approval skipped 8 after its private Prisma migration failed, and replay-boundary RESULTS reached DEAD_LETTER after three PROVIDER_TIMEOUT attempts.
  implication: Parent ownership is stable, but two independent suite-isolation/provider-stub defects remain; neither is a database connection loss.
- timestamp: 2026-09-23T22:09:00+02:00
  checked: Minimal replay predecessor pair and focused provider-policy suite
  found: Dead-letter plus RESULTS passed 2/2, and provider-policy passed 8/8 alone; both fail only under complete-run pressure.
  implication: The remaining defects are lifecycle isolation/timing issues, not deterministic business assertions; nested dependency ownership and deferred worker cleanup are the relevant structural differences.
- timestamp: 2026-09-23T22:17:00+02:00
  checked: Binary split of replay-boundary predecessors before production RESULTS
  found: First-half predecessors plus RESULTS passed 7/7; second-half evaluation/tamper/dead-letter predecessors caused RESULTS to record two PROVIDER_TIMEOUT failures before succeeding on attempt 3.
  implication: The shared BullMQ queue retains work/retries across tests; worker closure alone does not remove queued or delayed jobs, so per-test exact-prefix queue cleanup is required.
- timestamp: 2026-09-23T22:24:00+02:00
  checked: Generic exact-prefix queue drain/removal plus explicit worker readiness on the reproducing second-half subset
  found: RESULTS no longer recorded PROVIDER_TIMEOUT but remained QUEUED with zero attempts until timeout; both drain(true) and targeted all-pending-state removal produced the same no-consumer symptom.
  implication: Queue-wide cleanup is not an acceptable fix and the hypothesis that pending-job removal alone solves isolation is eliminated; exact job-state instrumentation and scoped removal are required.
- timestamp: 2026-09-24T05:09:00+02:00
  checked: Focused evaluation/tamper/dead-letter/RESULTS reproduction after exact job-ID cleanup
  found: All 4 selected tests passed; both non-executing tests observed their own job in waiting state, removed only that job, and the subsequent dead-letter and production RESULTS tests completed correctly.
  implication: The exact test-owned cleanup breaks the confirmed cross-test contamination chain without queue-wide mutation or generic worker-readiness changes.
- timestamp: 2026-09-24T05:12:00+02:00
  checked: Focused provider-policy, value-receipt, replay, and complete replay-boundary group
  found: Provider-policy, value-receipt, and replay passed; replay-boundary passed 20/21 but the OPEN durable-policy test timed out with the plan QUEUED, zero attempts, and a worker.initialized readiness payload reporting PostgreSQL and Redis unavailable.
  implication: The orphan-job fix is valid, but a separate worker-start readiness race remains in one scenario; the complete release gate must not run until this focused failure is isolated.

## Resolution

root_cause: "The release integration command did not parent-own PostgreSQL/Redis for the complete Vitest lifetime and did not propagate Node 24 to descendants. Once exposed, independent deterministic defects remained: invalid forecast predecessor fixtures, reused BullMQ identities and orphaned exact jobs, post-readiness child failures detached from the Vitest owner with no retained diagnostic tail, and Playwright tests that reused persistent identities/count assumptions across browser projects and assumed desktop navigation on mobile."
fix: "Added a parent-owned Node 24 integration gate with exact cleanup; corrected forecast lineage and replay fixture/job isolation; added live child supervision, sibling termination, awaited Windows process-tree closure, an awaited owner race, and bounded redacted diagnostics; isolated privacy identities per Playwright project and made pagination/navigation assertions responsive and state-safe."
oracle_type: specified
verification:
  target_test: { result: pass, evidence: "Focused lifecycle oracle 2/2; affected integration suites 59/59." }
  mutation_check: { result: skipped, reason_if_skipped: "No scoped Stryker result recorded in this session." }
  no_op_deletion: { result: pass, deletion_justified_by_rca: false }
  adjacent_tests: { result: pass, suites_run: [provider-policy-approval, value-receipt, replay, replay-boundary] }
  revert_and_reconfirm: { result: pass, bug_returned_on_revert: true, fixed_on_reapply: true }
  e2e_target_test: { result: pass, evidence: "Focused RED reproduced 3 mobile privacy failures; post-fix operator/privacy matrix passed 10/10." }
  e2e_mutation_check: { result: skipped, reason_if_skipped: "No scoped Stryker configuration for Playwright specifications." }
  e2e_no_op_deletion: { result: pass, deletion_justified_by_rca: false }
  e2e_adjacent_tests: { result: pass, suites_run: [release-degradation, operator-overview, privacy-retention], evidence: "24/24 across both projects." }
  e2e_revert_and_reconfirm: { result: pass, bug_returned_on_revert: true, fixed_on_reapply: true, evidence: "Pre-fix retained full-gate artifacts plus focused RED; identical focused and held-out post-fix paths are green." }
  full_release_gate: { result: pass, evidence: "Clean retry exited 0 under Node 24.14.0, pnpm 10.34.5, and Docker 29.7.2: prerequisites/install/schema passed; typecheck 7/7; unit 25 files/236 tests; integration 55 files/451 tests; build 7/7; Playwright 54/54." }
  supervisor_owner_oracle: { result: pass, evidence: "RED failed on missing runSupervisedLiveOwner; GREEN lifecycle suite 4/4 proves API exit rejects pending owner, terminates sibling, and surfaces diagnostic tail." }
  focused_live_harness: { result: pass, evidence: "Node 24.14.0 + Docker 29.7.2, 3/3 in 58.81s with clean API/web shutdown." }
  guardrail_verdict: accepted
  commit: 8920720
files_changed: [package.json, scripts/verify-release-integration.mjs, tests/e2e/live-provider-stack.ts, tests/e2e/operator-overview.spec.ts, tests/e2e/privacy-retention.spec.ts, tests/integration/forecast-api.test.ts, tests/integration/live-provider-harness-smoke.test.ts, tests/integration/phase-01-security.test.ts, tests/integration/phase-03-security.test.ts, tests/integration/provider-policy-approval.test.ts, tests/integration/replay-boundary.test.ts, tests/integration/replay.test.ts, tests/integration/value-receipt.test.ts, tests/unit/release-db-lifecycle.test.ts]
