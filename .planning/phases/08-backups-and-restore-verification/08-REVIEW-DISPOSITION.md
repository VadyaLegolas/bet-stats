---
phase: 08-backups-and-restore-verification
review: 08-REVIEW.md
created: 2026-10-24
updated: 2026-10-26
---

# Phase 8 — Code Review Disposition

| Finding | Severity | Component | Disposition | Commits | Notes |
|---------|----------|-----------|-------------|---------|-------|
| CR-01 | critical | workers/data-sync/src/jobs/backup.ts (local pg_dump branch) | resolved | 7c245f2 | libpq reads PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE (never DATABASE_URL) via child env; credentials stay out of argv (T-08-01); unit test asserts PG* env and argv without conninfo/password |
| CR-02 | critical | backup.ts + backup-drill.ts tick schedulers | resolved | c47c58c (test), 3a0268f (fix) | deterministic dedup `scheduled-<kind>-<epochBucket>` jobIds; re-arm anchored on the newest BackupRun / BackupVerificationReceipt of ANY status; pending window polls at bounded idle cadence (Redis no-ops), never 1 Hz receipt-less storm |
| WR-01 | warning | schema.prisma byteSize + backup.ts + operations.service.ts | resolved | 4c4c027 | `byteSize BigInt? @db.BigInt` + handwritten ALTER migration; BigInt written at the receipt, serialized via Number() at the BackupFact DTO boundary |
| WR-02 | warning | backup-drill.ts / backup.ts MAX_TIMER_DELAY clamp | resolved | c47c58c (test), 3a0268f (fix) | capped delay re-arms `arm()` instead of `run()`, so intervals above ~596 h recompute the remainder and never drill early |
| WR-03 | warning | backup.ts copyOffsite + pruneBackupRetention + README privacy note | resolved | 14bcd36 (test), f2f9e2f (fix) | off-host dir pruned by the same system-name pattern and window, oldest first, only after a confirmed COPIED run; README states the equal local/off-host retention window (Russian) |
| IN-01 | info | apps/web backup-status-block.tsx cleanup labels | resolved | d8ea2bf (test), 4c0f651 (fix) | REMOVED/FAILED/NOT_STARTED mapped to Russian; impossible RETAINED dropped |
| IN-02 | info | backup.ts robocopy log flag | resolved | 827102f (test), 9b1c977 (fix) | `/LOG+:` → `/LOG:` — per-run truncation, log cannot grow unbounded inside BACKUP_DIR |
| IN-03 | info | operations.service.ts manual jobId | resolved | 1965fcd (test), 1c4109f (fix) | `manual-<job>-<ts>-<randomUUID>` — same-millisecond triggers can no longer dedup-drop an enqueue; test pins Date.now to prove distinctness |

**Verification battery 2026-10-26 (all green):** `pnpm typecheck` 7/7 · `pnpm lint` 7/7 · `pnpm test` unit 433 passed (only pre-existing `fixtures-sync.test.ts` 7 failed, real-DB auth, green in CI) · `pnpm --filter @bet-stats/web test` 82/82 · `pnpm build` 7/7 via the new dist-dir guard (site `/internal-api/fixtures/quota` → 200 after the build) · integration trio 38/38 on an isolated throwaway Postgres 18 with both phase migrations (container removed afterwards).

Security verification outcome (no findings): T-08-01..17 all mitigated in code; T-08-SC clean (zero package.json/lockfile hunks in a33342d..HEAD).
Pre-existing out-of-scope: tests/unit/fixtures-sync.test.ts hermeticity bug (documented in deferred-items.md).
