---
phase: 08-backups-and-restore-verification
reviewed: 2026-11-01T01:45:57Z
depth: standard
files_reviewed: 12
files_reviewed_list:
  - .env.example
  - infra/operator-gateway/security.mjs
  - infra/operator-gateway/server.mjs
  - package.json
  - scripts/app-lifecycle.ps1
  - tests/e2e/live-provider-stack.ts
  - tests/e2e/operations-gateway.spec.ts
  - tests/integration/backup-restore-drill.test.ts
  - tests/integration/operator-gateway.test.ts
  - tests/unit/operator-gateway.test.ts
  - workers/data-sync/src/jobs/backup-drill.ts
  - tests/unit/backup-drill.test.ts
findings:
  critical: 0
  warning: 4
  info: 3
  total: 7
status: issues_found
---

# Phase 8: Code Review Report (incremental re-review since 6c6c98a)

**Reviewed:** 2026-11-01T01:45:57Z
**Depth:** standard
**Files Reviewed:** 12
**Status:** issues_found

## Summary

Incremental adversarial review of what changed since `6c6c98a` — the G-08-6 operations-ingress closure (gateway protected-path extension to `/internal*/operations*`, dev-launcher gateway integration, real-browser e2e with fail-closed negatives) and the G-08-5 inspect-verified container-cleanup verdict (pre-rm inspect → rm → post-rm inspect with a durable audit entry). Both gaps are substantively addressed: path classification is segment-boundary-correct with unit cases for near-miss neighbors, the e2e negative probe correctly bypasses Playwright credential injection via plain `fetch`, credentials stay out of argv in the drill, and `record()` structurally keeps `overall` independent of the cleanup verdict (test-guarded). No critical issues found. The warnings concentrate on two residual fail-open corners in the new cleanup verdict (post-rm inspect failures and the mutable container *name* as identity — both contradict the fail-closed invariant written in the adjacent comment), plus dev-launcher config-consistency gaps when `GATEWAY_PORT` is overridden and the gateway's pre-existing `0.0.0.0` bind now carrying the operations surface.

## Warnings

### WR-01: Post-rm inspect failure is recorded as REMOVED — fail-open against the stated G-08-5 invariant

**File:** `workers/data-sync/src/jobs/backup-drill.ts:447-453`
**Issue:** The verdict is `identityLostBeforeRm || rmFailed || survivedRm ? "FAILED" : "REMOVED"`. `survivedRm = !postInspect.spawnError && postInspect.code === 0`, so a post-rm inspect that **could not run at all** (`spawnError`) — or that failed because the Docker daemon became unreachable (exit≠0 with a "Cannot connect" stderr, indistinguishable by exit code from "No such object") — falls through to `REMOVED`. This directly contradicts the comment block at lines 444-446 ("REMOVED therefore requires positive inspect evidence twice; every other path fails closed to FAILED") and G-08-5's fail-closed requirement: the receipt asserts «Контейнер удалён» with zero positive absence evidence. The pre-rm side handles this correctly (`spawnError` → FAILED, unit test F), but no unit test covers postInspect `spawnError` (`inspects: [INSPECT_FOUND, spawnGone]` is absent), so the fail-open branch is unguarded.
**Fix:** Require the post-rm inspect to have actually reached the daemon and reported absence before recording REMOVED, e.g.:

```ts
const postInspectRan = !postInspect.spawnError;
const daemonErrorOnPost = /cannot connect|daemon/i.test(postInspect.stderr);
const absentPerInspect = postInspectRan && postInspect.code !== 0 && !daemonErrorOnPost;
containerCleanup = identityLostBeforeRm || rmFailed || !absentPerInspect ? "FAILED" : "REMOVED";
```

Add a unit case `inspects: [INSPECT_FOUND, spawnGone]` expecting `FAILED` (mirroring existing test F).

### WR-02: Cleanup verdict keys on the mutable container NAME although the immutable container ID is already captured — residual rename window still yields a false REMOVED

**File:** `workers/data-sync/src/jobs/backup-drill.ts:331-345, 447-449`
**Issue:** `docker run -d` prints the container ID on stdout (`spawnBackupExec` captures stdout), but `containerStart.stdout` is discarded and all three cleanup calls use `containerName`. The exact UAT failure mode (G-08-5: Docker 29.x `rm --force` idempotent, exit 0 for an unresolvable name) is only closed for renames that land **before** the pre-rm inspect. A rename landing in the window between the pre-rm inspect and the rm — or at the rm itself — produces: pre-inspect exit 0 → rm exit 0 (idempotent miss) → post-inspect exit≠0 (name miss) → `REMOVED` while the renamed container lives on as an orphan. The identity actually at issue (the name) is the one mutable input in the verification chain.
**Fix:** Use the container ID as the verification identity and keep the name for the audit record:

```ts
const containerId = containerStart.stdout.toString("utf8").trim().split(/\s+/)[0];
// pre-inspect / rm --force / post-inspect by containerId; checks.containerCleanup
// keeps { containerName, containerId, ... } for the audit trail.
```

