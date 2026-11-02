---
phase: 08-backups-and-restore-verification
reviewed: 2026-11-02T14:35:50Z
depth: standard
files_reviewed: 2
files_reviewed_list:
  - workers/data-sync/src/jobs/backup-drill.ts
  - tests/unit/backup-drill.test.ts
findings:
  critical: 0
  warning: 2
  info: 3
  total: 5
status: issues_found
---

# Phase 8: Code Review Report (incremental re-review since b626569)

**Reviewed:** 2026-11-02T14:35:50Z
**Depth:** standard
**Files Reviewed:** 2
**Status:** issues_found

## Narrative Findings (AI reviewer)

## Summary

Delta scope: plan 08-06's gap closure (fail-closed post-rm cleanup verdict per WR-01 + guarded cleanup trio per IN-02) in exactly the two scoped files, reviewed against `git diff b626569 HEAD`. The core fix is substantive. `REMOVED` now requires three positive conditions — pre-rm inspect hit, `rm --force` exit 0, and a post-rm inspect that ran (`!spawnError`), exited non-zero, and carries none of the three connection-failure phrases (`backup-drill.ts:483-490`) — so both verifier counterexamples (post-rm spawnError, "Cannot connect to the Docker daemon" stderr) fail closed. The classifier (`isDockerUnreachableError`, lines 233-240) avoids false positives on every canonical absence wording: "No such object", "No such container", and "Error response from daemon: No such container" match none of the three phrases (only the word "daemon" appears, which is deliberately not a phrase), and test C still earns `REMOVED` on that stderr. `safeCleanupRun` (lines 473-479) wraps each cleanup call in its own try/catch, maps a throw to the existing `BackupExecResult` shape with `spawnError` set (evidence preserved as the audit's `spawn_error` marker, not swallowed), keeps the trio independent, and guarantees the verdict block completes so `record()` at line 506 always runs for exec failures. Tests G/H/I pin these behaviors through the full drill harness (receipt-level assertions, not source text), and the audit shape `{containerName, preInspect, rmExitCode, postInspect, verdict}`, the `DrillCleanupState` enum, the `backup_drill.container_cleanup_failed` log event, and `record()`'s `overall` independence are untouched (re-asserted by A–E/G/H/I). Unit suite re-run during this review: 32/32 green. No critical issues.

