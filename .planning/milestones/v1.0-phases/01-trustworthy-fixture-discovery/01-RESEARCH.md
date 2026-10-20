# Phase 1: Trustworthy Fixture Discovery - Research

**Researched:** 2026-08-27
**Domain:** TypeScript monorepo bootstrap, trustworthy football-data ingestion, canonical identity, access policy
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Prove the first production data path with the Premier League through football-data.org; additional competitions remain configuration-ready but are not required to work in this phase.
- **D-02:** The fixture dashboard groups fixtures by the user's local calendar date and provides explicit date and competition filters; default view covers today plus the next 48 hours.
- **D-03:** The fixture detail page is read-only in this phase and shows canonical teams, competition/season, kickoff, status, provider provenance, freshness, and data-quality state. Prediction and odds controls must not appear as placeholders.
- **D-04:** Betting-related analytics use a server-side explicit region allowlist and deny access by default when the region is unknown or not enabled. — **Reversibility:** costly — changing from deny-by-default later affects API authorization, caching, and every protected route contract.
- **D-05:** Require an 18+ acknowledgement before protected analytics are exposed; Phase 1 does not introduce accounts or persist betting-related behavioral history.
- **D-06:** Risk disclosure is persistent on forecast/value-capable shells, while fixture discovery remains available with neutral analytical language. Copy tests reject certainty, guaranteed-win/profit, and urgency phrasing.
- **D-07:** Geographic detection is advisory only; browser locale or IP inference cannot silently grant access. An explicit server-evaluated region code is authoritative.
- **D-08:** Canonical League, Season, Team, Player, and Fixture IDs are provider-independent; provider identifiers live only in external-reference records. — **Reversibility:** one-way — reversing this after data ingestion would require migrating every relation and could split historical identity.
- **D-09:** Exact `(provider, externalId)` references auto-resolve. Normalized name/country matches and fixture team-pair/kickoff matches generate candidates; they auto-resolve only when exactly one candidate passes conservative thresholds, otherwise they enter review.
- **D-10:** Fixture identity includes canonical league/season, canonical home/away teams, and a scheduled kickoff candidate window. The ±36-hour window is candidate generation, not a database uniqueness rule and not sufficient by itself to merge.
- **D-11:** A postponement updates the same canonical Fixture when an existing external reference proves continuity. Without that lineage, a changed kickoff is quarantined for review rather than automatically merged.
- **D-12:** Every automatic or manual match records method, evidence, confidence when applicable, actor/source, timestamp, and supersession/reversal history. Destructive merge history is not overwritten.
- **D-13:** Use explicit `AVAILABLE`, `LIMITED`, `STALE`, `UNSUPPORTED`, and `UNRESOLVED` states in domain/API contracts. Missing numeric or categorical data remains null/absent and is never converted to zero.
- **D-14:** Fixture surfaces show source and capture/update time alongside non-available states. `UNRESOLVED` identity blocks forecast entry points; `LIMITED` and `STALE` remain viewable with prominent explanation.
- **D-15:** Provider capabilities are recorded per provider, competition, season, and endpoint with verification time. Unknown capability is treated as unsupported for conditional endpoints until probed or configured.
- **D-16:** Freshness thresholds are configuration values by data type; the phase ships sensible defaults but does not hardcode product policy inside UI components.
- **D-17:** Provide a minimal internal review queue listing the incoming provider record, canonical candidates, normalized evidence, confidence, and raw provider references.
- **D-18:** Review actions are approve candidate, reject all/create canonical, and correct/link manually; every action appends an audit decision and supports a later superseding correction.
- **D-19:** Until full accounts and roles exist, the review API and UI are protected by a server-side operator credential, disabled when that credential is absent, excluded from public navigation, and never authorized by a client-only flag. — **Reversibility:** costly — later replacement with RBAC changes authentication middleware and audit actor identity but preserves review semantics.

### the agent's Discretion
- Exact component styling, spacing, and badge palette within accessible contrast requirements.
- Exact conservative fuzzy-match thresholds, provided ambiguous cases never auto-merge and thresholds are configurable/tested.
- Health endpoint response shape, structured error envelope, package boundaries, and implementation mechanics consistent with the locked stack.
- Seed fixture data and development-only provider stubs used to make the vertical slice runnable without secrets.

