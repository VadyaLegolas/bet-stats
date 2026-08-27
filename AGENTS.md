<!-- GSD:project-start source:PROJECT.md -->

## Project

**Football Prediction & Value Betting Platform**

A web application for football analytics that collects upcoming fixtures for the top five European leagues and selected UEFA competitions, estimates match-event probabilities, and compares those probabilities with user-entered bookmaker odds to identify potential value. It is intended for users who want transparent, evidence-based forecasts rather than guaranteed betting tips.

**Core Value:** Produce honest, reproducible probability estimates whose quality can be measured after every completed match.

### Constraints

- **Stack**: pnpm workspaces and Turborepo; Next.js/React/TypeScript/Tailwind/TanStack Query/Recharts; NestJS; PostgreSQL/Prisma; Redis/BullMQ — establishes a shared TypeScript monorepo and the architecture already specified.
- **Data cost**: MVP uses only free tiers and manual odds — avoids paid-provider dependency before product value is validated.
- **API budget**: Track requests per provider, date, and endpoint type; API-Football must stay below its daily free-tier allowance — preserves critical fixture/result/lineup calls.
- **Data integrity**: Canonical entities plus provider external-reference tables, auditable matching, and immutable snapshots — prevents duplicate histories and retrospective prediction mutation.
- **Reliability**: Sync jobs must be idempotent, cached, retried with backoff, and protected by circuit breakers — external providers are rate-limited and may degrade.
- **Model integrity**: Backtests must prevent leakage and probability quality must be measured, not inferred from hit rate alone — forecasts need defensible evaluation.
- **Responsible gambling**: No automatic wagering, certainty claims, or hidden risk; region restrictions and persistent disclaimers are required — betting-related analytics carry legal and ethical obligations.

<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->

## Technology Stack

## Recommendation in One Sentence

## Recommended Stack

### Core Technologies

| Technology | Version to Start With | Purpose | Why Recommended |
|------------|-----------------------|---------|-----------------|
| Node.js | 24 LTS, latest 24.x security patch | Runtime for web, API, worker, scripts | One runtime across the monorepo; Node 24 is the production LTS line and is supported through April 2028. It satisfies Next.js 16, NestJS 11, and Prisma 7 requirements. **Confidence: HIGH.** |
| TypeScript | 5.9.x | Shared language and type system | Matches Prisma 7's recommended compiler generation and keeps provider DTOs, prediction inputs, snapshot outputs, and API contracts in one type system. Enable `strict`, `noUncheckedIndexedAccess`, and ESM. **Confidence: HIGH.** |
| pnpm | 10.x | Package manager and workspace protocol | Efficient monorepo installs, strict dependency boundaries, workspace protocol, and first-class Turborepo support. Pin via Corepack/package manager metadata. **Confidence: MEDIUM.** |
| Turborepo | 2.x | Monorepo task graph and caching | Appropriate for the proposed `apps/`, `workers/`, and `packages/` split; use it for build/test/lint/typecheck orchestration, not application runtime orchestration. **Confidence: HIGH.** |
| Next.js | 16.2.x Active LTS initially; upgrade within 16.x after verification | Web application, App Router, server rendering | The project needs fixture lists, analytical match pages, responsive charts, and forms rather than a client-only SPA. Next.js 16 uses React 19.2 and Turbopack and has a formal LTS/security channel. Start on the patched Active LTS line rather than a canary. **Confidence: HIGH.** |
| React / React DOM | 19.2.x, exact pair | Component UI | Current stable React line and the native pairing for Next.js 16. Pin `react`, `react-dom`, and `react-is` to matching versions because Recharts requires a compatible `react-is`. **Confidence: HIGH.** |
| Tailwind CSS | 4.1.x | Styling and responsive layout | Zero-runtime styling, fast build path, and suitable for dense analytical dashboards. Use `@tailwindcss/postcss` with Next.js and CSS-first configuration. **Confidence: HIGH.** |
| NestJS | 11.1.x | REST API and composition root | Clear modules for fixtures, providers, predictions, value bets, and backtesting; mature dependency injection and testing support. NestJS 11 requires Node 20+, so Node 24 is safe. Prefer the default Express 5 adapter unless measured throughput justifies Fastify. **Confidence: HIGH.** |
| PostgreSQL | 18.6 or latest 18.x minor | Durable relational source of truth | The domain is relational and audit-heavy: canonical entities, provider refs, immutable snapshots, odds observations, and evaluation results need constraints and transactions. PostgreSQL 18 is current and supported through 2030. **Confidence: HIGH.** |
| Prisma ORM | 7.9.x LTS line | Schema, migrations, typed queries | Fits the existing schema-first constraint and shared TypeScript toolchain. Prisma 7 is preferable to introducing a second ORM, but requires an immediate schema modernization described below. **Confidence: MEDIUM-HIGH.** |
| Redis Open Source | 8.x; use a current supported image | Cache, distributed coordination, BullMQ backing store | Appropriate for provider coverage caches, short-lived fixture/lineup caches, idempotency coordination, and queues. It must not become the source of truth for predictions or budgets. **Confidence: HIGH.** |
| BullMQ | 6.x, latest stable patch | Scheduled ingestion, retries, delayed lineup checks, result resolution | Gives durable jobs, backoff, concurrency, rate limiting, deduplication, and worker separation without adding another language or broker. Its current client adapter model also avoids hard-coupling application code to one Redis client. **Confidence: MEDIUM-HIGH.** |

