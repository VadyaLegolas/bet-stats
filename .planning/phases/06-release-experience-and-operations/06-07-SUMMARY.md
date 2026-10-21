---
phase: 06-release-experience-and-operations
plan: 07
subsystem: privacy-database
tags: [privacy, consent, retention, prisma, postgresql, fail-closed]
requires:
  - phase: 06-release-experience-and-operations
    provides: approved D-13/D-14 fail-closed policy and one-way deletion boundary from 06-06
provides:
  - Deterministic fail-closed retention policy and signed-subject contract
  - Versioned consent plus separately deletable odds and viewed-result associations
  - PostgreSQL enforcement preventing writes without active consent and reverse links from immutable facts
affects: [06-08, consent-withdrawal, privacy-retention, release-verification]
actuals:
  tokens: 2089
  tasks: 2
  commits: 4
tech-stack:
  added: []
  patterns: [closed policy resolution, signed subject assertions, consent-gated association tables, one-way analytical unlinkability]
key-files:
  created:
    - packages/domain/src/privacy/retention.ts
    - packages/database/prisma/migrations/20260920_privacy_retention/migration.sql
    - tests/integration/privacy-retention.test.ts
  modified:
    - packages/config/src/index.ts
    - packages/domain/src/index.ts
    - packages/database/prisma/schema.prisma
    - packages/database/src/generated/prisma/
key-decisions:
  - "Durable opt-in remains unavailable unless signed subject mode, duration, policy version, and canonical effective timestamp are all explicitly supplied."
  - "Only exact verified signed-subject-provider assertions are accepted; ambient request, session, source, and log metadata cannot become identity."
  - "Personal odds and viewed-result history lives only in cascade-deletable association tables; immutable analytical tables retain no reverse subject, consent, session, or correlation link."
patterns-established:
  - "Fail-closed policy parsing converts absent or invalid authorization inputs into deterministic unavailable state without guessing defaults."
  - "PostgreSQL triggers require a current unrevoked consent and unblocked signed subject for every retained-history write."
requirements-completed: [PRIV-01]
coverage:
  - id: D1
    description: "Durable retention defaults off and becomes available only with every explicit approved policy input and verified signed subject assertion."
    requirement: PRIV-01
    verification:
      - kind: integration
        ref: "tests/integration/privacy-retention.test.ts#privacy retention policy"
        status: pass
    human_judgment: false
  - id: D2
    description: "Consent-gated personal odds/view associations are deletable while immutable analytical facts remain intact and unlinkable."
    requirement: PRIV-01
    verification:
      - kind: integration
        ref: "tests/integration/privacy-retention.test.ts#privacy retention persistence"
        status: pass
      - kind: other
        ref: "Prisma validate, migrate deploy, and db push against PostgreSQL 18"
        status: pass
    human_judgment: false
duration: 9min
completed: 2026-09-20
status: complete
---

# Phase 06 Plan 07: Fail-Closed Privacy Retention Summary

**Versioned consent and signed-subject enforcement now gate separate deletable personal history while immutable analytical facts remain structurally unlinkable.**

## Performance

- **Duration:** 9 min
- **Started:** 2026-09-20T20:29:00Z
- **Completed:** 2026-09-20T20:38:08Z
- **Tasks:** 2
- **Files modified:** 19

## Accomplishments

- Added an executable D-13 policy contract that exposes deterministic unavailable state unless every approved input is explicitly configured; no subject mechanism, duration, version, or effective date is invented.
- Added versioned consent, signed-subject, retained-odds, and viewed-result models with cascade deletion, expiry indexes, and database-enforced active-consent checks.
- Proved on PostgreSQL 18 that default-deny writes fail, active consent permits only separate associations, expiry denies writes, deletion preserves immutable facts, and immutable tables contain no reverse identity columns.

## Task Commits

1. **Task 1 RED: Define retention policy expectations** - `4724183` (test)
2. **Task 1 GREEN: Define the closed versioned retention policy** - `0312b76` (feat)
3. **Task 2 RED: Define persistence-boundary expectations** - `a403ddc` (test)
4. **Task 2 GREEN: Persist consent and deletable associations outside immutable facts** - `7352c6f` (feat)

## Files Created/Modified

- `packages/domain/src/privacy/retention.ts` - fail-closed policy resolver, covered categories, and strict signed-subject assertion validation.
- `packages/config/src/index.ts` - optional privacy inputs with no policy defaults or inferred values.
- `packages/database/prisma/schema.prisma` - separate consent and personal-association models with no reverse relation from immutable facts.
- `packages/database/prisma/migrations/20260920_privacy_retention/migration.sql` - tables, constraints, indexes, cascades, and active-consent triggers.
- `packages/database/src/generated/prisma/` - regenerated Prisma 7 client for the new schema models.
- `tests/integration/privacy-retention.test.ts` - policy and real PostgreSQL persistence evidence.

## Decisions Made

- Preserved the exact 06-06 approval: the current deployment has no approved values, so durable opt-in remains disabled while ordinary analysis is unaffected.
- Represented the approved identity seam only as signed provider mode plus an exact verified assertion; no concrete provider or subject derivation was introduced.
- Kept links one-way from deletable history to immutable odds facts. Deleting a subject cascades personal rows but cannot delete or mutate the analytical fact.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Regenerated the checked-in Prisma client**
- **Found during:** Task 2
- **Issue:** The plan named schema and migration files but the repository tracks generated Prisma client models; leaving them stale would make the new schema unavailable to later application code.
- **Fix:** Ran Prisma 7 client generation and committed the resulting model/type updates with the schema task.
- **Files modified:** `packages/database/src/generated/prisma/`
- **Verification:** `pnpm --filter @bet-stats/database typecheck` passed.
- **Committed in:** `7352c6f`

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Generated artifacts were required to keep the checked-in database client consistent; no product scope or privacy policy changed.

## Known Stubs

None. Missing policy inputs are the approved fail-closed production state, not placeholders.

## Issues Encountered

- The repository currently runs Node 25.2.1 while declaring Node 24.x. Targeted tests and typechecks passed with an engine warning; the Phase 06 final release gate must still run under the required Node 24 runtime.
- `pnpm exec vitest` did not resolve the Windows binary in this shell, so the identical pinned workspace Vitest executable was invoked directly from `node_modules/.bin`.

## Threat Flags

No unplanned threat surface was introduced. The new database boundary implements T-06-15 and T-06-16: signed identity is required, ambient identifiers are rejected, personal rows are separately deletable, and immutable facts have no reverse identity link.

## User Setup Required

Durable personal-history opt-in intentionally remains unavailable. Enabling it later requires authorized exact values for the signed subject-provider adapter, retention duration, policy version, and effective date; this plan supplies none of them.

## Next Phase Readiness

- Plan 06-08 can build transactional consent and withdrawal services on the generated Prisma models and subject-blocking field.
- Withdrawal must lock the subject row, set `retentionBlockedAt`, revoke consent, delete both history tables, invalidate related cache, and preserve the demonstrated immutable-fact boundary.
- The final release verification remains blocked from trusted completion until run under Node 24 as required by the repository engine contract.

## Self-Check: PASSED

- All created source, migration, test, and generated-model files exist.
- Commits `4724183`, `0312b76`, `a403ddc`, and `7352c6f` exist in git history.
- The full privacy-retention suite passed 18/18 against PostgreSQL 18.
- Prisma schema validation, migration deploy, fresh-database db push, and all three affected package typechecks passed.

---
*Phase: 06-release-experience-and-operations*
*Completed: 2026-09-20*
