---
phase: "8"
slug: "08-backups-and-restore-verification"
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
register_authored_at_plan_time: true
created: "2026-11-05"
---

# Phase 8 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| Worker → local filesystem | `backup.ts` writes system-generated dumps into `BACKUP_DIR` and copies them off-host via robocopy | dump files (full database), retention metadata |
| Worker → pg/docker children | `pg_dump` / `pg_restore` / `docker` invocations for backup and restore drill | credentials via child env only (never argv) |
| Operator UI → API | `POST internal/operations/backups/run` and `backups/drill` behind class-level `OperatorGuard` | operator credential, `{ trigger: "MANUAL" }` job payload |
| Gateway → web proxy → API | HMAC-signed `x-operator-*` headers over `/internal/operations*` and `/internal-api/operations*` | subject/timestamp/method/pathname/query-digest signature |
| Redis BullMQ | `backup` / `drill` queue payloads | trigger-only job data — no credentials, no connection strings |
| Durable receipts | `BackupRun`, `BackupVerificationReceipt` | append-only rows (DB triggers), redacted checks JSON |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-08-01 | Information Disclosure | pg_dump child invocation (`backup.ts`) | high | mitigate | Credentials reach the child only via env (`DATABASE_URL`/`PGPASSWORD`), never argv; `--no-password` fails fast; argv arrays only, no shell strings | closed |
| T-08-02 | Information Disclosure | BullMQ job payload (`jobs/backup.ts`) | high | mitigate | `BackupJobData` carries `{ trigger }` only; `tests/unit/backup-job.test.ts` asserts the enqueued payload shape — no connection string can persist in Redis | closed |
| T-08-03 | Tampering | `BACKUP_DIR`/offsite filename handling (`backup.ts`) | medium | mitigate | Filenames are system-generated from the UTC timestamp; config supplies only absolute directories; deletion bounded to the dump naming pattern | closed |
| T-08-04 | Denial of Service | unattended pg_dump/robocopy (`backup.ts`) | medium | mitigate | `--no-password` on pg tools; bounded robocopy retries `/R:2 /W:5`; exec timeout on every child so a hang records FAILED | closed |
| T-08-05 | Information Disclosure | rotation ordering (`pruneBackupRetention`) | high | mitigate | Pruning runs only after the new dump is renamed into place (`backup.ts:346` rename before `:395` prune); a failed dump records FAILED and deletes nothing | closed |
| T-08-06 | Tampering | robocopy exit interpretation (`copyOffsite`) | medium | mitigate | Bitmask rule (`>= 8` = failure, `backup.ts:137`) with unit fixtures 0/1/3/7/8/16/ENOENT; failed copy records off-host DEGRADED without touching local success | closed |
| T-08-07 | Information Disclosure | pg_restore / Prisma CLI children (`backup-drill.ts`) | high | mitigate | `DATABASE_URL`/passwords pass only via child env, never argv; explicit `-U` argument; `--no-password` on pg tools (`backup-drill.ts:401`) | closed |
| T-08-08 | Denial of Service | fail-closed drill states (`backup-drill.ts`) | high | mitigate | Docker spawn failure ⇒ UNVERIFIED receipt; any step/check failure ⇒ FAILED; VERIFIED only when every executed check passed (D-11) | closed |
| T-08-09 | Tampering | dump selection (`backup-drill.ts`) | high | mitigate | Restores only the newest local self-produced dump matched by `BACKUP_DUMP_FILE_PATTERN` (`backup-drill.ts:316`); off-host copies are never drill inputs | closed |
| T-08-10 | Denial of Service | throwaway container lifecycle (`backup-drill.ts`) | medium | mitigate | Owned-unique container name, `rm --force` in a `finally` block (`:454`, `:487`), per-child exec timeouts; removal failure recorded as `containerCleanup: FAILED` | closed |
| T-08-11 | Tampering | `BackupRun` / `BackupVerificationReceipt` rows | high | mitigate | Frozen triggers raise on UPDATE/DELETE (`20261022_phase08_backup_runs`, `20261022_phase08_backup_verification_receipts`); `tests/integration/mutation-rejection.test.ts:156-173` proves rejection for both tables | closed |
| T-08-12 | Information Disclosure | checks JSON and stderr excerpts (`backup-drill.ts`) | medium | mitigate | Excerpts length-bounded and passed through `redactSecrets` before persistence (`:203`); checks JSON stores counts, outcomes and safe reason codes only | closed |
| T-08-13 | Information Disclosure | overview backups projection (`operations.service.ts`) | high | mitigate | Explicit Prisma selects on closed scalars, basename-only names, `redactSecrets(computeBackupFact(...))` pass (`:167`); integration test asserts no connection-string marker or directory path in the payload | closed |
| T-08-14 | Spoofing | `POST backups/run` and `backups/drill` | high | mitigate | Class-level `OperatorGuard` (timing-safe credential) plus HMAC chain whose canonical string binds the method; proxy forwards the method so a signed GET cannot become a POST | closed |
| T-08-15 | Denial of Service | five-state computation (read-time staleness) | medium | mitigate | States recomputed at read time from durable rows with injected clock (`computeBackupFact(rows, now)`); worker downtime can never freeze a green state (D-14) | closed |
| T-08-16 | Information Disclosure | disabled-vs-unauthorized probe | medium | mitigate | Disabled backups raise the same uniform `NotFoundException("Not found")` as bad credentials — no configuration oracle (`operator-overview.test.ts:277-289`) | closed |
| T-08-17 | Tampering | enqueue payload (`OperationsService`) | medium | mitigate | Job data is exactly `{ trigger: "MANUAL" }`; tests assert the payload shape (`operator-overview.test.ts:226,265`) so credentials can never enter Redis | closed |
| T-08-18 | Spoofing | `infra/operator-gateway/security.mjs` | high | mitigate | Operations prefixes in `protectedPrefixes` with segment-boundary matching (`isProtectedPath`); `authenticateBasic` timing-safe compare; `signedOperatorHeaders` binds subject/timestamp/method/pathname/query-digest; `forwardHeaders`/`upgradeForwardHeaders` strip client `x-operator-*` before signing (`server.mjs:77,133`); unit tests assert `/internal/operation` stays public (`operator-gateway.test.ts:23-35`) | closed |
| T-08-19 | Tampering | `scripts/app-lifecycle.ps1` gateway spawn | medium | mitigate | Gateway inherits environment through `Load-Env` (process env only); spawn is `node infra/operator-gateway/server.mjs` with no secret in argv, log, or printed URL; misconfiguration degrades to unreachable gateway (warn + continue), never permissive | closed |
| T-08-20 | Information Disclosure | `tests/e2e/operations-gateway.spec.ts` | low | accept | Test-only secret literal `phase-06-operations-signing-secret-32-bytes` from `OPERATOR_TEST_ENV` — exists solely inside the owned throwaway e2e stack, never in production configuration (see Accepted Risks Log) | closed |
| T-08-21 | Tampering | `backup-drill.ts` cleanup verdict | medium | mitigate | Every verdict stage fails closed: lost identity before rm, rm non-zero, surviving object, spawnError all record FAILED; REMOVED requires positive inspect evidence twice (unit cases A–F) | closed |
| T-08-22 | Information Disclosure | `BackupVerificationReceipt.checks.containerCleanup` | low | mitigate | Persisted name is system-generated (`bet-stats-drill-pg-<pid>-<ts>`) and exit codes only; projection passes checks through `redactSecrets` and the closed DTO | closed |
| T-08-23 | Tampering | `backup-drill.ts` post-rm verdict and cleanup trio | medium | mitigate | REMOVED requires post-rm inspect actually run (no spawnError), non-zero exit, no daemon-unreachable stderr; spawnError/EXEC_TIMEOUT/daemon errors fail closed to FAILED (unit cases G/H/I) | closed |
| T-08-24 | Tampering | `backup-drill.ts` `absentPerInspect` post-rm guard | medium | mitigate | Requires `typeof postInspect.code === "number"` so a signal-killed docker CLI records FAILED, not REMOVED; counterexample pinned as unit case J | closed |
| T-08-SC | Tampering | npm/pip/cargo installs | high | mitigate | No new packages across all 7 plans — every phase-08 commit has an empty `package.json`/`pnpm-lock` diff (verified for `5da9972`, `e30ad9c`); package-legitimacy gate vacuously clean | closed |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

**Classification depth:** L1 (grep-level). Short-circuit applied: `threats_open: 0 AND register_authored_at_plan_time: true AND asvs_level == 1` — all 7 PLAN files contain parseable `<threat_model>` blocks, SUMMARY `## Threat Flags` are `None` for every plan, and each mitigation was verified present in the implementation.

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-08-01 | T-08-20 | Low-severity test-only secret literal; confined to the owned throwaway e2e stack (`OPERATOR_TEST_ENV`) and never reachable from production configuration | operator | 2026-11-05 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-11-05 | 25 | 25 | 0 | agent (secure-phase, L1 short-circuit) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-11-05
