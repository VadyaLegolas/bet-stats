---
status: investigating
trigger: "Production-like D-15 E2E harness starts Node 24.14 + Docker; before browser, Prisma migrate deploy fails in proper-lockfile with TypeError onExit is not a function."
created: 2026-09-24
updated: 2026-09-24
---

## Symptoms

- Expected: `pnpm verify:release` starts the owned PostgreSQL/Redis stack, applies Prisma migrations under Node 24.14, then reaches browser E2E without bypassing migrations or weakening the Node 24 gate.
- Actual: Prisma `migrate deploy` fails before browser startup with `TypeError: onExit is not a function` from `proper-lockfile`.
- Known controls: Node 24 typecheck and focused proxy tests pass.
- Reproduction: run the production-like D-15 release harness using Node 24.14 and Docker.

## Current Focus

- hypothesis: confirmed — the lockfile remains correct; the failure came from a stale/incomplete `node_modules` virtual-store layout that supplied `signal-exit@4` to `proper-lockfile`, instead of its lockfile-pinned v3 dependency.
- reasoning_checkpoint:
    hypothesis: "A stale pnpm virtual-store layout resolves proper-lockfile's signal-exit import to v4, causing its v3 callable-import assumption to fail before Prisma migration logic starts."
    confirming_evidence:
      - "Node 24.14 reproduced the exact TypeError while proper-lockfile resolved signal-exit@4.1.0 as an object."
      - "After CI=true pnpm install --frozen-lockfile, the same module resolved signal-exit@3.0.7 as a function and loaded successfully."
    falsification_test: "A fresh frozen install that still resolves signal-exit@4 or still throws on a direct proper-lockfile load would disprove this cause."
    fix_rationale: "Recreating node_modules through the lockfile restores the declared proper-lockfile -> signal-exit@3 edge without bypassing Prisma or altering the Node 24 release gate."
    blind_spots: "The sandbox could not provide an observable end-to-end Docker migration completion marker; run the owned release harness next."
    candidate_causes:
      - "environment: stale/malformed pnpm node_modules virtual-store layout"
      - "config: incorrect pnpm lockfile or workspace dependency resolution"
    and_gate: "no — the stale virtual-store layout alone fully explains the import shape and error; the lockfile branch was disproved by the clean frozen install."
- test: one clean full `CI=true pnpm verify:release` under Node 24.14 with elevated Docker access.
- expecting: confirm the original Prisma blocker is absent and record the first independent failure without retrying the gate.
- next_action: start a separate debug session for integration fixtures missing `POSTGRES_DB=bet_stats` and for the privacy exact-expiry `RETENTION_DENIED`; do not rerun the full release gate before focused repairs.

## Evidence

- timestamp: 2026-09-24
  checked: root and database package manifests plus the lockfile dependency tree
  found: `verify:release` calls `scripts/verify-release-integration.mjs`, which invokes the database-local Prisma CLI directly; Prisma 7.10.0 brings `@prisma/dev@0.24.17`, whose only installed `proper-lockfile` is 4.1.2.
  implication: the failure boundary is Prisma CLI tooling (`@prisma/dev`), not the application Prisma Client or database schema.

- timestamp: 2026-09-24
  checked: `proper-lockfile@4.1.2` source
  found: its `lib/lockfile.js` assigns `require('signal-exit')` to `onExit` and calls it as a function during module initialization.
  implication: `TypeError: onExit is not a function` can only occur if its resolved `signal-exit` module exposes a non-function CommonJS shape; this is a precise, independently testable dependency-resolution hypothesis.

- timestamp: 2026-09-24
  checked: `pnpm why signal-exit` and current runtime
  found: the lockfile declares `signal-exit@3.0.7` for `proper-lockfile`, but the active process is Node 25.2.1 (outside the Node 24 release gate); a separate `signal-exit@4.1.0` also exists for `foreground-child`.
  implication: the next test must resolve `signal-exit` from `proper-lockfile`'s actual load path under a Node 24 executable, rather than relying on the current Node 25 process or a generic resolution path.

- timestamp: 2026-09-24
  checked: actual module resolution from `proper-lockfile/lib/lockfile.js`
  found: its actual Node resolution path loads `signal-exit@4.1.0` as an object with an `onExit` property, not the required callable v3 module; Node 24.14.0 is available at `C:\Program Files\nodejs\node.exe`.
  implication: the installed node_modules layout violates `proper-lockfile`'s v3 dependency boundary, and a Node-24 direct-module load is the minimal reproduction before testing the release harness.