### Deferred Ideas (OUT OF SCOPE)
- Predictions, confidence calculation, manual odds, and value analysis — Phase 3.
- Historical form, Elo, provider budgeting execution, retries, and replay — Phase 2.
- API-Football fallback, Europa/Conference League coverage, lineups, injuries, and TheSportsDB-assisted enrichment — Phase 5.
- Full user accounts, RBAC, saved history, consent preferences, and personalization — v2 unless separately promoted.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| FOUND-01 | Install/build/lint/test/run one workspace | Walking-skeleton order, Turbo boundaries, validation commands |
| FOUND-02 | Start PostgreSQL/Redis and verify health | Compose health checks and API/worker readiness split |
| FOUND-03 | Validate configuration without leaks | Server-only typed config boundary and redaction tests |
| FOUND-04 | Persistent risk disclaimer on betting analytics | Shell-level content contract; no prediction UI in this phase |
| FOUND-05 | Enforce jurisdiction and age policy | Server-side policy object and guard; deny unknown |
| FOUND-06 | Reject prohibited claims | Repository content test over user-facing sources |
| DATA-01 | Browse/filter upcoming fixtures | football-data.org competition-match query and local-date UI grouping |
| DATA-02 | Inspect canonical fixture and provenance | Read model/API projection with source timestamps and data state |
| DATA-03 | Provider-independent canonical identity | External-reference schema and reconciliation transaction |
| DATA-04 | Reconcile fixture without duplicates | Candidate generation, exact-lineage precedence, review quarantine |
| DATA-05 | Auditable ambiguity review | Append-only decisions and supersession links |
| DATA-06 | Block forecast for unresolved identity | Domain eligibility policy, tested now although forecasts are deferred |
| DATA-07 | Explicit missing/stale/limited states | Closed data-state union; preserve null |
| DATA-08 | Record endpoint capability before conditional calls | Capability key and unknown→unsupported policy |
</phase_requirements>

## Summary

Phase 1 should be planned as a vertical trust slice, not as a broad platform bootstrap: scaffold only the packages needed to run web → API → PostgreSQL and a fixture-sync worker, then prove one Premier League ingestion path plus a secretless deterministic stub. The central artifact is a provider-independent fixture read model whose identity, provenance, freshness, and limitation state are explicit. [VERIFIED: .planning/phases/01-trustworthy-fixture-discovery/01-CONTEXT.md:7-43]

