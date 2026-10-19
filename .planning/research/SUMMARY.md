# Project Research Summary

**Project:** bet-stats — Football Prediction & Value Betting Platform
**Domain:** Sports analytics / value-betting research tooling (v1.1 milestone, 10 improvement features on a shipped v1.0)
**Researched:** 2026-10-19
**Confidence:** HIGH (integration + stack, codebase-verified); MEDIUM (feature-behavior details)

## Executive Summary

This is a **v1.1 milestone research effort on an existing, shipped v1.0 platform** — not greenfield. The product is a single-operator, free-tier-only football prediction and value-betting analytics tool whose core value is *honest, reproducible, auditable probability measurement* under a hard responsible-gambling (RG) constraint: no automatic wagering, no certainty/urgency framing, Russian-language user-facing text, manual odds entry. Experts build this class of product gate-first: establish CI and verifiable data safety **before** touching the model or adding user surfaces, then run a model-quality track (Dixon-Coles → calibration) and a value-experience track (CLV diary → new markets → scanner → journal) where every derived fact is an immutable, versioned, superseding row — never a mutation. All three of the independent ordering derivations in the research (FEATURES dependency graph, ARCHITECTURE build waves, PITFALLS pitfall-to-phase mapping) **converge on the same order**, which is a strong signal for the roadmap.

The recommended approach adds almost **zero new runtime dependencies**. The v1.0 stack (Node 24 LTS, pnpm + Turborepo, Next.js 16 App Router, NestJS 11, Prisma 7 + PostgreSQL 18, Redis 8 + BullMQ 6, decimal.js, Zod, cockatiel, Vitest + Playwright) already covers everything except GitHub Actions itself. CI is hosted GitHub Actions on `ubuntu-latest`; backups wrap `pg_dump -Fc` plus a throwaway-container restore drill; alerting reuses BullMQ `QueueEvents` + native `fetch` webhooks with PostgreSQL-durable alert rows; calibration, Dixon-Coles, Asian handicap and exact-score math are pure auditable TypeScript in `packages/domain`; the scanner and journal are server-rendered reads over existing immutable receipts. The research corrected several facts in the milestone brief against the actual code: there is **no CI today, lint covers only `apps/web`, there is no Recharts/TanStack Query/Tailwind/Testcontainers in the repo, the score matrix is never persisted, and `modelVersion` is hard-pinned in ≥10 files** — these verified repo facts, not the brief, must drive planning.

The key risks, in order of severity: (1) **immutability erosion** — every new feature tempts a convenience `UPDATE` to frozen snapshots/receipts; enforce append-only + supersession + mutation-rejection tests as a platform invariant from Phase 1. (2) **Model-track correctness** — a Dixon-Coles sign-convention bug or a calibrator fitted on the wrong model version or with leakage silently destroys the product's core claim; pin the τ convention in tests, bump `modelVersion` whenever probabilities change, and fit calibrators strictly per `modelVersion` on held-out windows with min-sample rollback gates. (3) **Windows-dev / Linux-CI fiction** — Testcontainers cannot run on Windows runners; integration jobs must be Linux-only, fail (not skip) when Docker is missing, and CI must never call live providers (free-tier 100 req/day budget). (4) **RG/copy failures on new surfaces** — scanner, journal and calibration displays must extend the prohibited-vocabulary suite and Russian-copy checks in the phase that builds them. All of these have concrete, verifiable prevention checks documented in PITFALLS.md's per-phase verification table.

## Key Findings

### Recommended Stack (STACK.md — HIGH confidence, codebase-verified)