### Domain and Application Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@tanstack/react-query` | 5.x | Client-side server-state cache | Use for interactive filters, manual odds mutations, refetching fixture detail, and dashboard polling. Do not mirror every Server Component fetch into it. **Confidence: HIGH.** |
| Recharts | 3.8.x stable | Calibration, ROI/yield, probability and form charts | Use for ordinary analytical charts. Add `react-is` matching React 19.2 exactly. Avoid canary releases. **Confidence: HIGH.** |
| Zod | 4.x | Runtime validation and inferred types | Validate environment variables, provider responses, query parameters, and manual odds. Provider JSON is untrusted even when TypeScript types exist. **Confidence: HIGH.** |
| `date-fns` | 4.x | UTC/date arithmetic and formatting | Use for kickoff windows, rest days, freshness decay, and display. Store instants as UTC; require an explicit IANA zone at presentation boundaries. **Confidence: MEDIUM-HIGH.** |
| `decimal.js` | 10.x | Exact decimal calculations | Use at odds input, EV, overround, bankroll/unit accounting, and persisted decimal boundaries. Plain `number` remains suitable for model probabilities with tolerance-based tests. **Confidence: MEDIUM-HIGH.** |
| `fastest-levenshtein` plus project normalization rules | 1.x | Entity matching candidate score | Use only after exact external-ref lookup and normalized-name/country matching. It should produce candidates for a thresholded, audited resolver, never silently decide ambiguous identity. **Confidence: MEDIUM.** |
| Node built-in `fetch` / Undici | Node 24 bundled; `undici` 7.x only when direct APIs are needed | Provider HTTP calls | Prefer the platform fetch API and small project wrappers with timeouts, validation, request-budget accounting, and observability. Do not add Axios by default. **Confidence: HIGH.** |
| Cockatiel | 3.x | Circuit breaker and policy composition | Use around external provider calls after budget and coverage checks. BullMQ retry/backoff handles job retries; Cockatiel handles provider resilience. Keep these responsibilities separate. **Confidence: MEDIUM.** |
| Pino | current stable major | Structured JSON logging | Use a shared logger package with request/job/provider correlation IDs. Pretty printing is development-only. **Confidence: HIGH.** |
| `@nestjs/swagger` | compatible 11.x line | OpenAPI generation | Generate the REST contract and use it as a review artifact. Domain packages must not import Swagger decorators. **Confidence: HIGH.** |
| `@nestjs/terminus` | compatible 11.x line | Health/readiness checks | Check PostgreSQL, Redis, and worker connectivity; provider outages should degrade readiness only when the provider is required for that competition. **Confidence: HIGH.** |
| OpenTelemetry JS API/SDK | 2.x-compatible current releases | Traces and metrics | Instrument HTTP, Prisma/pg, and jobs once background workflows exist. Start with local/exportable telemetry; do not buy an observability platform for MVP. **Confidence: MEDIUM-HIGH.** |

### Prediction and Backtesting Stack

- The formulas are small, transparent, and must be versioned and auditable.
- Immutable snapshots need exact knowledge of which code/config produced them.
- A large numerical package does not solve leakage, calibration, or data-quality errors.
- Pure functions are easy to property-test and replay over historical fixtures.

### Development and Quality Tools

| Tool | Version/Line | Purpose | Notes |
|------|--------------|---------|-------|
| Vitest | current stable major | Unit, property-style, and package tests | One fast runner across domain packages, provider adapters, web utilities, and most Nest services. Pin the version in the root catalog. |
| Supertest | current stable major | NestJS HTTP integration tests | Test real routing, validation, error mapping, and serialization against the Nest application. |
| Playwright | current stable major | Browser E2E and accessibility flows | Cover manual odds entry, value candidate rendering, limited-data states, and responsible-gambling copy. |
| Testcontainers for Node.js | current stable major | PostgreSQL/Redis integration tests | Use real services for migrations, constraints, idempotent job behavior, and queue semantics. Do not rely on SQLite as a PostgreSQL test substitute. |
| ESLint | 10.x compatible config | Static analysis | Next.js 16 removed `next lint`; run ESLint directly from Turbo. Keep type-aware rules focused to avoid slow global linting. |
| Prettier | 3.x | Formatting | Apply consistently; do not mix formatters initially. |
| Docker Compose | Compose Specification | Local PostgreSQL/Redis | Pin service major/minor images, configure health checks and named volumes, and keep secrets out of the file. |
| GitHub Actions or existing CI | hosted current versions | CI | Run install with frozen lockfile, schema validation, typecheck, unit tests, integration tests, build, then a small Playwright suite. |

