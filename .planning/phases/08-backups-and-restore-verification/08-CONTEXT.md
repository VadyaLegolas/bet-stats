# Phase 8: Backups and Restore Verification - Context

**Gathered:** 2026-10-22
**Status:** Ready for planning
**Mode:** Interactive (discuss) — operator delegated all four gray areas to the agent («решай все сам»); decisions below are agent-authored and grounded in the codebase scout.

<domain>
## Phase Boundary

An operator can trust automated PostgreSQL backups because a scheduled restore drill proves each latest backup actually restores into a throwaway container, applies migrations, and passes chain-integrity checks — and the operations center shows backup/restore status honestly, rendering never-verified and stale backups as explicit non-green states. No WAL shipping, no pgBackRest/Barman, no paid backup SaaS (roadmap exclusions). Redis is deliberately not backed up (disposable, not a source of truth).

Requirements: BAK-01, BAK-02, BAK-03.

</domain>

<decisions>
## Implementation Decisions

All four research-flag gray areas (RPO/schedule/retention, off-host storage, restore-drill mechanism, management/visibility) were delegated to the agent by the operator. Decisions and their rationale follow.

### Backup schedule & retention (BAK-01)
- **D-01:** Daily full backup via `pg_dump -Fc` (custom format — compressed, single-file, supports selective restore). Target RPO = up to 24 hours. — **Reversibility:** reversible — switching to WAL shipping later would need `archive_mode` + recovery config, but the roadmap explicitly excludes that complexity for a re-derivable prediction platform where daily provider sync re-populates most data. — **Rationale:** single Windows host, free-tier, no backup SaaS; a daily custom-format dump is the honest, minimal, trustworthy baseline.
- **D-02:** Rotation keeps the last **N successful dumps** (default **N = 14**, configurable), deleting older files after each successful backup — never delete-before-new-backup-succeeds. — **Reversibility:** reversible — pure config value; retention count is not baked into any contract.
- **D-03:** Backup runs as a **scheduled BullMQ job in the worker** (`workers/data-sync`), following the existing `scheduleRetentionPurge` interval-scheduler pattern. — **Reversibility:** reversible — a new scheduler/queue following an established pattern; additive, no contract change.
- **D-04:** Backup is **opt-in**: `BACKUP_ENABLED` gate + configured `BACKUP_DIR`. Until enabled and configured, the operations center honestly reports backups as **not configured / never run** (non-green), not as passing. — **Reversibility:** reversible — feature flag + config; matches the fail-closed honesty discipline (absence must never look green).

### Off-host storage (single-host safety)
- **D-05:** Primary store = a local `BACKUP_DIR`. **Off-host copy is an explicit, optional second step**: after a successful dump, the worker copies the file to a configured `BACKUP_OFFSITE_DIR` using Windows-native **`robocopy`** (free, resumable, retry-capable, no SDK/credentials-in-code). `BACKUP_OFFSITE_DIR` may be any mounted network/SMB share or a cloud-sync folder (OneDrive/Syncthing) the operator points at. — **Reversibility:** reversible — destination is config; protocol choice (robocopy) is swappable without touching stored data.
- **D-06:** If `BACKUP_OFFSITE_DIR` is **not configured**, the system reports off-host replication as **not configured** (explicit, non-green in the backup block) — it never silently claims off-host safety. If configured but the copy fails, the backup still counts as locally successful but off-host status goes **degraded**, and the failure is recorded. — **Reversibility:** reversible — status-mapping logic only.
- **Rationale for local+robocopy over object storage:** free tier, zero added dependencies/credentials/secret surface, and honest single-host safety (a host loss no longer loses data + backup together once an off-host path is configured). Object-storage destinations (R2/B2 free tiers) remain a possible later upgrade without changing the receipt contract.