(Renames become invisible to the whole chain; the orphan-removal guarantee holds because rm-by-ID targets the same object.) Update the integration/unit assertions that match inspect/rm argv against the name.

### WR-03: Status/Stop never load `.env`, so a non-default GATEWAY_PORT diverges between Start and Status/Stop

**File:** `scripts/app-lifecycle.ps1:27, 130-136, 148`
**Issue:** `$gatewayPort = 8080` is a script-scope default (line 27); `Load-Env` — which reads `.env` and reassigns `$script:gatewayPort` from `$env:GATEWAY_PORT` (lines 44-46) — runs only in the `-Daemon`/`-Gateway` branches and at line 139 of the Start flow. The `-Action Stop` (line 130) and `-Action Status` (lines 132-136) branches exit before any `Load-Env` call. With `GATEWAY_PORT=9090` in `.env`, Start correctly launches and probes 9090, but Status reports `gateway(:8080)=down`, and Stop's "ports free" confirmation (line 105) checks 8080. The stale-port pre-clean at line 148 also omits the gateway port entirely, so a stale listener on the configured gateway port makes the best-effort gateway spawn fail with only the 15-second warning as evidence. Process-tree kill still catches the gateway via the CommandLine regex, so Stop mostly works — but the reported state is wrong.
**Fix:** Call `Load-Env` at the top of the Stop and Status branches (after `Set-Location`), and include `$gatewayPort` in the stale-port check at line 148:

```powershell
if ($Action -eq "Stop") { Load-Env; Stop-Stack; exit 0 }
if ($Action -eq "Status") { Load-Env; ... }
```

### WR-04: Operator gateway binds 0.0.0.0 — cleartext Basic credentials and signed operations triggers reachable from the LAN

**File:** `infra/operator-gateway/server.mjs:163` (bind line pre-dates this phase; this phase elevates its exposure)
**Issue:** `gateway.listen(config.port, "0.0.0.0")` was pre-existing when the gateway only signed replay-preview paths, but this phase extends the protected surface to `/internal/operations*` (backup and restore-drill trigger buttons), documents the gateway as the human operator ingress in the dev topology, and launches it by default. Basic auth over plain HTTP on all interfaces means any LAN host can reach the challenge, brute-force or sniff the operator password, and fire backup/drill triggers against the operator's machine. The web/API in the same launcher bind loopback (`127.0.0.1`), so the gateway is the odd exposure.
**Fix:** Default to loopback and make the bind explicit and configurable:

```js
gateway.listen(config.port, environment.GATEWAY_BIND ?? "127.0.0.1");
```

(documenting `GATEWAY_BIND` in `.env.example` only if a non-loopback bind is genuinely needed).

## Info

### IN-01: Gateway readiness probe conflates "gateway down" with "upstream down"

**File:** `scripts/app-lifecycle.ps1:49-54, 133`
**Issue:** `Test-Http` treats any exception (including the 502 `Invoke-WebRequest` throws for a gateway whose upstream web is unreachable) as "down", and the Status line probes `gateway :/` — which the gateway proxies to the web origin. If web is down while the gateway is healthy, Status reports `gateway(:8080)=down`.
**Fix:** Probe a path that answers at the gateway itself — e.g. `/internal/operations` and count the 401 challenge as "up" (same approach the e2e `waitForGateway` uses).

### IN-02: Unguarded exec calls in the finally block can skip `record()` entirely — no receipt at all

**File:** `workers/data-sync/src/jobs/backup-drill.ts:447-449`
**Issue:** The three cleanup `exec.run` calls in the `finally` block (now three where there was one) are not wrapped in try/catch. A throwing `BackupExec` implementation (as opposed to one returning `spawnError`) propagates out of the finally, the original `outcome` is lost, and `record()` at line 469 never runs — the drill produces **no receipt**, failing open on the audit trail and leaving the cadence anchor stale. `spawnBackupExec` and the test doubles return `spawnError` instead of throwing, so this is latent rather than active.
**Fix:** Wrap the cleanup trio in a try/catch that maps a throw to `{ code: undefined, spawnError: String(error) }` for each stage so the FAILED verdict and receipt always land.

### IN-03: Unit test asserts gateway source text instead of behavior

**File:** `tests/unit/operator-gateway.test.ts:72-76`
**Issue:** The "compares the complete Basic credential pair" test greps `security.mjs` source for an exact code snippet (`expect(source).toContain("return equalText(decoded, `${expectedUsername}:${expectedPassword}`);")`). It breaks on any harmless reformat and duplicates coverage the spawned-gateway integration tests already provide behaviorally (wrong-password → 401, no upstream hop).
**Fix:** Prefer a behavioral assertion (e.g. `authenticateBasic` with a correct username + wrong password vs. wrong username + correct password, both false) or drop the test as redundant.

---

_Reviewed: 2026-11-01T01:45:57Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