- timestamp: 2026-09-24
  checked: Node 24.14 direct load of the installed `proper-lockfile@4.1.2`
  found: it deterministically fails at `lockfile.js:331` with the reported `TypeError: onExit is not a function`, before any database or Prisma migration work runs.
  implication: this is a deterministic dependency-layout failure (Bohrbug), not a Node 24 API removal or a database/migration defect.

- timestamp: 2026-09-24
  checked: `pnpm install --frozen-lockfile` under Node 24.14 in the non-interactive shell
  found: pnpm did not modify the tree because it correctly refused to purge `node_modules` without CI/TTY confirmation (`ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`); the minimal direct load still failed afterward.
  implication: the observed layout remains untested after a clean install, and `CI=true` is required to reproduce the release environment's install behavior.

- timestamp: 2026-09-24
  checked: Node 24.14 `CI=true pnpm install --frozen-lockfile`, followed by the direct `proper-lockfile` load
  found: the frozen install rebuilt the virtual store; `proper-lockfile` now resolves `signal-exit@3.0.7` as a function and loads successfully.
  implication: the checked-in `pnpm-lock.yaml` has the correct dependency edge. The root cause is a pre-existing malformed/stale installed dependency layout, not Prisma 7.10.0, Node 24.14, or the migration source.

- timestamp: 2026-09-24
  checked: Docker-backed owned migration startup from the release integration module
  found: the sandboxed attempt was blocked before Docker could spawn (`spawnSync docker EPERM`); the elevated attempt emitted no migration failure or surviving owned-container state, but did not provide a reliable completion marker.
  implication: the dependency failure is already eliminated by direct Node 24 module loading; final database migration confirmation should be obtained through the normal release harness where Docker execution is observable.

- timestamp: 2026-09-24
  checked: clean elevated `CI=true pnpm verify:release` with Node 24.14 first on PATH
  found: Docker 29.7.2, frozen install, Prisma schema validation, typecheck (7/7), unit tests (245/245 plus web 5/5), and all 24 migrations against the owned PostgreSQL instance passed. No `proper-lockfile` error occurred. Integration then ended exit 1 after 633.41s: 52/55 files, 442/456 tests passed, 12 skipped; `provider-routing`, `replay-lease-upgrade`, and privacy legacy setup failed on a missing `bet_stats` database, while privacy exact-expiry failed `RETENTION_DENIED`.
  implication: the original Prisma/Node 24 blocker is fully resolved. The release gate is now blocked only by independent integration fixture and privacy-retention defects.

## Eliminated

- hypothesis: Node 24.14 is incompatible with Prisma 7.10.0 / proper-lockfile@4.1.2
  evidence: The same Node 24.14 executable loaded proper-lockfile after a frozen install restored its lockfile-declared `signal-exit@3.0.7` dependency.
  timestamp: 2026-09-24

- hypothesis: pnpm-lock.yaml resolves an incompatible signal-exit major for proper-lockfile
  evidence: `pnpm-lock.yaml` pins `proper-lockfile@4.1.2 -> signal-exit@3.0.7`; after a frozen install, Node resolved exactly that callable v3 module.
  timestamp: 2026-09-24

## Resolution

- root_cause: A malformed/stale `node_modules` virtual-store layout exposed `signal-exit@4.1.0` to `proper-lockfile@4.1.2`, although the lockfile pins its required callable `signal-exit@3.0.7`; proper-lockfile therefore threw before Prisma migration logic began.
- fix: Rebuilt installed dependencies under the Node 24 release runtime with `CI=true pnpm install --frozen-lockfile`; no source or lockfile change was necessary.
- verification:
    target_test: { result: pass, detail: "Node 24.14 direct proper-lockfile load changed from the reported TypeError to PROPER_LOCKFILE_LOAD_OK after the frozen install." }
    mutation_check: { result: skipped, reason_if_skipped: "No source-code change or configured Stryker target; repair is installed-artifact reconstruction." }
    no_op_deletion: { result: pass, deletion_justified_by_rca: false, detail: "No tracked source or lockfile diff." }
    adjacent_tests: { result: skipped, suites_run: [], reason_if_skipped: "Docker-backed Prisma migrate deploy completion could not be observed from this sandbox." }
    revert_and_reconfirm: { result: skipped, reason_if_skipped: "Reverting a malformed dependency tree is destructive and unnecessary; direct before/after reproduction provides the causal comparison." }
    guardrail_verdict: pass_for_original_prisma_blocker
    full_release_gate: { result: fail_unrelated, detail: "Original migration boundary passed all 24 migrations; independent integration fixtures and retention expiry behavior failed." }
- files_changed: []
