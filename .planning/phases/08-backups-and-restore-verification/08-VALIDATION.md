---
phase: "8"
slug: "backups-and-restore-verification"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
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

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 08-xx-xx | 01 | 1 | BAK-01 | T-08-NN | `readBackupConfig` fail-closed (disabled/dir-missing/invalid retention) | unit | `pnpm vitest run --project unit packages/config` | ❌ W0 (extend) | ⬜ pending |
| 08-xx-xx | 01 | 1 | BAK-01 | — | retention rotation prunes to N after success only; never delete-before-success | unit | `pnpm vitest run --project unit` | ❌ W0 (`backup.test.ts`) | ⬜ pending |
| 08-xx-xx | 01 | 1 | BAK-01 | — | robocopy exit-bitmask (0,1,3,7 pass; 8,16,ENOENT → DEGRADED) | unit | `pnpm vitest run --project unit` | ❌ W0 (`backup.test.ts`) | ⬜ pending |
| 08-xx-xx | 01 | 1 | BAK-01 | — | real `pg_dump -Fc` roundtrip + atomic rename + rotation on throwaway container | integration | `pnpm test:integration` | ❌ W0 (`backup-restore-drill.test.ts`) | ⬜ pending |
| 08-xx-xx | 02 | 2 | BAK-02 | T-08-NN | full drill: container → restore → deploy → status-at-head → checks → receipt → cleanup | integration | `pnpm test:integration` | ❌ W0 (`backup-restore-drill.test.ts`) | ⬜ pending |
| 08-xx-xx | 02 | 2 | BAK-02 | — | drill fail-closed: Docker unavailable ⇒ FAILED receipt (never green) | integration | `pnpm test:integration` | ❌ W0 (`backup-restore-drill.test.ts`) | ⬜ pending |
| 08-xx-xx | 02 | 2 | BAK-02 | — | receipt immutability: UPDATE/DELETE rejected (`P0001`) | integration | `pnpm test:integration` | ❌ W0 (extend `mutation-rejection.test.ts`) | ⬜ pending |
| 08-xx-xx | 03 | 3 | BAK-03 | T-08-NN | overview `backups` states (NOT_CONFIGURED / NEVER_VERIFIED / STALE / FAILED / HEALTHY, 25h staleness) | unit | `pnpm vitest run --project unit` | ❌ W0 (extend operations tests) | ⬜ pending |
| 08-xx-xx | 03 | 3 | BAK-03 | T-08-NN | no secrets in payload (no `postgresql://`, no credential substrings) | unit+integration | `pnpm test` | ❌ W0 (extend `operator-overview.test.ts`) | ⬜ pending |
| 08-xx-xx | 03 | 3 | BAK-03 | — | manual trigger endpoints enqueue jobs; unsigned/bad-credential ⇒ 404 | integration | `pnpm test:integration` | ❌ W0 (extend `operator-overview.test.ts`) | ⬜ pending |
| 08-xx-xx | 03 | 3 | BAK-03 | — | web proxy POST passthrough + method-in-signature rejection | unit (route) | `pnpm --filter web test` | ❌ W0 (extend operations route test) | ⬜ pending |
| 08-xx-xx | 03 | 3 | BAK-03 | — | UI Block renders 5 states (Russian labels, non-green honesty) | web unit | `pnpm --filter web test` | ❌ W0 (web component test) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky · W0 = to create in Wave 0*

---

## Wave 0 Requirements

- [ ] `tests/integration/backup-restore-drill.test.ts` — new owned-container harness test (Docker; follows `verify-release-integration.mjs` shape).
- [ ] `tests/unit/backup-job.test.ts` + `tests/unit/backup-drill.test.ts` — unit orchestration with injected `docker`/`execFile` fakes (jobs must accept injected exec functions, like `scheduleRetentionPurge` injects timers — testability symmetry).
- [ ] Extend `tests/integration/mutation-rejection.test.ts` with the two new append-only receipt tables.
- [ ] Add operations-POST cases to the web route test (`internal-api/privacy` route-test pattern is proven).
- [ ] No framework installs needed (stdlib + robocopy + docker CLI + existing stack — Package Legitimacy Audit clean).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real `pg_dump` against the live production DB | BAK-01 | Requires the operator's actual `DATABASE_URL` + a real dump on the host; CI/live providers are never called | Operator sets `BACKUP_ENABLED=true` + `BACKUP_DIR`, triggers "Backup now", confirms a dated `.dump` appears and `BackupRun` is appended |
| Off-host `robocopy` to a real SMB/sync folder | BAK-01 | Needs an operator-provisioned off-host destination | Point `BACKUP_OFFSITE_DIR` at a share, run a backup, confirm the copy lands and status shows off-host HEALTHY |
| Weekly drill cadence on the live host | BAK-02 | Time-dependent, host-scheduled | Confirm the drill job fires weekly and the operations block stays green after each |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 240s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