One residual fail-open remains inside the new condition: a post-rm inspect result with `code: undefined` but no `spawnError` property passes the "exited non-zero" test because `undefined !== 0` (WR-05) — a narrower corner of the very invariant this delta claims closed, and it produces an internally contradictory receipt (`postInspect: "spawn_error"` beside `verdict: "REMOVED"`). Prior-finding disposition for these two files: **WR-01 — resolved** by this delta (modulo WR-05's residual corner); **IN-02 — resolved** (modulo the non-exec logger escape noted in IN-06); **WR-02 — still applies** to `backup-drill.ts` and is carried below; **WR-03, WR-04, IN-01, IN-03 — do not apply** to these two files (they target `scripts/app-lifecycle.ps1`, `infra/operator-gateway/server.mjs`, and `tests/unit/operator-gateway.test.ts`) and remain tracked in `08-REVIEW-DISPOSITION.md`.

## Warnings

### WR-05: Post-rm inspect with an undefined exit code and no spawnError still records REMOVED — the last fall-through without absence evidence (residual of prior WR-01)

**File:** `workers/data-sync/src/jobs/backup-drill.ts:489`
**Issue:** `absentPerInspect = !postInspect.spawnError && postInspect.code !== 0 && !isDockerUnreachableError(postInspect.stderr)`. When the post-rm inspect yields `code: undefined` **without** the `spawnError` property, all three conjuncts hold — `undefined !== 0` evaluates to `true` — so with a pre-rm hit and `rm` exit 0 the verdict records `REMOVED` although the inspect never exited with any code and reported no absence whatsoever. The state is reachable in production: `spawnBackupExec` sets `spawnError` only from the timeout timer or the spawn `error` event; a child killed by a signal (docker CLI crash, external kill, OOM) settles via `close(code ?? undefined)` at `backup.ts:60` with `code: undefined` and no `spawnError`, and any injected `BackupExec` (input type allows arbitrary implementations) may return the same shape. The receipt is then self-contradicting: the audit at line 499 keys on `postInspect.code ?? "spawn_error"`, so it writes `{ postInspect: "spawn_error", verdict: "REMOVED" }` — the audit says the inspect never produced an exit code while the verdict claims its "non-zero exit" as absence evidence. This violates plan 08-06's must-have truth ("exited non-zero … every other post-rm state records `FAILED`") and re-diverges from the invariant comment at lines 464-467 ("actually ran … exited non-zero") — the exact comment/behavior split that was WR-01's core complaint. Probability is low (abnormal exec result, and a *factually false* REMOVED additionally needs the WR-02 rename race), but this is the failure class the delta exists to eliminate.
**Fix:** Require a numeric non-zero exit code, aligning the verdict with the audit's own `spawn_error` marker:

```ts
const absentPerInspect =
  typeof postInspect.code === "number" &&
  postInspect.code !== 0 &&
  !postInspect.spawnError &&
  !isDockerUnreachableError(postInspect.stderr);
containerCleanup = identityLostBeforeRm || rmFailed || !absentPerInspect ? "FAILED" : "REMOVED";
```

Add a unit case beside G: `inspects: [INSPECT_FOUND, { code: undefined, stdout: Buffer.alloc(0), stderr: "" }]` (no `spawnError`) → `containerCleanup = "FAILED"` with audit `{ postInspect: "spawn_error", verdict: "FAILED" }`.

### WR-02: Cleanup verdict keys on the mutable container NAME although the immutable container ID is already captured (carried from review at b626569)

**File:** `workers/data-sync/src/jobs/backup-drill.ts:350-364, 480-490`
**Issue:** `docker run -d` prints the container ID on `containerStart.stdout`, but it is discarded and all three cleanup calls (`safeCleanupRun` trio) still use `containerName`. A rename landing in the window between the pre-rm inspect and the `rm` — or at the `rm` itself, where Docker 29.x `rm --force` exits 0 for an unresolvable name (the exact G-08-5 UAT failure mode) — yields pre-inspect 0 → rm 0 → post-inspect name-miss non-zero → `REMOVED` while the renamed container lives on as an orphan. The identity at issue (the name) is the one mutable input in the verification chain; 08-06 touched this code block but did not change the identity, so the finding remains open on this file (correctly scoped as out of 08-06's gap set).
**Fix:** Use the container ID as verification identity, keep the name for the audit record:

```ts
const containerId = containerStart.stdout.toString("utf8").trim().split(/\s+/)[0];
// pre-inspect / rm --force / post-inspect by containerId; checks.containerCleanup
// keeps { containerName, containerId, ... } for the audit trail.
```

Update the unit/integration assertions that match inspect/rm argv against the name (test C's `cleanupCalls` map and `cleanupAudit` `containerName` expectations).

## Info

### IN-04: `isDockerUnreachableError` is a phrase blacklist — the comment claims "reached the daemon", but any unlisted daemon-fault wording counts as absence evidence

**File:** `workers/data-sync/src/jobs/backup-drill.ts:233-240, 464-467, 489`
**Issue:** The verdict proves "the CLI spawned and stderr contains none of three phrases", not "the inspect reached the daemon" as the comments at 464-467 and 485-488 state. A connection fault phrased outside the list (e.g. `permission denied while trying to connect to the Docker daemon socket`, missing docker context, TLS/context errors — all exit 1) is treated as positive absence evidence → false `REMOVED`. Realistic daemon-down phrasings on Linux/macOS/Windows ("Cannot connect to the Docker daemon…", "error during connect…", "Is the docker daemon running?") are all covered and timeouts fail closed via `EXEC_TIMEOUT`, so residual risk is low; but note `08-06-SUMMARY.md` decision 1 overstates the guarantee: "error-shape drift … can never flip back to a false REMOVED" holds only for drift of the canonical *absence* wording — drift of *connection-failure* wording flips the other way (classifier miss → false `REMOVED`).
**Fix:** Prefer positive absence evidence over a fault blacklist: require the canonical absence text in the post-rm stderr, e.g. `/\bno such (object|container)\b/i.test(postInspect.stderr)` as an additional conjunct (or as the condition itself), keeping the blacklist as defense in depth.

### IN-05: Two of three classifier branches and the "No such object" absence variant are unpinned by tests

**File:** `tests/unit/backup-drill.test.ts:65, 285-293, 328-335`
**Issue:** Test H's single stderr ("Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?") redundantly contains phrases 1 and 3, so deleting either branch keeps the suite green, and the plan-mandated Windows variant `error during connect` (08-06 plan, Task 1 action: "MUST match … the Windows 'error during connect' variant") is never exercised by any test. Symmetrically, test C pins only `Error response from daemon: No such container`; the other canonical absence wording `No such object` (older/Windows docker) appears in no test, so an over-broad future classifier change against it would go undetected. The behaviors the plan must-haves name (G/H/C) are pinned; these adjacent branches are not.
**Fix:** Parametrize H over the three phrases individually (one test per phrase → FAILED) and add a C-variant asserting `REMOVED` when the post-rm stderr is `Error: No such object: <name>`.

### IN-06: `record()` guarantee covers cleanup-exec throws only — a throwing injected logger still escapes the finally block

**File:** `workers/data-sync/src/jobs/backup-drill.ts:455, 502-506`
**Issue:** IN-02 is closed for `BackupExec` failures (all three cleanup calls go through `safeCleanupRun`), but two unguarded `log(...)` calls remain inside the finally: line 502 and the `log` inside the awaited `.catch()` at line 455 (if that callback throws, the awaited promise rejects and the exception propagates out of the finally). A throwing injected logger (`input.logger`) would then skip `record()` at line 506 — no receipt — the same audit-trail failure mode IN-02 described, on a non-exec path. Latent: the default logger is a no-op and pino-style loggers rarely throw; the plan deliberately scoped IN-02 to the cleanup trio and left line 455 untouched.
**Fix:** Wrap the two `log` call sites in try/catch (or move `return record(outcome)` into a nested try/finally around the cleanup block) so no logging side effect can prevent the receipt from landing.

---

_Reviewed: 2026-11-02T14:35:50Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
