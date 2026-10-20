---
phase: 7
slug: ci-pipeline-quality-gates
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-10-20
---

# Phase 7 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.11 (unit + integration projects) + Playwright 1.62.1 (E2E); apps/web has its own vitest config |
| **Config file** | `vitest.config.ts` (root, defines `unit` and `integration` projects); `playwright.ci.config.ts` (new, Phase 7) |
| **Quick run command** | `pnpm vitest run --project unit` (plus `pnpm --filter @bet-stats/web test` for web) |
| **Full suite command** | `pnpm test && node scripts/verify-release-integration.mjs` (integration needs Docker) |
| **Estimated runtime** | ~60 s quick; ~5-8 min full (Docker integration) |

---

## Sampling Rate

- **After every task commit:** `pnpm vitest run --project unit` + `pnpm typecheck` + `pnpm lint` (< 60 s target).
- **After every plan wave:** full local `node scripts/verify-release-integration.mjs` + `pnpm test`.
- **Before `/gsd-verify-work`:** Full suite must be green.
- **Phase gate:** first green run of all three CI jobs on `main` + the deliberate-breakage drill on a throwaway PR (success criterion 4).
- **Max feedback latency:** 60 seconds.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 7-xx-xx | TBD | 1 | CI-01 | V8 | `--frozen-lockfile` install; pinned action majors; `permissions: contents: read`; no `pull_request_target` | workflow smoke + deliberate-breakage drill | push branch → observe jobs; type error → red → revert | ❌ Wave 0 (`ci.yml`) | ⬜ pending |
| 7-xx-xx | TBD | 1 | CI-02 | V8 budget | No provider credentials in CI; harness fails loudly when Docker missing | integration | `node scripts/verify-release-integration.mjs` | ✅ harness exists | ⬜ pending |
| 7-xx-xx | TBD | 1 | CI-03 | — | Lint certifies every workspace package, not one | lint + meta-check | `pnpm lint` (turbo, all 7 packages) | ❌ Wave 0 (6 configs + 6 scripts) | ⬜ pending |
| 7-xx-xx | TBD | 1 | CI-04 | — | Frozen snapshot/receipt tables reject UPDATE and DELETE at the DB layer | integration (DB-backed) | `pnpm exec vitest run --project integration tests/integration/mutation-rejection.test.ts` | ⚠️ Wave 0 (extend existing; triggers already exist) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

**CI-04 gap list (6 items, Pattern 3 in RESEARCH.md):** ValueReceipt DELETE, ValueSettlement DELETE, ClosingOddsObservation U+D, ForecastMarket U+D, ResultVersion U+D (assert with `/append-only/i` pattern), SourceObservation U+D.

---

## Wave 0 Requirements

- [ ] `.github/workflows/ci.yml` — three jobs (quality, integration, portable E2E smoke).
- [ ] `lint` scripts + flat configs for `apps/api`, `workers/data-sync`, `packages/config`, `packages/database`, `packages/domain`, `packages/football-data` (typescript-eslint@8.72.0 + globals; eslint pinned 9.39.5 to match web).
- [ ] `playwright.ci.config.ts` — no webServer, two portable specs (`evidence-scorecard.spec.ts`, `team-evidence-live.spec.ts`).
- [ ] `tests/integration/mutation-rejection.test.ts` — CI-04 gap list above.
- [ ] `.gitattributes` (`* text=auto eol=lf`, binary exceptions), `.npmrc` (`engine-strict=true`).
- [ ] Branch protection on `main` requiring the three checks (operator task via `gh api`).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Pipeline runs on GitHub-hosted runners | CI-01 | Requires push to a real GitHub remote; local act-runner is not equivalent | Push branch, open PR, observe all jobs green; then deliberate-breakage drill (type error → red → revert) |
| Branch protection blocks merge on red | CI-01 | GitHub settings mutation | `gh api` to enable required checks; attempt merge with a failing check |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
