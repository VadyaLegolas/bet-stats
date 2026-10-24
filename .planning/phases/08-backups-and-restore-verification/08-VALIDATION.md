---
phase: "8"
slug: "backups-and-restore-verification"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: validated
nyquist_compliant: true
wave_0_complete: true
created: "2026-10-22"
---

# Phase 8 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.x (root devDependency), projects `unit` + `integration` |
| **Config file** | `vitest.config.ts` (root); integration = `tests/integration/**/*.test.ts`, `fileParallelism: false` |
| **Quick run command** | `pnpm vitest run --project unit` (Node 24 via `.tools/node24` on PATH) |
| **Full suite command** | `pnpm test:integration` (Docker required — owned-container harness) |
| **Estimated runtime** | ~30s unit · ~2-4min integration |

---

## Sampling Rate

- **After every task commit:** Run `pnpm vitest run --project unit` (<30s budget; touch the targeted integration file for DB tasks).
- **After every plan wave:** Run `pnpm test:integration` (Docker up).
- **Before `/gsd-verify-work`:** `pnpm verify:release` green (chains schema validate → typecheck → unit → owned-container integration → build).
- **Max feedback latency:** 30 seconds (unit) / 240 seconds (integration).

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|------|--------|
| 08-01-t1 | 01 | 1 | BAK-01 | T-08-01 | `readBackupConfig` fail-closed (disabled/dir-missing/invalid retention, PG identity keys) | unit | `pnpm vitest run --project unit packages/config` | `packages/config/src/index.test.ts` | ✅ green |
| 08-01-t2 | 01 | 1 | BAK-01 | — | retention rotation prunes to N after success only; never delete-before-success | unit | `pnpm vitest run --project unit tests/unit/backup-job.test.ts` | `tests/unit/backup-job.test.ts` | ✅ green |
| 08-01-t2 | 01 | 1 | BAK-01 | — | robocopy exit-bitmask (0,1,3,7 pass; 8,16,ENOENT → DEGRADED); no /MIR//PURGE | unit | `pnpm vitest run --project unit tests/unit/backup-job.test.ts` | `tests/unit/backup-job.test.ts` | ✅ green |
| 08-01-t3 | 01 | 1 | BAK-01 | — | real `pg_dump -Fc` roundtrip + atomic rename + rotation on throwaway container | integration | `pnpm vitest run --project integration tests/integration/backup-restore-drill.test.ts` | `tests/integration/backup-restore-drill.test.ts` | ✅ green |
| 08-02-t1 | 02 | 2 | BAK-02 | T-08-07..12 | full drill: container → restore → deploy → status-at-head → checks → receipt → cleanup | integration | `pnpm vitest run --project integration tests/integration/backup-restore-drill.test.ts` | `tests/integration/backup-restore-drill.test.ts` | ✅ green |
| 08-02-t2 | 02 | 2 | BAK-02 | T-08-08 | drill fail-closed: Docker unavailable ⇒ UNVERIFIED; parity/restore failure ⇒ FAILED; never green | unit | `pnpm vitest run --project unit tests/unit/backup-drill.test.ts` | `tests/unit/backup-drill.test.ts` | ✅ green |
| 08-02-t2 | 02 | 2 | BAK-02 | T-08-11 | receipt immutability: UPDATE/DELETE rejected (`/immutable/i`) for both receipt tables | integration | `pnpm vitest run --project integration tests/integration/mutation-rejection.test.ts` | `tests/integration/mutation-rejection.test.ts` | ✅ green |
| 08-03-t1 | 03 | 3 | BAK-03 | T-08-13,15 | overview `backups` states (NOT_CONFIGURED / NEVER_VERIFIED / STALE / FAILED / HEALTHY, 25h staleness, read-time) | integration | `pnpm vitest run --project integration tests/integration/operator-overview.test.ts` | `tests/integration/operator-overview.test.ts` | ✅ green |
| 08-03-t1 | 03 | 3 | BAK-03 | T-08-13 | no secrets in payload (no connection-string scheme marker, no directory path) | integration | `pnpm vitest run --project integration tests/integration/operator-overview.test.ts` | `tests/integration/operator-overview.test.ts` | ✅ green |
| 08-03-t2 | 03 | 3 | BAK-03 | T-08-14,16,17 | manual trigger endpoints enqueue {trigger:"MANUAL"} only; disabled/bad-credential ⇒ uniform 404 | integration | `pnpm vitest run --project integration tests/integration/operator-overview.test.ts` | `tests/integration/operator-overview.test.ts` | ✅ green |
| 08-03-t2 | 03 | 3 | BAK-03 | T-08-14 | web proxy POST passthrough + method-in-signature rejection; GET unchanged | web unit | `pnpm --filter web test` | `apps/web/app/internal-api/operations/[[...path]]/route.test.ts` | ✅ green |
| 08-03-t3 | 03 | 3 | BAK-03 | — | UI Block renders 5 states (Russian labels, non-green honesty, trigger buttons) | web unit | `pnpm --filter web test` | `apps/web/app/internal/operations/backup-status-block.test.ts` | ✅ green |

*Status legend: ✅ green · ❌ red · ⚠️ flaky. Audit 2026-10-24: all rows verified green on the executed tree (unit 58/58, integration 36/36, web 79/79).*

---

## Wave 0 Requirements

- [x] `tests/integration/backup-restore-drill.test.ts` — new owned-container harness test (Docker; follows `verify-release-integration.mjs` shape).
- [x] `tests/unit/backup-job.test.ts` + `tests/unit/backup-drill.test.ts` — unit orchestration with injected `docker`/`execFile` fakes (jobs accept injected exec functions, like `scheduleRetentionPurge` injects timers — testability symmetry).
- [x] Extend `tests/integration/mutation-rejection.test.ts` with the two new append-only receipt tables.
- [x] Add operations-POST cases to the web route test (`internal-api/privacy` route-test pattern is proven).
- [x] No framework installs needed (stdlib + robocopy + docker CLI + existing stack — Package Legitimacy Audit clean; no package.json/lockfile hunks across all three plans).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real `pg_dump` against the live production DB | BAK-01 | Requires the operator's actual `DATABASE_URL` + a real dump on the host; CI/live providers are never called | Operator sets `BACKUP_ENABLED=true` + `BACKUP_DIR`, triggers "Backup now", confirms a dated `.dump` appears and `BackupRun` is appended |
| Off-host `robocopy` to a real SMB/sync folder | BAK-01 | Needs an operator-provisioned off-host destination | Point `BACKUP_OFFSITE_DIR` at a share, run a backup, confirm the copy lands and status shows off-host HEALTHY |
| Weekly drill cadence on the live host | BAK-02 | Time-dependent, host-scheduled | Confirm the drill job fires weekly and the operations block stays green after each |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 240s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** audited 2026-10-24 — 12/12 Per-Task rows green (unit 58/58, integration 36/36 on an isolated throwaway Postgres with both phase migrations deployed, web 79/79); manual-only items remain operator-environment verifications by design.

## Validation Audit 2026-10-24

| Metric | Count |
|---|---|
| Gaps found | 0 |
| Resolved | 0 |
| Escalated | 0 |
