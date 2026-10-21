# Walking Skeleton — Football Prediction & Value Betting Platform

**Phase:** 1  
**Generated:** 2026-08-27

## Capability Proven End-to-End

An eligible public user can browse a Premier League fixture from a Next.js page served by a NestJS API whose canonical data is written/read in PostgreSQL by an idempotent provider-normalization worker, while Redis supplies disposable queue coordination and health is observable without exposing secrets.

## Architectural Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Framework | Next.js 16 App Router + React 19.2; NestJS 11 REST API; strict ESM TypeScript | Matches the locked shared TypeScript stack and keeps public UI, API policy, and background jobs independently runnable. |
| Data layer | PostgreSQL 18 + Prisma 7 with `@prisma/adapter-pg` | Canonical identities, provenance, immutable audit decisions, and later snapshots need relational constraints and transactions. |
| Queue/cache | Redis 8 + BullMQ 6 | Provides disposable job coordination and deterministic job IDs without becoming authoritative storage. |
| Access policy | Public neutral fixtures; server-authoritative explicit-region allowlist + 18+ acknowledgement for future analytics; temporary server-only operator credential for review | Implements deny-by-default responsible access without introducing accounts or client-only authorization. |
| Provider boundary | Narrow football-data.org Premier League fixture/capability adapter plus deterministic development/test adapter | Proves one verified production path, parses unknown JSON before normalization, and preserves later provider fallback behind the port. |
| Local deployment target | Docker Compose PostgreSQL/Redis plus root Turbo commands for web, API, and worker | Gives a reproducible full-stack development environment without selecting a production host prematurely. |
| Directory layout | `apps/web`, `apps/api`, `workers/data-sync`, `packages/{config,database,domain,football-data}` | Preserves dependency direction: UI/controllers consume provider-independent domain contracts; database/provider details stay behind packages. |

## Stack Touched in Phase 1

- [ ] Project scaffold: pinned pnpm workspace, Turbo graph, lint, typecheck, Vitest, Playwright
- [ ] Routing: fixture list/detail plus protected internal reconciliation route
- [ ] Database: canonical fixture/external-reference/audit migration, one real idempotent write and fixture read
- [ ] UI: URL-backed fixture filters and review actions wired to API contracts
- [ ] Local deployment: `docker compose up -d` followed by the documented root dev/test commands

## Out of Scope (Deferred to Later Slices)

- Historical results, standings, form, Elo, request-priority allocation, broad retry/replay operations, and richer budget reporting — Phase 2. Phase 1 owns the atomic persisted pre-call reservation invariant keyed by provider, UTC date, endpoint type, and deterministic job key.
- Forecasts, confidence, manual odds, value candidates, and immutable prediction/odds snapshots — Phase 3
- Settlement, calibration, Brier/Log Loss, ROI/Yield, and chronological backtests — Phase 4
- API-Football fallback, Europa/Conference League, lineups, injuries, odds enrichment, and TheSportsDB suggestions — Phase 5
- Full accounts, RBAC, saved betting history, consent preferences, and personalization — outside current MVP unless promoted
- Automatic wagering or bookmaker execution — prohibited

## Subsequent Slice Plan

### Phase 1 execution waves

- Waves 1–3: minimum prerequisite root, process, configuration, and test scaffolding.
- Wave 4: first production-quality browser → Next.js → NestJS → fixture-port tracer.
- Waves 5–7: canonical identity, data state, eligibility, capability/budget, and guarded provider ingestion.
- Wave 8: fixture discovery and protected reconciliation review proceed in parallel with disjoint files.
- Wave 9: held-out ASVS L1, UI, Nyquist, and multi-source closure.

- Phase 2: Produce replayable chronological football evidence and leakage-safe features on the same canonical identities.
- Phase 3: Freeze transparent forecasts, accept manual odds, and calculate reproducible value/abstention outcomes.
- Phase 4: Settle exact frozen receipts and expose calibrated quality/performance evidence.
- Phase 5: Add provider-aware breadth and pre-match enrichment without changing canonical identity.
- Phase 6: Harden the complete experience for release, observability, privacy, accessibility, and operations.