### Restore drill (BAK-02)
- **D-07:** The restore drill runs as a **scheduled BullMQ job on the operator host** (where the backups and Docker live), **not** in CI — CI cannot access the operator's real latest backup, and BAK-02 requires restoring *the latest backup*. It reuses the throwaway-container harness pattern from `scripts/verify-release-integration.mjs` (owned container name, `pg_isready` wait, `rm --force` cleanup). — **Reversibility:** reversible — a worker job reusing an existing, proven harness pattern.
- **D-08:** Drill procedure, in order: (1) locate latest backup file; (2) start owned `postgres:18-alpine` throwaway container on a dynamic port; (3) `pg_restore` the dump; (4) run `prisma migrate deploy` then confirm `migrate status` is **at head / no pending** (proves backup + migration chain is consistent, catches schema drift); (5) run chain-integrity checks; (6) `rm --force` the container; (7) append a verification receipt. — **Reversibility:** reversible — orchestration order; each step reuses existing tooling (`pg_restore`, Prisma CLI).
- **D-09:** Chain-integrity checks (all must pass for a green drill): restored DB reachable; migrations at head; canonical tables non-empty (teams, fixtures, forecast snapshots, value receipts); **FK orphan check returns 0** on key relations; **row-count parity** between restored DB and source counts captured at drill start (proves the dump is complete, not truncated). — **Reversibility:** reversible — read-only checks against the throwaway DB.
- **D-10:** Drill cadence = **weekly** (configurable). A weekly drill is frequent enough to trust each backup without daily container churn. — **Reversibility:** reversible — repeat-interval config.
- **D-11:** **Fail-closed:** if Docker is unavailable on the host, or any drill step fails, the drill records a **failed / unverified** receipt and the status renders **non-green** — it never silently reports green. Successful cleanup is best-effort but a cleanup failure is recorded, not hidden. — **Reversibility:** reversible — status logic; enforces the fail-closed honesty discipline.
- **D-12:** Each drill appends an **immutable verification receipt** (new Prisma model, append-only) capturing: backup file id/name, restore duration, per-check pass/fail, container cleanup outcome, DB version, timestamp. — **Reversibility:** costly — new persisted model + migration + append-only repository contract; undoing needs a follow-up migration and touches the operations read path.

### Management & visibility (BAK-03)
- **D-13:** Operator can trigger **manual "Backup now"** and **"Restore drill now"** from the operations center (cheap, and essential for first-run verification + on-demand trust). — **Reversibility:** reversible — additive internal endpoints + buttons.
- **D-14:** Operations center gains a **"Backups & Restore Verification"** block rendering: last backup (time, file id, size, local + off-host state), backup age with **stale** flag when older than expected cadence + grace (daily → stale after ~25h), last drill (time, pass/fail, failed checks), and an overall state that is **green only when** last backup is fresh AND last drill passed AND drill is not stale. **Never-verified / stale / failed / not-configured** each render as an explicit non-green state. — **Reversibility:** reversible — new read-model block; additive UI, no contract change.
- **D-15:** The block **never exposes secrets**: no connection strings, no credentials; shows only file ids/names, sizes, timestamps, durations, check outcomes, and safe paths with credentials redacted (reuse the existing `RETENTION_DENIED`-style redaction discipline). — **Reversibility:** reversible — masking logic; fail-closed redaction is mandatory, not optional.

### the agent's Discretion
All four gray areas (schedule/retention, off-host storage, restore-drill mechanism, management/visibility) were delegated to the agent. The planner retains flexibility on: exact env-var names (proposed: `BACKUP_ENABLED`, `BACKUP_DIR`, `BACKUP_RETENTION_COUNT`, `BACKUP_OFFSITE_DIR`, `BACKUP_DRILL_*`), exact cron/interval encodings, precise table list for non-empty/FK/parity checks, and where the backup status read-model plugs into the existing operations repository — all guided by the decisions above and existing conventions.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & roadmap
- `.planning/REQUIREMENTS.md` §BAK-01, BAK-02, BAK-03 — the three acceptance requirements for this phase.
- `.planning/ROADMAP.md` §Phase 8 — goal, success criteria, research flags (RPO, off-host, no WAL/pgBackRest/Barman/SaaS, Redis not backed up).