## Required Prisma 7 Modernization

## Installation Shape

# Root tooling

# Web

# API

# Database

# Worker / queues

# Domain packages

# Integration and E2E testing

## Alternatives Considered

| Recommended | Alternative | When the Alternative Is Better |
|-------------|-------------|--------------------------------|
| NestJS REST API | Next.js Route Handlers only | A tiny read-only prototype with no independent worker orchestration or provider modules. This project already exceeds that threshold. |
| NestJS default Express 5 adapter | NestJS Fastify adapter | Only after profiling shows API transport overhead matters; external APIs and database work will dominate MVP latency. |
| Prisma 7 | Drizzle ORM | Choose Drizzle only if the project deliberately rejects the supplied Prisma schema and prioritizes SQL-near control over Prisma's migration/client workflow. Do not run two ORMs. |
| PostgreSQL 18 | PostgreSQL 17 | Use 17 if the selected managed host or deployment environment has not certified 18; both remain supported. |
| Redis + BullMQ | PostgreSQL-only job queue | Viable if operations simplicity is more important than delayed/repeatable job ergonomics and queue rate limiting. It would require revising the supplied architecture. |
| Recharts | Apache ECharts | Choose ECharts if the product later needs very large datasets, dense interactive heatmaps, or richer canvas rendering. Recharts is simpler for MVP calibration/ROI charts. |
| Vitest | Jest | Use Jest only if a required NestJS plugin or existing organizational standard cannot run under Vitest. A greenfield monorepo benefits from one fast ESM-friendly runner. |
| Cockatiel | Hand-written circuit breaker | A hand-written breaker is justified only if the policy is tiny and heavily domain-specific; otherwise tested state-transition logic is safer. |
| TypeScript model V1 | Python/FastAPI model service | Introduce when validated experiments require mature statistical/ML tooling and the operational cost is justified by demonstrated lift. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| Node.js Current/odd release or EOL Node 20 | Production support and ecosystem compatibility are weaker; Node 20 reached EOL in 2026. | Node.js 24 LTS. |
| Next.js canary or React canary | Unnecessary churn for a data dashboard and mismatched peer dependencies. | Patched Next.js Active LTS + stable React 19.2 pair. |
| Prisma 8 immediately | Prisma 8 is the newest release line, while Prisma 7 is explicitly maintained as LTS and matches a safer greenfield adoption path; adopting 8 adds avoidable migration uncertainty to an already draft schema. | Prisma 7 LTS, then reassess after V1. |
| Existing Prisma 6 generator/config unchanged | It conflicts with Prisma 7's ESM client, explicit output, configuration, and required driver adapter. | Modernize during bootstrap. |
| SQLite for tests or production | It does not reproduce PostgreSQL constraints, date/time behavior, indexes, transactions, or Prisma PostgreSQL adapter behavior. | PostgreSQL Testcontainers and PostgreSQL in production. |
| Redis as prediction/history storage | Cache eviction and queue semantics conflict with immutable, auditable history. | PostgreSQL as source of truth; Redis as disposable derived infrastructure. |
| `bull` package | Older generation and separate typings; project requirements align with BullMQ. | `bullmq`. |
| Axios by default | Node 24 already provides Fetch/Undici; another HTTP stack adds error and retry semantics without solving validation/budgeting. | Built-in `fetch` plus a provider client wrapper. |
| Moment.js | Large legacy mutable date API. | `date-fns` and explicit UTC/IANA-zone rules. |
| A generic JS ML framework for Poisson/Elo | Obscures simple formulas, increases bundle/runtime surface, and does not enforce leakage-safe evaluation. | Pure TypeScript domain functions with deterministic tests. |
| Automatic bookmaker execution libraries | Explicitly outside MVP and materially changes legal/security scope. | Manual decimal odds input and analytics only. |
| Understat scraper as a live dependency | Unofficial interface can break or be blocked and cannot uphold the live SLA. | Optional offline cached import behind a disabled-by-default flag. |
| GraphQL in V1 | Adds schema/client/caching complexity without a demonstrated need; specified endpoints are straightforward REST resources. | NestJS REST + OpenAPI. |

## Stack Patterns by Variant

