# Football Prediction & Value Betting Platform

## What This Is

A web application for football analytics that collects upcoming fixtures for the top five European leagues and selected UEFA competitions, estimates match-event probabilities, and compares those probabilities with user-entered bookmaker odds to identify potential value. It is intended for users who want transparent, evidence-based forecasts rather than guaranteed betting tips.

## Core Value

Produce honest, reproducible probability estimates whose quality can be measured after every completed match.

## Requirements

### Validated

- ✓ Shared Node/TypeScript workspace with healthy web, API, worker, PostgreSQL, and Redis foundations — Phase 1
- ✓ Canonical Premier League fixture discovery with provenance, freshness, honest data states, and auditable reconciliation — Phase 1
- ✓ Fail-closed eligibility policy and persistent responsible-gambling disclosure for protected analytics — Phase 1
- ✓ Replayable chronological football pipeline, weighted form, Elo, and atomic budget reservations — Phase 2
- ✓ Immutable Poisson + Elo prediction snapshots, manual decimal odds normalization, edge, and value receipts — Phase 3
- ✓ Settlement pipeline, Brier Score, Log Loss, calibration curves, ROI/Yield accounting, and rolling-origin backtests — Phase 4
- ✓ Multi-provider fallback (football-data.org / API-Football), UEL/UECL coverage, and provider-aware degradation — Phase 5
- ✓ Responsive desktop & mobile Chromium UI, public methodology card, secret-safe operations center, and fail-closed privacy retention — Phase 6

### Current State (Shipped: v1.0 MVP)

All 6 phases (88 plans) of the v1.0 MVP milestone have shipped and passed all end-to-end integration and verification gates. The platform is ready for production staging and live usage.

### Next Milestone Goals (v2.0)

- User accounts and explicit consent preferences for saving followed teams/analysis (ACCT-01, ACCT-02).
- Python/ML challenger model evaluation against the frozen V1 baseline (MODEL-01).
- Advanced overround normalization (Shin, power methods) and licensed closing-line feeds (MODEL-02, MODEL-03).
- Expanded markets (double-chance, team totals, player statistics) and additional leagues (MODEL-04, DATA-09).
- Responsible gambling user self-exclusion and activity limits (SAFE-01, SAFE-02).

### Out of Scope

- Automatic bet placement or bookmaker execution integration — the MVP is analytical only.
- Paid data, odds, or xG providers — the MVP must operate on free tiers and manual odds entry.
- Unofficial scraping as a hard production dependency — Understat is optional and offline/cached only; scraping outside source terms is prohibited.
- Python/ML prediction services — deferred until the TypeScript Poisson/Elo baseline is measured and validated.
- Self-exclusion and activity-limit workflows — important future responsible-gambling functionality, but not part of the first analytical release.
- Guaranteed-win language or betting recommendations presented as certainty — incompatible with the product's core value and legal/ethical constraints.

## Context

- The repository currently contains a detailed specification, target architecture, proposed pnpm/Turborepo layout, and a draft Prisma schema, but no application implementation.
- Production data roles are intentionally non-interchangeable: football-data.org is primary for top-five leagues plus UCL; API-Football is fallback there and primary for Europa League/Conference League; TheSportsDB is entity-resolution aid only.
- Injuries and odds cannot be assumed to exist on free tiers. API-Football coverage flags must be checked before calls; manual odds entry is the MVP default.
- FBref and StatsBomb are offline historical/training inputs only. Understat is an optional caution source and cannot block the live path.
- Europa League and Conference League have no provider fallback when API-Football is unavailable, so degraded coverage must be visible to users.
- The confidence score is separate from event probability and must retain its underlying components for later recalibration.
- Prediction snapshots are immutable so evaluation remains auditable and resistant to hindsight edits.

## Constraints

- **Stack**: pnpm workspaces and Turborepo; Next.js/React/TypeScript/Tailwind/TanStack Query/Recharts; NestJS; PostgreSQL/Prisma; Redis/BullMQ — establishes a shared TypeScript monorepo and the architecture already specified.
- **Data cost**: MVP uses only free tiers and manual odds — avoids paid-provider dependency before product value is validated.
- **API budget**: Track requests per provider, date, and endpoint type; API-Football must stay below its daily free-tier allowance — preserves critical fixture/result/lineup calls.
- **Data integrity**: Canonical entities plus provider external-reference tables, auditable matching, and immutable snapshots — prevents duplicate histories and retrospective prediction mutation.
- **Reliability**: Sync jobs must be idempotent, cached, retried with backoff, and protected by circuit breakers — external providers are rate-limited and may degrade.
- **Model integrity**: Backtests must prevent leakage and probability quality must be measured, not inferred from hit rate alone — forecasts need defensible evaluation.
- **Responsible gambling**: No automatic wagering, certainty claims, or hidden risk; region restrictions and persistent disclaimers are required — betting-related analytics carry legal and ethical obligations.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Build the MVP as a TypeScript monorepo with Next.js, NestJS, Prisma, Redis, and BullMQ | Keeps frontend, backend, workers, domain types, and prediction logic in one coherent toolchain | — Pending |
| Use Poisson + Elo + weighted form as the V1 model | Transparent, implementable, and measurable before introducing ML complexity | ✓ Validated in Phases 2–3 |
| Treat manual odds entry as the primary MVP path | Free provider tiers do not reliably include odds | ✓ Validated in Phase 3 |
| Separate canonical entities from provider IDs | Provider failover must not duplicate teams, players, leagues, or matches | — Pending |
| Keep historical/training sources outside the synchronous production pipeline | Their coverage and freshness do not support live match processing | — Pending |
| Store confidence components separately from probability and from the aggregate confidence score | Enables transparent UI explanations and later recalibration | ✓ Validated in Phase 3 |
| Structure delivery as vertical MVP slices | Each phase should leave an observable, testable capability rather than an unfinished technical layer | — Pending |
| Use append-only reconciliation decisions with optimistic concurrency | Manual identity corrections must remain auditable and must never overwrite prior evidence | ✓ Validated in Phase 1 |
| Reserve provider budget atomically before every external call | Retries and concurrent workers must not overspend free-tier allowance or duplicate durable facts | ✓ Validated in Phase 1 |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `$gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `$gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-09-08 after Phase 3*
