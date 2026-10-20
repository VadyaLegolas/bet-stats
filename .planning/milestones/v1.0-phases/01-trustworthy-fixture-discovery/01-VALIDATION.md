---
phase: 01
slug: trustworthy-fixture-discovery
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-08-27
---

# Phase 01 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.11 + Supertest + Playwright 1.62.1 + Testcontainers 12.1.0 |
| **Config file** | `vitest.config.ts`, `playwright.config.ts`, `apps/web/eslint.config.mjs` |
| **Quick run command** | `pnpm test:integration -- <file> --run` or `pnpm test:e2e -- <spec>` |
| **Full suite command** | `pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration && pnpm test:e2e && pnpm build && pnpm --filter @bet-stats/database prisma validate` |
| **Estimated runtime** | quick checks <30 seconds; full suite target <10 minutes |

---

## Sampling Rate

- **After every task commit:** Run the focused Vitest project/file command named by the task.
- **After every plan wave:** Run all unit tests plus affected Testcontainers integration tests.
- **Before `$gsd-verify-work`:** Frozen install, lint, typecheck, all tests, production builds, Prisma validation/migration-from-empty, and E2E must be green.
- **Max feedback latency:** 30 seconds for focused task checks.

---

## Per-Task Verification Map

Task and wave identifiers are finalized by PLAN.md; the requirement-level commands below are mandatory inputs to those tasks.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 01-01-T1..T3 | 01-01 | 1 | FOUND-01 | T-01-SC | Frozen workspace install, lint, build and tests | smoke | full frozen matrix | ✅ | ✅ green |
| 01-02-T1..T3 | 01-02 | 1 | FOUND-02 | — | Health responses expose state, not credentials | integration | `pnpm test:integration -- health` | ✅ | ✅ green |
| 01-03-T1..T2 | 01-03 | 2 | FOUND-03 | T-01 | Invalid config fails closed and secret values are redacted | unit + process | `pnpm test -- config` + held-out security | ✅ | ✅ green |
| 01-09-T1..T2 | 01-09 | 7 | FOUND-04, FOUND-05, FOUND-06 | T-02, T-03 | Deny-by-default analytics and responsible copy | integration + content | `pnpm test:integration -- eligibility` + responsible-copy | ✅ | ✅ green |
| 01-10-T1..T2 | 01-10 | 8 | DATA-01, DATA-02, DATA-07 | — | Canonical fixture discovery with honest missingness | API + E2E | `pnpm test:e2e -- fixture-discovery` | ✅ | ✅ green |
| 01-04/05/07 | 01-04..07 | 3–5 | DATA-03, DATA-04 | T-04 | Provider refs reconcile without duplicate canonical fixtures | DB integration | `pnpm test:integration -- reconciliation` | ✅ | ✅ green |
| 01-11-T1..T2 | 01-11 | 8 | DATA-05 | T-05 | Authorized append-only review and audit history | API + DB + E2E | review integration/E2E suites | ✅ | ✅ green |
| 01-08-T1..T3 | 01-08 | 6 | DATA-06 | T-04 | Unresolved identity blocks forecast eligibility | unit + API | forecast-eligibility suite | ✅ | ✅ green |
| 01-06-T1..T2 | 01-06 | 4 | DATA-08 | T-06 | Unknown capability blocks conditional calls and reservations converge | integration | provider-capability suite | ✅ | ✅ green |
| 01-12-T1..T2 | 01-12 | 9 | all Phase 1 | T-01-FINAL | Held-out boundaries and complete frozen matrix | integration + E2E + build | full frozen matrix | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `vitest.config.ts` and package-level Vitest projects with fixed clock/timezone helpers.
- [x] `playwright.config.ts` with deterministic web/API startup and provider seed.
- [x] PostgreSQL 18 migration-from-empty, capability/reservation, reconciliation and audit witnesses.
- [x] Nest application factory with deterministic configuration.
- [x] Provider contract fixtures for valid payloads, nullable fields, unknown status, and malformed objects.
- [x] Content scanner covering source strings and rendered fixture/analytics shells.
- [x] Root package-manager/engine pins, workspace definition, Turbo task graph, strict TypeScript and executable ESLint flat config.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Fixture dashboard/detail hierarchy and state treatment at desktop/mobile | DATA-01, DATA-02, DATA-07 | Automated under `--auto` with screenshot-buffer and semantic assertions at 360px/1280px, forced colors, reduced motion and 200% text zoom | ✅ `fixture-discovery.spec.ts` rendered both viewports, produced non-empty visual evidence, retained heading/filter/result order, visible `Limited data`, provenance and null wording, and no horizontal overflow. |
| Eligibility/responsible-use allow/deny wording | FOUND-04, FOUND-05, FOUND-06 | Automated under `--auto` through empty, allowed, blocked, missing-age and stale matrices plus exact copy assertions | ✅ Eligibility + held-out suites passed 16/16; empty allowlist, unknown/disallowed region, missing acknowledgement and stale decision deny; representative `PL` allow requires affirmative 18+ input; protected descendants remain absent on deny. |

---

## Locked Decision and Coverage Audit

| Decisions | Witnesses | Status |
|---|---|---|
| D-01–D-03 | provider contract/job, fixture API and responsive dashboard/detail E2E | ✅ |
| D-04–D-07 | eligibility domain/controller/guard, analytics shell and responsible-copy suites | ✅ |
| D-08–D-12 | schema migrations, reconciliation and review PostgreSQL suites | ✅ |
| D-13–D-16 | data-state, forecast-eligibility, freshness and capability suites | ✅ |
| D-17–D-19 | protected review integration/E2E, server-only proxy and held-out secret probes | ✅ |
| COVERAGE integrate/opt-out fences | provider-capability, request reservation and held-out source-surface scans | ✅ No automatic wagering, odds, prediction, fallback, history/Elo, results/standings, lineup/injury or enrichment implementation surface. |

## Final Frozen Evidence

- Frozen install: green; lockfile unchanged.
- Lint: 1/1 workspace lint task green with Next flat config.
- Typecheck: 7/7 workspace tasks green.
- Unit: 5 files, 34/34 green across package and repository suites.
- Integration: 7 files, 37/37 green, including migration-from-empty and PostgreSQL 18 review/capability witnesses.
- Browser: 14/14 Chromium tests green; automated visual review included 360px and 1280px dashboard/detail renders.
- Build: 7/7 workspace builds green.
- Prisma: schema valid with a test-only syntactic `DATABASE_URL`; no connection was made for validation.
- Secrets: `OPERATOR_CREDENTIAL` existed only in the test process environment and was not persisted.

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies.
- [x] Sampling continuity: no 3 consecutive tasks without automated verify.
- [x] Wave 0 covers all originally missing references.
- [x] No watch-mode flags.
- [x] Focused feedback latency remained under 30 seconds outside full Docker/browser matrices.
- [x] `nyquist_compliant: true` set only after the complete frozen matrix passed.

**Approval:** approved automatically under `--auto` after complete green evidence on 2026-08-28.