- Run `apps/api`, `apps/web`, and one `workers/data-sync` process, with one PostgreSQL instance and one Redis instance.
- Keep prediction packages in-process and version their configuration with every snapshot.
- Use Docker Compose locally; choose a managed PostgreSQL service first in production, then managed Redis if operationally justified.
- Use the same provider adapters and BullMQ jobs with cached coverage/budget state.
- Do not introduce an alternate scraping stack. Persist provider health and surface limited-data state.
- Add a Python service only for training/inference that cannot be reasonably implemented in TypeScript.
- Preserve the TypeScript baseline, snapshot schema, evaluation metrics, and versioned contract so models remain comparable.
- Scale BullMQ workers by queue and concurrency, keep jobs idempotent, and use deterministic job IDs.
- Split ingestion, prediction, and backtesting operationally before splitting the domain packages into network services.

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| Node.js 24 LTS | Next.js 16, NestJS 11, Prisma 7 | One production runtime; avoid Node 26 Current until it becomes LTS and all packages certify it. |
| Next.js 16.2.x | React/React DOM 19.2.x | Pin the React pair together; App Router may internally consume framework-managed React behavior. |
| Recharts 3.8.x | React 19.2.x + matching `react-is` | Explicitly install `react-is` at the same React line. |
| Prisma 7.x | TypeScript 5.9, Node 24, `@prisma/adapter-pg` 7.x, `pg` | Prisma 7 requires ESM and a driver adapter for direct PostgreSQL. Keep Prisma CLI/client/adapter on the same minor where possible. |
| NestJS 11.x | Node 20+; Express 5 default | Node 24 is supported. Be careful with Express 5 wildcard route syntax. |
| BullMQ 6.x | Redis client adapter; Redis 8 deployment | Worker and QueueEvents require duplicated/blocking connections; plan Redis connection counts explicitly. |
| Tailwind 4.x | Modern browsers | Requires Chrome/Edge 111+, Safari 16.4+, and Firefox 128+ for the documented baseline; use Tailwind 3.4 only if older browser support is mandatory. |
| TanStack Query 5.x | React 18+ | Use the v5 object API. For App Router, distinguish server-fetched initial data from client-owned interactive state. |

## Roadmap Implications

## Sources

- [Node.js release schedule](https://nodejs.org/en/about/previous-releases) — Node 24 LTS status and production LTS policy. **HIGH confidence.**
- [Node.js 22 to 24 migration](https://nodejs.org/en/blog/migrations/v22-to-v24) — Node 24 support through April 2028. **HIGH confidence.**
- [TypeScript 5.9 release notes](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-9.html) — current compiler line and ESM/module improvements. **HIGH confidence.**
- [Next.js 16 release](https://nextjs.org/blog/next-16) — React 19.2, Turbopack, runtime requirements, and breaking changes. **HIGH confidence.**
- [Next.js security/LTS announcements](https://nextjs.org/blog) — Active LTS patch guidance. **HIGH confidence; patch-sensitive.**
- [React versions](https://react.dev/versions) — React 19.2 stable line and releases. **HIGH confidence.**
- [Tailwind CSS v4](https://tailwindcss.com/blog/tailwindcss-v4) and [compatibility](https://tailwindcss.com/docs/compatibility) — v4 installation and browser floor. **HIGH confidence.**
- [NestJS 11 migration guide](https://docs.nestjs.com/migration-guide) — Node requirement and Express 5 default. **HIGH confidence.**
- [Prisma 7 overview](https://www.prisma.io/docs/orm/v7) and [Prisma v7 upgrade guide](https://www.prisma.io/docs/orm/v6/more/upgrades/to-v7) — ESM, driver adapter, generator, and Node/TypeScript requirements. **HIGH confidence.**
- [Prisma supported databases](https://docs.prisma.io/docs/orm/v7/reference/supported-databases) — PostgreSQL support. **HIGH confidence.**
- [PostgreSQL versioning policy](https://www.postgresql.org/support/versioning/) — PostgreSQL 18.6 and support window. **HIGH confidence.**
- [Redis 8 release documentation](https://redis.io/docs/latest/develop/whats-new/8-0/) and [Redis current updates](https://redis.io/docs/latest/develop/whats-new/) — current Redis 8 line. **HIGH confidence.**
- [BullMQ repository/releases](https://github.com/taskforcesh/bullmq) and [connection guide](https://docs.bullmq.io/guide/connections) — current major and Redis client adapter behavior. **MEDIUM-HIGH confidence.**
- [TanStack Query v5 docs](https://tanstack.com/query/latest/docs/framework/react) — current stable major. **HIGH confidence.**
- [Recharts repository/releases](https://github.com/recharts/recharts) — stable 3.x release and React peer guidance. **MEDIUM-HIGH confidence.**

<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->

## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->

## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->

## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->

## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:

- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->

## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
