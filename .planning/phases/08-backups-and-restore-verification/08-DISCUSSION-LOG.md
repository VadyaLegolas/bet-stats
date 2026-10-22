# Phase 8: Backups and Restore Verification - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-10-22
**Phase:** 8-backups-and-restore-verification
**Areas discussed:** RPO/частота/ретеншн, Off-host хранилище, Restore drill (где/что проверяем), Управление и видимость

**Global note:** The operator was presented a multi-select of the four gray areas and answered «решай все сам» («decide everything yourself»). No area was selected for interactive discussion — the agent authored all decisions after a codebase scout. Each area below records the options the agent weighed and which it selected, so the reasoning remains auditable.

---

## RPO, частота и ретеншн бэкапов

| Option | Description | Selected |
|--------|-------------|----------|
| Дневной `pg_dump -Fc`, ретеншн 14 дней | Full custom-format dump once per day; rotate last N (default 14) | ✓ |
| WAL shipping / PITR | Continuous archiving for minute-level RPO | |
| Чаще дневного (например, каждые 6ч) | Multiple dumps per day for smaller RPO | |

**Agent's choice:** Дневной `pg_dump -Fc`, ретеншн = последние 14 успешных (DELETE after new success, never before).
**Notes:** Roadmap explicitly excludes WAL/complex tooling; platform data is largely re-derivable from daily provider sync, so ≤24h RPO is the honest baseline. 14 successful dumps ≈ two weeks covers the weekly drill cadence (a bad backup is detected while older good ones are still retained). Rotation deletes only after the new backup succeeds.

---

## Off-host хранилище бэкапов

| Option | Description | Selected |
|--------|-------------|----------|
| Локальный `BACKUP_DIR` + явный off-host через `robocopy` в настроенную папку | Windows-native copy (free, resumable, retry) to an SMB share / cloud-sync folder the operator points at; unconfigured ⇒ honestly "not configured" | ✓ |
| S3-совместимый object storage (R2/B2 free tier) | Adds SDK + credentials + secret surface | |
| Только локальный диск | Single point of failure: host loss loses data + backup together | |

**Agent's choice:** Local `BACKUP_DIR` as primary + optional off-host copy via `robocopy` to `BACKUP_OFFSITE_DIR`.
**Notes:** Single Windows host is the key risk — a local-only dump loses data and backup together on host failure. `robocopy` is free, native, resumable, and needs no SDK/credentials-in-code; the operator can point it at an SMB share or a OneDrive/Syncthing sync folder. If unconfigured, off-host status renders honestly as "not configured" (non-green); if configured-but-failed, the backup stays locally successful but off-host goes degraded. Object storage is a possible later upgrade without changing the receipt contract.

---

## Restore drill: где и что проверяем

| Option | Description | Selected |
|--------|-------------|----------|
| Scheduled worker job on the operator host | Restores the real latest backup into throwaway `postgres:18-alpine` (harness from verify-release-integration.mjs); migrate deploy + status at head; chain-integrity checks; weekly; fail-closed | ✓ |
| CI job on Linux | Has Docker natively but cannot access the operator's real latest backup | |
| Ручной разовый drill | No scheduled trust; "never verified" stays the norm | |

**Agent's choice:** Weekly scheduled worker job on the operator host, reusing the owned-container harness. Checks: DB reachable, migrations at head, canonical tables non-empty, FK orphan check = 0, row-count parity vs source; append immutable verification receipt; `rm --force` cleanup; fail-closed on Docker-unavailable or any failed step.
**Notes:** BAK-02 requires restoring *the latest backup*, which lives on the operator host — CI cannot reach it. Weekly cadence balances trust against container churn. Fail-closed: Docker unavailable or any failed check ⇒ unverified/failed receipt rendered non-green, never silently green. Row-count parity proves the dump is complete (not truncated).

---

## Управление и видимость

| Option | Description | Selected |
|--------|-------------|----------|
| Opt-in + ручной триггер + блок в центре операций | `BACKUP_ENABLED` gate; operator can run "Backup now" / "Drill now"; backup block shows honest never-verified/stale/failed/non-configured as non-green | ✓ |
| Только по расписанию, без ручного запуска | No on-demand verification; harder first-run trust | |
| Автовключение по умолчанию | Surprises the operator with disk writes before BACKUP_DIR is set | |

**Agent's choice:** Opt-in gate + manual triggers + operations-center block.
**Notes:** BAK-01 says operator "can enable" ⇒ opt-in via `BACKUP_ENABLED` + configured `BACKUP_DIR`. Until then status is honestly non-green. Manual "Backup now"/"Drill now" are cheap and essential for first-run trust. Block is green only when last backup fresh AND last drill passed AND drill not stale; never-verified / stale / failed / not-configured each render explicit non-green. No secrets: only file ids/names, sizes, timestamps, durations, check outcomes; credentials redacted per the RETENTION_DENIED discipline.

---

## the agent's Discretion
All four gray areas — schedule/retention, off-host storage, restore-drill mechanism, management/visibility — were delegated to the agent («решай все сам»). No interactive Q&A was conducted; decisions above are agent-authored from the codebase scout.

## Deferred Ideas
- Object-storage off-host destination (R2/B2 free tiers) as a later alternative to robocopy.
- WAL / point-in-time recovery — out of scope for v1.1.
- Redis backup — permanently out (disposable, not a source of truth).