The draft Prisma schema is useful but cannot be copied unchanged. It currently says `provider = "prisma-client-js"` and places `url = env("DATABASE_URL")` in `schema.prisma`; Prisma 7 requires the `prisma-client` generator with explicit output, a driver adapter for direct PostgreSQL, and CLI datasource configuration in `prisma.config.ts`. [VERIFIED: schema.prisma:1-8] [CITED: https://docs.prisma.io/docs/guides/upgrade-prisma-orm/v7] [CITED: https://docs.prisma.io/docs/orm/v7/prisma-client/setup-and-configuration/generating-prisma-client]

**Primary recommendation:** Build identity and trust contracts first, ingest only validated normalized DTOs, and make ambiguity an explicit queued state rather than a guessed merge.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Local-date fixture browsing | Browser / Client | API / Backend | Browser owns timezone grouping; API owns UTC range/filter validation |
| Canonical identity and reconciliation | API / Backend | Database / Storage | Domain service decides; DB transaction/constraints preserve invariants |
| Provider validation/provenance | API / Backend / worker | Database / Storage | Boundary adapter parses untrusted JSON before persistence |
| Eligibility gate | API / Backend | Browser / Client | Server is authoritative; client only collects acknowledgement and displays denial |
| Review queue | API / Backend | Database / Storage | Operator commands are authenticated server-side and append audit decisions |
| Health/readiness | API / Backend / worker | Database / Redis | Each process reports its own dependencies; public response is redacted |

## Project Constraints (from AGENTS.md)

- Use pnpm workspaces/Turborepo, Next.js/React/TypeScript/Tailwind/TanStack Query, NestJS, PostgreSQL/Prisma, and Redis/BullMQ. [VERIFIED: AGENTS.md]
- Preserve free-tier/manual-odds scope, provider request accounting, canonical external references, immutable auditability, idempotent/retryable integration boundaries, leakage-safe model contracts, and responsible-gambling language. [VERIFIED: AGENTS.md]
- PostgreSQL is authoritative; Redis/BullMQ is disposable coordination infrastructure. [VERIFIED: AGENTS.md]
- Do not introduce automatic wagering, certainty claims, or client-only access enforcement. [VERIFIED: AGENTS.md]
- Run changes through GSD workflow entry points and do not directly implement outside them. [VERIFIED: AGENTS.md]

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js | 24.x LTS target | Runtime | Project baseline; local machine currently reports `v25.2.1`, so execution must include a version-manager/pinned-engine check. [VERIFIED: local `node --version`] |
| pnpm | 10.x pinned | Workspace manager | Locked stack; Corepack could not resolve pnpm in this environment because registry access was blocked. [VERIFIED: environment probe] |
| Turborepo | 2.x | Task graph | Root build/lint/test/dev fan-out; not runtime orchestration. [VERIFIED: AGENTS.md] |
| Next.js | 16.3.3 | Fixture UI | Current registry version verified 2026-08-27. [VERIFIED: npm registry] |
| NestJS | Use one compatible 11.x line, not registry-latest 12 | API and guards | Locked researched baseline is NestJS 11; registry latest `@nestjs/core` is `12.0.1`, so the planner must pin the supported line rather than use `latest`. [VERIFIED: npm registry] [VERIFIED: AGENTS.md] |
| Prisma ORM | 7.10.0 exact family | PostgreSQL schema/client | `@prisma/client` and `@prisma/adapter-pg` both resolve to `7.10.0`; registry `prisma` latest is an `8.0.0-rc.12`, so never install unqualified latest. [VERIFIED: npm registry] |
| PostgreSQL | 18.x image | Durable truth | Required for constraints, transactions, audit history. [VERIFIED: AGENTS.md] |
| Redis | 8.x image | Queue connectivity/health | Required walking-skeleton dependency; no phase-1 domain truth lives here. [VERIFIED: AGENTS.md] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Zod | 4.4.3 | Config, query, provider payload parsing | At every environment/request/provider boundary. [VERIFIED: npm registry] |
| Vitest | 4.1.11 | Unit/contract tests | Domain state, normalization, reconciliation, access policy, copy scan. [VERIFIED: npm registry] |
| `@playwright/test` | 1.62.1 | Browser acceptance | Fixture filters/detail, denied gate, operator route invisibility. [VERIFIED: npm registry] |
| Testcontainers | 12.1.0 | PostgreSQL/Redis integration | Constraints, transactional reconciliation, health checks. [VERIFIED: npm registry] |

**Installation:** Use a root pnpm catalog and exact versions; do not copy an unqualified `pnpm add ...@latest` command into the plan. [ASSUMED]

## Package Legitimacy Audit

The seam flags packages published very recently as suspicious even when the official framework docs identify them. Therefore the planner must insert a human verification checkpoint before the first install of each `[SUS]` package. [VERIFIED: package-legitimacy seam]

| Package | Registry | Downloads/week | Source Repo | Verdict | Disposition |
|---------|----------|----------------|-------------|---------|-------------|
| `prisma` | npm | 16,856,938 | github.com/prisma/prisma-cli | SUS (too-new signal) | Pin 7.10.0; human verify |
| `@prisma/client` | npm | 15,793,199 | github.com/prisma/prisma | SUS | Pin 7.10.0; human verify |
| `@prisma/adapter-pg` | npm | 5,171,021 | github.com/prisma/prisma | SUS | Pin 7.10.0; human verify |
| `pg` | npm | 48,887,859 | github.com/brianc/node-postgres | SUS | Pin compatible version; human verify |
| `zod` | npm | 273,858,187 | github.com/colinhacks/zod | OK | Approved |
| `next` | npm | 54,611,955 | github.com/vercel/next.js | SUS | Pin 16.3.3; human verify |
| `react`, `react-dom` | npm | 173M / 162M | github.com/react/react | OK | Approved |
| `@nestjs/core`, `@nestjs/config` | npm | 14M / 8M | github.com/nestjs | SUS | Pin compatible 11.x; human verify |
| `@nestjs/terminus` | npm | 2,894,414 | github.com/nestjs/terminus | OK | Approved |
| `vitest` | npm | 97,341,085 | github.com/vitest-dev/vitest | SUS | Pin 4.1.11; human verify |
| `@playwright/test` | npm | 57,407,694 | github.com/microsoft/playwright | SUS | Pin 1.62.1; human verify |
| `testcontainers` | npm | 6,089,024 | github.com/testcontainers/testcontainers-node | SUS | Pin 12.1.0; human verify |

**Packages removed due to [SLOP] verdict:** none.
**Packages flagged as suspicious [SUS]:** prisma family, pg, next, Nest config/core, Vitest, Playwright, Testcontainers.

## Architecture Patterns

### System Architecture Diagram

```text
football-data.org / deterministic stub
               |
               v
  fetch wrapper (timeout + redacted metadata)
               |
               v
  Zod strict provider schema --invalid--> quality event + no durable write
               |
               v
 normalized provider-independent DTO
               |
               v
 reconciliation transaction
   | exact external ref -> existing canonical
   | one strong candidate -> link + append decision
   ` ambiguous/none -> review queue (no guessed link)
               |
               v
 PostgreSQL canonical fixture + refs + provenance + capability
               |
               v
 NestJS read API ---- eligibility guard ---- protected analytics (future)
               |
               v
 Next.js fixture list/detail + explicit data-state presentation
```

### Recommended Project Structure

```text
apps/web/                    # App Router fixture and internal review surfaces
apps/api/                    # Nest composition root, fixtures, eligibility, review, health
workers/data-sync/           # fixture sync entry point and worker health
packages/database/           # Prisma 7 config/schema/generated client/migrations
packages/domain/             # closed domain unions and pure policies
packages/football-data/      # provider port, raw schemas, normalization, adapter/stub
packages/config/             # process-specific server config schemas and public projection
packages/ui/                 # shared accessible state badges/disclosure primitives
infra/docker-compose.yml     # PostgreSQL and Redis health-checked services
tests/e2e/                   # Playwright vertical acceptance
```

This preserves the intended top-level paths `apps/`, `workers/`, `packages/`, and `infra/`. [VERIFIED: MONOREPO_STRUCTURE.md:5-63]

### Pattern 1: Parse, Then Normalize

Provider JSON must remain `unknown` until a strict runtime schema succeeds; map provider statuses explicitly and reject unknown enum values into a quality event rather than casting. football-data.org documents statuses including `SCHEDULED`, `TIMED`, `IN_PLAY`, `PAUSED`, `FINISHED`, `SUSPENDED`, `POSTPONED`, `CANCELLED`, and `AWARDED`, while the draft local enum quotes only `SCHEDULED`, `LIVE`, `FINISHED`, `POSTPONED`, `CANCELLED`; a mapping table is therefore mandatory. [CITED: https://docs.football-data.org/general/v4/match.html] [VERIFIED: schema.prisma:10-16]

```ts
const parsed = footballDataMatchSchema.safeParse(raw);
if (!parsed.success) return { kind: 'rejected', issues: parsed.error.issues };
return normalizeFootballDataMatch(parsed.data);
```

[CITED: https://zod.dev/basics]

### Pattern 2: Reconciliation as a Transactional Decision

Use exact `(provider, externalId)` lookup first. Otherwise generate candidates, score them, and auto-link only when exactly one passes configurable thresholds and margin; append a decision record in the same transaction as the external reference. The ±36-hour window generates candidates and is not a uniqueness constraint. [VERIFIED: .planning/phases/01-trustworthy-fixture-discovery/01-CONTEXT.md:27-32]

The draft already quotes `@@unique([provider, externalId])` on external refs and `@@index([homeTeamId, awayTeamId, kickoff])` on fixtures; keep the former and do not turn the latter into a broad time-window uniqueness rule. [VERIFIED: schema.prisma:97-108,134-176]

### Pattern 3: Append-Only Review History

Model a reconciliation case separately from its decisions. A decision row contains action, candidate/canonical target, evidence JSON, confidence, actor type/identifier, createdAt, and optional `supersedesDecisionId`; correcting a decision appends a row and changes the case's current-decision pointer in one transaction. [ASSUMED]

### Pattern 4: Explicit Data-State Projection

The API union must quote exactly `AVAILABLE | LIMITED | STALE | UNSUPPORTED | UNRESOLVED`; pair it with `capturedAt`, `sourceUpdatedAt`, `provider`, and a human-readable reason code. Never use falsy coercion for nullable statistics. [VERIFIED: .planning/phases/01-trustworthy-fixture-discovery/01-CONTEXT.md:34-38]

### Pattern 5: Server-Authoritative Eligibility

Represent the guard input as server-evaluated region code plus an explicit 18+ acknowledgement. The policy returns allow/deny plus stable reason (`UNKNOWN_REGION`, `REGION_NOT_ALLOWED`, `AGE_NOT_ACKNOWLEDGED`); fixture discovery stays outside the protected route group. Do not cache protected responses without varying on the complete eligibility decision. [VERIFIED: .planning/phases/01-trustworthy-fixture-discovery/01-CONTEXT.md:21-25] [ASSUMED: reason-code names]

### Anti-Patterns to Avoid

- **Provider DTOs as domain types:** status drift and null semantics leak into persistence.
- **`upsert` as reconciliation:** it only handles known keys; it cannot decide cross-provider identity.
- **Fuzzy best-match always wins:** it silently corrupts history; require uniqueness and margin or review.
- **Time-window uniqueness:** postponements/cross-competition fixtures make a candidate window unsuitable as a DB uniqueness rule.
- **Client-only operator flag or region check:** secrets and authority belong on the server; Next.js public-prefixed variables are bundled into client JavaScript. [CITED: https://nextjs.org/docs/app/getting-started/server-and-client-components]
- **Health endpoint leaking config:** return dependency status and generic errors, not DSNs, tokens, or raw exception bodies.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Provider/config parsing | Type assertions and ad-hoc checks | Zod schemas | Structured rejection and typed output |
| PostgreSQL access | SQL string concatenation | Prisma 7 + adapter-pg | Migrations, parameterization, generated client |
| Dependency health | Bespoke ping controller | Nest Terminus indicators plus process-specific checks | Standard readiness composition |
| Browser orchestration | Sleep-based scripts | Playwright `webServer` and locators | Deterministic startup/waits [CITED: https://playwright.dev/docs/test-webserver] |
| Test monorepo wiring | Deprecated Vitest workspace file | Vitest `test.projects` | `workspace` is deprecated since 3.2. [CITED: https://main.vitest.dev/guide/projects] |
| Password hashing/session auth | Custom crypto | Not needed in Phase 1; constant-time operator-token comparison only | Accounts are deferred |

## Common Pitfalls

### Pitfall 1: Prisma 6-shaped Bootstrap
**What goes wrong:** client generation/import or migrations fail under Prisma 7.  
**How to avoid:** replace `prisma-client-js`, add explicit output, move datasource URL to `prisma.config.ts`, load env explicitly, instantiate with `PrismaPg`, and run seed explicitly. [CITED: https://docs.prisma.io/docs/guides/upgrade-prisma-orm/v7]

### Pitfall 2: UTC Query vs Local-Date Display
**What goes wrong:** fixtures near midnight appear under the wrong date or disappear.  
**How to avoid:** API accepts ISO instants/UTC range; browser derives the local-day boundaries and groups returned kickoff instants with a tested IANA timezone. football-data.org `dateFrom`/`dateTo` are `yyyy-MM-dd` and the API defaults date-sensitive data to UTC. [CITED: https://docs.football-data.org/general/v4/competition.html] [CITED: https://docs.football-data.org/general/v4/policies.html]

### Pitfall 3: Null Becomes Zero
**What goes wrong:** unknown data looks like evidence.  
**How to avoid:** preserve nullable values through raw schema, normalized DTO, database, OpenAPI, and UI; football-data.org explicitly treats null as valid for unknown/unavailable values. [CITED: https://docs.football-data.org/general/v4/policies.html]

### Pitfall 4: Audit Record After the Mutation
**What goes wrong:** a crash commits the link without its evidence.  
**How to avoid:** canonical/external-ref change, decision append, and case state update share one PostgreSQL transaction. [ASSUMED]

### Pitfall 5: Secretless Development Becomes Secret-Optional Production
**What goes wrong:** production silently uses stubs or enables operator routes without credentials.  
**How to avoid:** explicit environment mode; stub provider allowed only in development/test; startup fails closed for production-required secrets; operator module is disabled when credential absent. [VERIFIED: .planning/phases/01-trustworthy-fixture-discovery/01-CONTEXT.md:40-49]

## Code Examples

### Prisma 7 Generator and Client Shape

```prisma
generator client {
  provider = "prisma-client"
  output   = "../src/generated/prisma"
}

datasource db {
  provider = "postgresql"
}
```

```ts
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client';
const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });
export const prisma = new PrismaClient({ adapter });
```

[CITED: https://docs.prisma.io/docs/guides/upgrade-prisma-orm/v7]

### Provider Capability Key

Persist one record keyed by provider, canonical competition, season, and endpoint, with support state and `verifiedAt`. Unknown/no row evaluates to unsupported for conditional calls. [VERIFIED: .planning/phases/01-trustworthy-fixture-discovery/01-CONTEXT.md:34-38]

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| Prisma `prisma-client-js` generated in node_modules | Prisma 7 `prisma-client` with explicit output and driver adapter | Update draft before first migration [CITED: https://www.prisma.io/docs/orm/prisma-schema/overview/generators] |
| Vitest workspace config | `test.projects` | Use current monorepo configuration [CITED: https://main.vitest.dev/guide/projects] |
| Client-inferred access | Server policy/guard with deny-unknown | Locked project contract [VERIFIED: .planning/phases/01-trustworthy-fixture-discovery/01-CONTEXT.md:21-25] |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Root pnpm catalog should pin exact versions | Standard Stack | Low; alternative exact pinning remains possible |
| A2 | Proposed review-table field layout | Architecture Patterns | Medium; planner may choose equivalent normalized design |
| A3 | Eligibility reason-code names | Architecture Patterns | Low; semantics are locked, names are not |
| A4 | Audit mutation should be a single DB transaction | Pitfalls | High if implementation splits it; verify in integration tests |

## Resolved Implementation Questions

1. **Conservative identity threshold policy:** Per locked D-09, exact external reference wins first. Exact normalized name plus country may auto-link only when it yields exactly one candidate. Fuzzy similarity is suggestion-only and always enters review; no numeric fuzzy auto-merge threshold ships in Phase 1. Plan 03 verifies unique exact matches, ties, ambiguity, and fuzzy-only candidates.
2. **Production region allowlist:** Per locked D-04/D-05, sample/default configuration is empty and therefore denies protected analytics. A deployment must provide a validated non-empty `BETTING_ANALYTICS_ALLOWED_REGIONS` value, owned by the operator/legal decision, before an affirmative 18+ request can be allowed. Plan 05 verifies empty, invalid, missing, allowed, and disallowed matrices.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | all packages | ✓, wrong line | 25.2.1 | pin/use Node 24 LTS |
| pnpm | workspace | ✗ operationally | Corepack registry resolution failed | activate pinned Corepack version when network is available |
| Docker | PostgreSQL/Redis/Testcontainers | ✓ | 29.7.2 | — |
| PostgreSQL | integration/runtime | not probed running | — | Docker Compose |
| Redis | worker/queue health | not probed running | — | Docker Compose |
| football-data.org token | production sync | unknown | — | deterministic dev/test provider stub |

**Missing dependencies with no fallback:** a working pinned pnpm activation is required before execution.  
**Missing dependencies with fallback:** football-data.org token may be absent for local development; the stub must never activate in production.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.11 + Supertest + Playwright 1.62.1 + Testcontainers 12.1.0 |
| Config file | none — Wave 0 creates root `vitest.config.ts` with `test.projects` and `playwright.config.ts` |
| Quick run command | `pnpm test -- --run` (then narrow with project/file filters) |
| Full suite command | `pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration && pnpm test:e2e && pnpm build` |

Vitest supports project configurations for monorepos and V8 coverage; Playwright can start multiple web servers from configuration. [CITED: https://main.vitest.dev/guide/projects] [CITED: https://vitest.dev/guide/coverage.html] [CITED: https://playwright.dev/docs/test-webserver]

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| FOUND-01 | root task graph runs all packages | smoke | `pnpm build && pnpm lint && pnpm test` | ❌ Wave 0 |
| FOUND-02 | dependency/process health | integration | `pnpm test:integration -- health` | ❌ Wave 0 |
| FOUND-03 | config fail-fast/redaction | unit + process | `pnpm test -- config` | ❌ Wave 0 |
| FOUND-04/06 | disclosure present; prohibited claims absent | unit + content scan | `pnpm test -- responsible-copy` | ❌ Wave 0 |
| FOUND-05 | unknown region/age denied server-side | API integration | `pnpm test:integration -- eligibility` | ❌ Wave 0 |
| DATA-01/02/07 | fixture list/detail and states | API + E2E | `pnpm test:e2e -- fixture-discovery` | ❌ Wave 0 |
| DATA-03/04 | canonical refs and no duplicate fixture | DB integration | `pnpm test:integration -- reconciliation` | ❌ Wave 0 |
| DATA-05 | approve/reject/correct appends history | API + DB integration | `pnpm test:integration -- review` | ❌ Wave 0 |
| DATA-06 | unresolved blocks forecast eligibility | unit/API | `pnpm test -- forecast-eligibility` | ❌ Wave 0 |
| DATA-08 | unknown capability prevents conditional call | unit/integration | `pnpm test -- capability-policy` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** focused Vitest project/file, under 30 seconds.
- **Per wave merge:** all unit and affected Testcontainers integration tests.
- **Phase gate:** frozen install, lint, typecheck, all tests, production builds, Prisma validate/migrate-from-empty, and E2E green.

### Wave 0 Gaps
- [ ] Root package manager/engine pins, workspace, Turbo task graph, strict shared tsconfig.
- [ ] Vitest projects and test helpers for fixed clock/timezone.
- [ ] Testcontainers PostgreSQL/Redis fixture and migration-from-empty test.
- [ ] Supertest Nest application factory with deterministic config.
- [ ] Playwright multi-web-server config plus deterministic provider seed.
- [ ] Provider contract fixtures: valid payload, nullable fields, unknown status, malformed object.
- [ ] Content scanner covering source strings and rendered fixture/analytics shells.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | limited | constant-time server operator credential; full accounts deferred |
| V3 Session Management | limited | signed/minimal age acknowledgement; do not persist behavior history |
| V4 Access Control | yes | Nest guard on operator/protected analytics routes; deny unknown |
| V5 Input Validation | yes | Zod at HTTP/config/provider boundaries; server validation authoritative |
| V6 Cryptography | limited | platform crypto for credential comparison/signature; never hand-roll |
| V7 Error/Logging | yes | structured redacted errors and audit events |
| V13 Configuration | yes | fail-fast config, server-only secrets, no secret-bearing client projection |

OWASP ASVS 5.0.0 is the current stable standard and is intended as a basis for testing technical security controls. [CITED: https://owasp.org/www-project-application-security-verification-standard/]

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Forged operator header/token | Spoofing/Elevation | server guard, constant-time compare, generic denial, audit failures |
| Browser locale grants access | Elevation | advisory only; explicit server region is authoritative |
| Malformed provider payload | Tampering | parse unknown, strict schema, reject before persistence |
| Secret in client bundle/log | Information disclosure | `server-only`, no `NEXT_PUBLIC_` secrets, structured redaction |
| Concurrent duplicate reconciliation | Tampering | unique external-ref constraint + serializable/retry transaction |
| Audit correction overwrites history | Repudiation | append-only decisions with supersession |

Next.js documents that `NEXT_PUBLIC_` values are included in client bundles and recommends `server-only` to prevent environment poisoning. [CITED: https://nextjs.org/docs/app/getting-started/server-and-client-components]

## Sources

### Primary (HIGH confidence)
- https://docs.prisma.io/docs/guides/upgrade-prisma-orm/v7 — Prisma 7 migration, adapter, config and seeding.
- https://www.prisma.io/docs/orm/prisma-schema/overview/generators — generator/output contract.
- https://docs.football-data.org/general/v4/competition.html — competition match endpoint/filters.
- https://docs.football-data.org/general/v4/match.html — match payload/status values.
- https://docs.football-data.org/general/v4/policies.html — UTC defaults, null semantics, rate policy.
- https://nextjs.org/docs/app/getting-started/server-and-client-components — server/client boundary.
- https://main.vitest.dev/guide/projects — monorepo test projects.
- https://playwright.dev/docs/test-webserver — E2E process orchestration.
- https://owasp.org/www-project-application-security-verification-standard/ — ASVS 5 baseline.

### Secondary (MEDIUM confidence)
- npm registry metadata queried 2026-08-27 for package versions and repository signals.

### Tertiary (LOW confidence)
- Assumptions are isolated in the Assumptions Log.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — locked by project and current registry/docs checked; install checkpoint remains for seam-SUS packages.
- Architecture: HIGH — driven by locked context and source-of-truth schema reads.
- Pitfalls: HIGH — derived from explicit provider/Prisma docs and locked invariants; proposed table mechanics remain assumed.

**Research date:** 2026-08-27  
**Valid until:** 2026-09-03 for versions; 2026-09-26 for architecture.