### Reusable harnesses & patterns
- `scripts/verify-release-integration.mjs` — owned throwaway `postgres:18-alpine` + `redis:8-alpine` container harness (dynamic port, `pg_isready` wait, `rm --force` cleanup) — the template for the restore-drill container lifecycle.
- `workers/data-sync/src/jobs/retention-purge.ts` — `scheduleRetentionPurge` interval-scheduler pattern — template for the backup and drill schedulers.
- `workers/data-sync/src/queues/index.ts` — BullMQ queue/worker factory pattern (`createEnrichmentQueue`, etc.) — where backup/drill job wiring belongs.
- `workers/data-sync/src/main.ts` — worker composition root (schedulers started/closed here) — where backup + drill schedulers attach.

### Operations surface (BAK-03 plug-in points)
- `apps/api/src/modules/operations/operations.service.ts` — operations overview assembly (readiness, providerHealth, quotas, failures, dataQuality, incidents) — where backup/drill status joins the overview.
- `apps/web/app/internal/operations/page.tsx` — operations center UI with Russian-labeled `Block` cards — where the backup block renders.
- `packages/database` — Prisma schema + migrations + `DATABASE_URL` handling; where the verification-receipt model and any backup-related tables are added.

### Honesty / redaction discipline (must not regress)
- Existing fail-closed redaction (RETENTION_DENIED-style masking) and immutable-snapshot trigger (`ForecastSnapshot is immutable`, P0001) — reused as chain-integrity evidence and for secret masking in the backup block.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `startOwnedReleaseDependencies()` (verify-release-integration.mjs): proven owned-container lifecycle — reuse its shape for the drill's throwaway Postgres (unique suffix naming, wait-until-ready, best-effort force cleanup).
- `scheduleRetentionPurge()`: proven self-closing interval scheduler — reuse for the daily backup tick and weekly drill tick without adding a cron library.
- Operations `Block` component + Russian labels in `page.tsx`: reuse verbatim for the backup block (consistent loading/error/empty/aria-busy handling).
- Prisma CLI invoked via `process.execPath` + resolved `prisma/build/index.js` (as in verify-release-integration.mjs) — reuse for `migrate deploy` / `migrate status` inside the drill.

### Established Patterns
- Opt-in features gate on config and report honest non-green when unconfigured (matches fail-closed readiness/circuit/gateway discipline).
- Append-only receipts are immutable and versioned — the drill verification receipt follows the same append-only contract.
- Secrets never reach read models or UI; safe metadata only.

### Integration Points
- Worker: new backup job + drill job + two schedulers attach in `main.ts`; queues follow `queues/index.ts` factories.
- API: operations service/repository gains a `backups()` read path; optional manual-trigger endpoints.
- Web: one new `Block` in the operations page.
- Database: one new append-only verification-receipt model (+ any backup catalog table) via migration.

</code_context>

<specifics>
## Specific Ideas

- «Один Windows-хост» — ключевой риск: локальный дамп без off-host-копии = единая точка отказа. Поэтому off-host — явный, видимый шаг (robocopy в настроенную папку), а его отсутствие показано честно.
- Бэкапы — opt-in (`BACKUP_ENABLED`), до настройки статус честно «не настроен / не запускался» (не-зелёный).
- Drill доказывает именно **последний реальный бэкап**, поэтому живёт на хосте оператора, а не в CI.
- Redis не бэкапим. Без WAL, pgBackRest, Barman, платных SaaS.

</specifics>

<deferred>
## Deferred Ideas

- Object-storage off-host destination (Cloudflare R2 / Backblaze B2 free tiers) as an alternative to robocopy — a later upgrade that would not change the receipt contract.
- WAL/point-in-time recovery — explicitly out of scope for v1.1 (daily RPO is the honest target).
- Backing up Redis — permanently out (disposable, not a source of truth).

### Reviewed Todos
None — `todo.match-phase 8` returned 0 matches; discussion stayed within phase scope.

</deferred>

---

*Phase: 8-backups-and-restore-verification*
*Context gathered: 2026-10-22*