The v1.1 milestone is dependency-light by design: only `@lhci/cli` (devDep) is unconditionally new; `fast-check`/`@fast-check/vitest` (property tests) and `nodemailer` (only if SMTP is the operator's alert channel) are optional. Everything else reuses the pinned v1.0 baseline verified in the repo on 2026-10-19.

**Core technologies added or activated:**
- **GitHub Actions (ubuntu-latest)** — single CI workflow: frozen-lockfile install → schema verify → typecheck → lint → unit → integration (Docker services via existing `verify-release-integration.mjs`) → build → E2E smoke. Uses `actions/checkout@v6`, `actions/setup-node@v7`, `pnpm/action-setup@v5+` (reads `packageManager`, no version drift).
- **`pg_dump -Fc` + throwaway `postgres:18.6-alpine` container** — nightly dumps with rotation, and a scheduled *restore drill* (restore → `prisma migrate deploy` → chain-integrity sentinel queries → receipt). No pgBackRest/Barman/SaaS (overkill, paid).
- **BullMQ `QueueEvents` + native `fetch` webhook + PostgreSQL alert tables** — dead-letter/5xx/quota/backup-age signals → durable `OpsAlert` rows (dedup) → operator channel; alert state never lives in Redis or only in a channel.
- **`@lhci/cli@^0.15.1` + `next experimental-analyze` + existing `@axe-core/playwright`** — budget-gated Lighthouse on the production build; target is the ~39 KB client component `forecast-workbench.tsx` (no charting library exists or should be added — it would hurt the budget).
- **Pure TypeScript in `packages/domain`** — PAVA isotonic (~40 lines) + Platt (few Newton steps); Dixon-Coles τ(0-0, 1-0, 0-1, 1-1) with ρ by 1-D grid search; AH quarter-line splits and exact-score as direct transforms of the existing Poisson score matrix. No ML/numerical libraries.
- **Prisma 7 DDL** — `CalibrationVersion` + `CalibrationApply`, `OpsAlert`/`OpsAlertTransition`/`OpsAlertDelivery`, `BackupVerificationReceipt`, `PaperTrade` (≈5 migrations); `ClosingOddsObservation` already fits F7 needs (no schema change — but it has **no write API today**).
- **`decimal.js` (existing)** — all money-adjacent math: odds, EV, CLV ratios, bankroll/units.

**Critical repo facts that override the brief:**
- No Recharts, no TanStack Query, no Tailwind, no Testcontainers in the repo (web = server components + hand-written CSS + plain tables). Do not add them mid-milestone.
- No `.github/` at all; `turbo run lint` silently covers only `apps/web` — extend flat ESLint config to `apps/api`, `apps/api-e2e`, `workers/*` before making lint a required gate.
- E2E live-stack tests shell out to `cmd.exe` (Windows-only); CI must use the cross-platform `verify-release-integration.mjs` path instead.
- `fast-check` is only transitive (via `effect`) — must be declared explicitly to import it.

See STACK.md for the full version-compatibility matrix and "What NOT to Use" list.

### Expected Features (FEATURES.md — MEDIUM confidence)

**Must have (table stakes):**
- **#1 CI pipeline** — v1.0 shipped 88 plans without CI; every later feature lands behind this gate (P1)
- **#2 Backups + verified restore** — the prediction/odds history is irreproducible from anywhere else; restore drill ≠ dump file (P1, existential)
- **#3 Operator degradation alerting** — providers and BullMQ jobs fail *silently* by design; failed set is the only signal (P1)
- **#4 Lighthouse audit + measurable fixes** on `/fixtures/[id]` — before/after metric deltas, not vanity scores (P2)
- **#9 7-day value scanner** — the core user journey is buried per-fixture today; cheapest highest-leverage win (P1, LOW complexity)

**Should have (competitive differentiators):**
- **#5 Isotonic/Platt calibration + versioned rollback** — Platt-first (isotonic overfits below ~200–1,000 examples); published reliability diagram + rollback on Brier regression is near-unique in the market (HIGH complexity)
- **#6 Dixon-Coles correction** — transparent 4-cell τ fix; improves draw/O-U 0.5/1.5/BTTS/exact-score, **neutral on O/U 2.5** (must not claim otherwise)
- **#7 CLV diary** — the professional process metric; fail-closed "closing price unavailable" instead of fabricated closes (odds are manual, so absent-close is a first-class state)
- **#8 Asian handicap + exact score** — both derive from the *same frozen score matrix*; zero new data cost, but settlement correctness (quarter-line splits, push/half-win/half-loss) is unforgiving (HIGH complexity)
- **#10 Paper-trading journal** — validates the whole loop without wagering; strongest RG alignment; flat vs ¼-Kelly series, push-aware ROI denominators, append-only

**Defer (v2+):** licensed closing-line feeds (sharp-close CLV), isotonic upgrade trigger (≥1,000 settled/market), Shin/power overround, CI remote caching, Python model service.

**Anti-features (explicitly reject):** auto-betting/execution, urgency framing, synthesized closing prices, auto-rollback on tiny Brier deltas, calibrating on fitting data, backup theater, Lighthouse 100/100 chasing, gamified hot streaks, per-job-failure paging.

Explicitly excluded from this milestone (per scope): league expansion, user notifications, user accounts, UI i18n.

### Architecture Approach (ARCHITECTURE.md — HIGH for codebase-verified integration)

Five cross-cutting patterns govern every feature: **(1) versioned identity instead of mutation** (every artifact carries version + hash-of-inputs, superseded via `supersedes*Id` chains); **(2) derived-not-mutated for frozen snapshots** (calibrated probs and backfilled markets are new tables keyed to `forecastSnapshotId`); **(3) calibration is a post-hoc layer, NOT a new modelVersion** (independent rollback, raw+calibrated side-by-side); **(4) fail-closed derived display** (typed unavailable reasons, never fabricated values); **(5) signal → durable receipt → operator channel** (detection lives in Postgres, channels are just delivery attempts).

**Major components added:**
1. **CI workflows + lint parity** (`.github/workflows/ci.yml`, `lighthouse.yml`) — the safety net for all schema/contract changes
2. **`infra/backup/`** (pg-backup.sh, verify-restore.mjs, compose prod stack) — host-level, runs without the app stack
3. **`apps/api/modules/alerts` + `workers/jobs/alerts.ts`** — signal evaluators, dedup, dispatch; ops-center tab
4. **`packages/domain/forecast/dixon-coles.ts` + `calibration/*`** — pure math, versioned identity, fit/promote job in worker
5. **`apps/api/modules/journal` + `/scanner` + `/internal/journal` pages** — operator-gated reads over receipts

**Critical verified integration findings (from source):**
- The **score matrix is never persisted** — F8 must persist the 64-cell matrix into snapshot `receipt` Json at issuance (recommended, no DDL; key must be optional-with-derivation for legacy rows) or fail-closed re-derive for `poisson-ensemble-v1` only.
- **`modelVersion` is hard-pinned as a string literal in ≥10 files** — F6 must widen the shared union in one pass; partial widening compiles nowhere.
- **`ClosingOddsObservation` has no write API** — F7 is wiring + validation + UX, not schema.
- **`evaluation/value-candidates` is settled-history only** — the scanner is a distinct forward-looking query over `ValueReceipt`; new endpoint, don't overload it.
- **`settlement-pipeline.ts` has a hardcoded 3-market guard** — missing the F8 widening fails settlement at *runtime*, not compile time.

See ARCHITECTURE.md for the full per-feature NEW/MODIFIED/migration integration table and data flows.

### Critical Pitfalls (PITFALLS.md — HIGH confidence)

1. **CI green on one OS, fiction on the other** (P1) — GitHub **Windows** runners cannot run containers at all (`actions/runner#904`), and `windows-2025` breaks Testcontainers even with Docker present. Run the full integration suite only on `ubuntu-latest`; missing-Docker must **fail, not skip**; branch protection makes it required; never call live providers from CI.
2. **Backups that cannot restore** (P2) — verify via scheduled restore drill into a same-image throwaway container with chain-integrity queries (no orphan `supersedes*Id`); store off-host; Redis is never backed up; "never verified" is a visible non-green state.
3. **Calibration leakage + snapshot mutation** (P5) — fit only on held-out settled windows per exact `modelVersion`+`modelHash` (calibrator must be *structurally refused* on mismatched models); min cohort gates (≥200/class isotonic, else Platt, else honest "недостаточно данных"); rollback with hysteresis (material threshold + min N, at most one per window); never write back into `ForecastMarket.probabilities`.
4. **Dixon-Coles sign convention / instability / double-counted home advantage** (P6) — opposite τ conventions exist in the wild; pin one, test it (ρ=0 must reproduce Poisson bitwise; τ cells strictly positive; draw must *rise* for the documented ρ sign); constrain ρ to the admissible band; home advantage must exist exactly once on the ratings→λ,μ path; bump `modelVersion` the moment probabilities change.
5. **Scanner as a stale "best bets" megaphone** (P9) — read-only projection over `ValueReceipt` stored edges (byte-equality test), never recompute; freshness as a first-class demoted column; no edge-sorted leaderboard; single SQL projection (no N+1); RG copy suite.
6. **CLV hindsight/survivorship** (P7) — true-UTC capture before settlement, blocked after kickoff; de-vigged same-line comparison only; retrospective observations tagged and excluded; CLV is evaluation-only — never an input to scanner ranking or journal picks.
7. **Journal casino semantics + tamperable history** (P10) — append-only supersession linked to `valueReceiptId`; Russian «юниты/симуляция» vocabulary, no deposit/withdrawal verbs; Kelly ≤ ¼ descriptive; mutation-rejection test in CI.
8. **Immutability eroded one convenience write at a time** (P11, all phases) — state the invariant once: durable facts are appended, change = superseding row with reason, derived views are rebuildable. Add Postgres update-restrictions on receipt/snapshot tables now that ten new writers exist.
9. **Free-tier budget burned by tooling** (P12) — CI/audits/alert probes must never hit live providers; probes check internal state only; one shared egress-budget discipline.
10. **New surfaces shipping English/certainty/disclaimer-free copy** (P13) — extend the prohibited-claims suite and ASCII-only-string scan to every new surface in the phase that builds it; all new pages compose existing disclaimer components.

See PITFALLS.md for the 12 feature↔feature integration gotchas (C1–C12), the "Looks Done But Isn't" checklist per phase, and recovery strategies.

## Implications for Roadmap

Based on the convergent ordering across all four research files, suggested phase structure (10 phases in 4 waves):

### Phase 1: CI Pipeline & Quality Gates
**Rationale:** First — F5–F10 all land high-risk schema/contract changes that need this safety net; lint parity must exist before lint gates anything.
**Delivers:** `.github/workflows/ci.yml` (install→schema→typecheck→lint→unit→integration on Linux Docker→build→E2E smoke), lint extended to api/workers/domain, `.gitattributes`/engine pins, mutation-rejection test scaffolding, branch protection.
**Addresses:** F1 (FEATURES #1, P1).
**Avoids:** Pitfall 1 (OS-parity fiction), Pitfall 12 (no live provider calls), Pitfall 11 (mutation-rejection tests land here), gotcha C10.

### Phase 2: Backups + Restore Verification
**Rationale:** Before any phase that changes schema or model code — that is when a bad migration becomes unrecoverable. Parallel-safe with Phases 1 and 4.
**Delivers:** `pg-backup.sh` (-Fc + rotation), `verify-restore.mjs` (throwaway container restore drill + chain-integrity sentinels + receipt), compose backup service/volume, ops-center backup status, off-host storage decision.
**Addresses:** F2 (P1, existential).
**Avoids:** Pitfall 2 (backup theater), gotcha C8 (feeds Phase 3 alerting).

### Phase 3: Degradation Alerting
**Rationale:** After Phase 2 (backup/restore age is a critical alert signal) and Phase 1 (CI-gated); before model-quality phases so DC/calibration rollouts are observable.
**Delivers:** `alerts` module + worker tick, signal adapters (quota, BullMQ failed-set-as-DLQ, SyncRun, 5xx buckets, backup age), OpsAlert/Transition/Delivery tables, dedup + severity tiers + redaction test, webhook (±nodemailer) dispatch, ops-center alert tab.
**Addresses:** F3 (P1).
**Avoids:** Pitfall 3 (fatigue/secrets/silent delivery), Pitfall 12 (internal-only probes), gotcha C8.

### Phase 4: Performance Audit & Fixes (`/fixtures/[id]`)
**Rationale:** Establish bundle/rendering budgets *before* the Scanner and New-markets UI phases build new pages; parallel-safe with Phases 1–3 (touches only web + workflows).
**Delivers:** Baseline LHCI audit (median-of-3), fixes (parallelize fetches, `React.cache`, `next/dynamic` split of `forecast-workbench.tsx`), `lighthouserc.json` + `budgets.json` audit-level assertions in CI, before/after numbers published honestly.
**Addresses:** F4 (P2).
**Avoids:** Pitfall 4 (composite-score chasing), gotcha C9 (bundle budget enforced for all later UI).

### Phase 5: Dixon-Coles Model Version
**Rationale:** Model change must precede calibration (calibrators fit the *final* pipeline) and precede new markets (AH/exact-score derive from the corrected matrix). First half of the model-quality track.
**Delivers:** `dixon-coles.ts` (τ with pinned convention, bounded ρ grid search), `modelVersion` union widened across all ≥10 pinned files in one pass, config/version bumps, out-of-sample backtest on rolling-origin harness, methodology card section naming the exact integration.
**Addresses:** F6 (P1-precedes-#5).
**Avoids:** Pitfall 6 (sign/convergence/double-count), gotcha C3 (backtests pin model version), Pitfall 11 (hash bumps).

### Phase 6: Calibration Layer + Versioned Rollback
**Rationale:** Strictly after Phase 5 — fitting on v1-Poisson then switching models invalidates calibrators (Anti-Pattern 2 / gotcha C1). Second half of model-quality track; before Scanner so calibrated values can be labeled from day one.
**Delivers:** `calibration/{isotonic,platt,contract}.ts`, `CalibrationVersion`/`CalibrationApply` DDL, fit→holdout-evaluate→promote/rollback worker job (Platt-first, min-N gates, hysteresis), raw-vs-calibrated display with version labels, reliability diagram + before/after Brier.
**Addresses:** F5 (P2, core-value differentiator).
**Avoids:** Pitfall 5 (leakage, snapshot mutation, thrash), gotchas C1, C7, C11.

### Phase 7: CLV Price Diary
**Rationale:** Pure wiring over an existing table; before markets (closing capture covers new selections day one) and before journal (displays CLV per trade). Can run parallel to Phase 5/6 scoping.
**Delivers:** Closing-odds write API in OddsModule (validation per `clv.ts`: UTC observedAt, pre-kickoff, sourceConvention match), operator entry UI, diary read routes, fail-closed unavailable states, contamination firewall (CLV never feeds scanner/journal decisions).
**Addresses:** F7 (P2).
**Avoids:** Pitfall 7 (hindsight/survivorship/fake precision), gotchas C5, C12.

### Phase 8: Asian Handicap + Exact Score Markets
**Rationale:** After Phase 5 (derive from the corrected matrix) and Phase 7 (settlement joins keyed by market/selection). Largest spec surface of the milestone — lines/buckets/push semantics.
**Delivers:** Score-matrix persistence at issuance (or fail-closed re-derivation for legacy Poisson rows), market/line/bucket config incl. `OTHER` tail catch-all, `MARKET_SELECTIONS`/`SCORE_CLASS_ORDER`/`isScoreMarket` widening, quarter-line half-bet decomposition + push/void settlement tests, push-aware EV, per-market sample gates.
**Addresses:** F8 (P2, HIGH).
**Avoids:** Pitfall 8 (push accounting, 3-way→2-way renorm, longshot noise), gotcha C4 (cross-market coherence test), Anti-Pattern 5 (book completeness).

### Phase 9: 7-Day Value Scanner
**Rationale:** After Phase 8 so the window query is written once against the final market set; after Phase 4 so the bundle budget applies as the page is built. Cheap (LOW complexity) high-leverage win.
**Delivers:** New forward-looking `ValueReceipt` candidates endpoint (cursor-paged, single projection), `/scanner` server component, freshness demotion + explicit stale toggle, honest empty/limited states, RG copy suite extension.
**Addresses:** F9 (P1 by user value).
**Avoids:** Pitfall 9 (edge recompute, stale-as-fresh, leaderboard, N+1), gotchas C2, C7, C12.

### Phase 10: Paper-Trading Journal
**Rationale:** Last — pure consumer of ValueReceipts + ValueSettlements + CLV + scanner deep-links; inherits every discipline built earlier.
**Delivers:** `PaperTrade` append-only DDL (FK Restrict to valueReceiptId, supersession corrections), JournalModule @OperatorGuard, `/internal/journal` page, flat vs ¼-Kelly series, push-aware ROI/drawdown aggregates, Russian simulation vocabulary, persistent virtual-label.
**Addresses:** F10 (P2).
**Avoids:** Pitfall 10 (casino semantics, editability, Kelly advice), gotcha C6, privacy boundary (never leaks to public read models).

### Phase Ordering Rationale

- **CI → backups → alerting** is the safety-net ordering: gates before risk, recovery before mutation, observability before model changes. Backup-age becomes an alert signal (C8).
- **DC → calibration** is non-negotiable (C1/Anti-Pattern 2): calibrators are fitted *per modelVersion*; any earlier fit is invalidated by the model bump.
- **CLV → markets → scanner → journal** closes the value loop in dependency order: journal must settle AH push/half-loss correctly (#8 before #10); scanner should list all markets from day one (#8 before #9); journal shows CLV per trade (#7 before #10).
- **Performance budgets before new UI** (C9): the scanner and journal pages inherit the bundle discipline rather than triggering a re-audit.
- **Parallel-safe pairs** (for planning flexibility): (P1, P2, P4) at wave 0; P3 ∥ P5 scoping; P9 ∥ P10 implementation after P8 lands.
- **Optional consolidation if the roadmapper wants fewer phases:** Phases 1+2 ("operational foundation") and Phases 9+10 ("value loop closing") are safe merges — both pairs have no intra-pair dependencies. Keep Phases 5/6 separate (different failure modes, HIGH+MEDIUM sizes) and Phase 8 standalone (largest spec surface).

### Research Flags

Phases likely needing deeper research (`/gsd-plan-phase --research-phase N`):
- **Phase 5 (Dixon-Coles):** open domain decision — Elo/form-derived λ,μ + fitted per-league ρ (recommended for v1.1, labeled as hybrid) vs full DC attack/defence refit (risks double-counting home advantage); ρ fitting window and decay selection are project-specific.
- **Phase 6 (Calibration):** min cohort sizes and rollback materiality thresholds are policy decisions to record in `configVersion`; 1X2 3-class renormalization strategy needs design.
- **Phase 8 (New markets):** ARCHITECTURE explicitly flags this as needing its own phase research spike — score-matrix persistence key shape (must play with `exactKeys` validation on legacy rows), AH line set, exact-score bucket list + `OTHER`, push-aware EV display.
- **Phase 2 (Backups):** RPO target (daily dump vs WAL shipping) and off-host destination are operator decisions for the actual deployment target (single Windows host).
- **Phase 3 (Alerting):** actual free-tier channel choice (webhook vs SMTP) and its rate limits need runtime verification at implementation time.

Phases with standard patterns (skip research-phase):
- **Phase 1 (CI):** well-documented Turborepo + GitHub Actions + Testcontainers-on-Linux patterns; repo harness already exists.
- **Phase 4 (Lighthouse):** official LHCI docs + existing Next 16.3 in-repo docs (`node_modules/next/dist/docs/` per AGENTS.md mandate).
- **Phase 7 (CLV diary):** wiring over an existing, well-designed table; validation rules already coded in `clv.ts`.
- **Phase 9 (Scanner):** simple server-component projection following existing `internal-api` + scorecards patterns.
- **Phase 10 (Journal):** standard append-only CRUD under existing OperatorGuard contour.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | **HIGH** | All versions verified against npm/GitHub/release notes AND the actual repo on 2026-10-19; brief-vs-repo corrections verified in source |
| Features | **MEDIUM** | Websearch was degraded in the research environment (DuckDuckGo HTML + 3 deep fetches, cross-checked multi-source); domain behaviors (DC, calibration, CLV, AH) corroborated by primary literature and official docs |
| Architecture | **HIGH** (integration) / MEDIUM (external practice) | Every integration point, schema fact, and file path verified directly against the codebase; external patterns from official docs + community consensus |
| Pitfalls | **HIGH** | Grounded in the shipped v1.0 schema/infra; runner/container claims cite first-party trackers (`actions/runner#904`, `testcontainers-node#1093`); DC/calibration principles from primary sources |

**Overall confidence:** **HIGH** for how to integrate and order the work; **MEDIUM** for some feature-behavior details (web-sourced). The codebase-verified findings are the load-bearing ones for the roadmap, and they are HIGH.

### Gaps to Address

- **Recharts discrepancy across research files:** STACK.md (verified against code) and ARCHITECTURE.md say Recharts is **absent**; PITFALLS.md (Pitfall 4) and the PROJECT.md stack constraint text mention Recharts 3.8 as present. Treat STACK.md's direct code verification as authoritative; confirm at Phase 4 planning (if Recharts unexpectedly exists, the fix strategy becomes dynamic-import-per-widget instead of "do not add").
- **Score-matrix persistence key design (Phase 8):** the recommended no-DDL approach (new optional key in snapshot `receipt` Json) must satisfy `parseForecastResponse`'s `exactKeys` validation for legacy rows — resolve in the Phase 8 research spike.
- **DC integration choice (Phase 5):** hybrid Elo-λ + τ vs full refit is a product decision, not a research fact — must be made in Phase 5 discuss/spec, recorded in `modelVersion` + methodology card.
- **Backups off-host target + RPO (Phase 2):** single Windows-host deployment specifics weren't fully resolvable from research — operator decision needed before Phase 2 planning.
- **Alerting channel + rate limits (Phase 3):** webhook vs SMTP free-tier limits need runtime verification.
- **Calibration policy constants (Phase 6):** min-cohort sizes, materiality thresholds, fit cadence — policy decisions to record in `configVersion`, not hardcode ad hoc.
- **E2E strategy in CI:** current live-stack E2E is Windows-only (`cmd.exe`); decide which Playwright subset is portable enough for the default CI job vs manually-triggered live smoke (must not burn free-tier budget).

## Sources

### Primary (HIGH confidence)
- Direct codebase verification at `D:\Documents\Atom\bet-stats` (2026-10-19): `package.json`/lockfile, `schema.prisma`, domain forecast/value/odds/evaluation packages, queues, settlement pipeline, workbench component, absence of `.github/` — all stack and integration claims.
- GitHub Actions first-party trackers: `actions/runner#904` (containers Linux-only), `testcontainers/testcontainers-node#1093` (windows-2025 failures).
- PostgreSQL official docs: `pg_dump` consistency, parallel-dump format constraints, major-version restore compatibility.
- Dixon & Coles (1997) JRSS-C 46(2):265–280 — τ four-cell correction, ρ bounds; cross-checked across 3 independent implementations (R `goalmodel`, arXiv 2307.02139).
- scikit-learn calibration docs + Niculescu-Mizil & Caruana (ICML'05) — isotonic small-sample overfitting, fit/eval separation.
- Next.js 16, NestJS 11, Prisma 7, React 19, Tailwind, Node 24, TypeScript 5.9, TanStack Query, Recharts, PostgreSQL 18, Redis 8, BullMQ official release notes/docs (STACK.md source list).

### Secondary (MEDIUM confidence)
- `@lhci/cli` / Lighthouse CI official docs + treosh action README (3-run median, assertMatrix, budget.json) — and community variance discussions.
- MetricGate calibration guide, ImpliedScore Dixon-Coles reference, BetTheDrop CLV guide — deep-fetched, corroborated by multiple independent snippets per topic.
- Asian-handicap settlement semantics, betting-journal conventions, value-scanner behavior — consistent multi-source snippets (no single deep source).
- Turborepo GitHub Actions CI guide; community backup/restore-drill patterns; BullMQ production monitoring (failed-set-as-DLQ).
- Google SLO multi-window burn-rate alerting docs (alerting design rationale).

### Tertiary (LOW confidence — validate during implementation)
- Absence of a maintained TypeScript Dixon-Coles/Asian-handicap library (search inconclusive) — implement in-house as planned; revisit only if implementation stalls.
- LHCI hosted storage free-tier status for OSS — assertions run locally in the runner regardless, so this does not gate the milestone.

---
*Research completed: 2026-10-19*
*Ready for roadmap: yes*
