# Phase 1: Trustworthy Fixture Discovery - Pattern Map

**Mapped:** 2026-08-27
**Files analyzed:** 34 new/modified files or cohesive file families
**Executable-code analogs found:** 0 / 34
**Usable draft/contract sources:** 4 (`schema.prisma`, `ARCHITECTURE.md`, `01-RESEARCH.md`, `01-UI-SPEC.md`)

> This repository is greenfield. It contains no existing TypeScript, React, NestJS, test, package, or infrastructure implementation to copy. The assignments below deliberately distinguish a **draft schema source** (partly reusable), a **contract source** (must be translated), and a real code analog (none exists). The duplicated `football-prediction-spec/{en,ru}` files are translations/copies of the same drafts and are not independent analogs.

## File Classification

| New/Modified File | Role | Data Flow | Closest Existing Source | Match Quality |
|---|---|---|---|---|
| `package.json` | config | batch/task graph | `MONOREPO_STRUCTURE.md` recommended scripts | contract-only |
| `pnpm-workspace.yaml` | config | batch/task graph | `MONOREPO_STRUCTURE.md` tree | contract-only |
| `turbo.json` | config | batch/task graph | `01-RESEARCH.md` validation architecture | contract-only |
| `tsconfig.base.json` | config | transform/build | `AGENTS.md` stack constraints | contract-only |
| `vitest.config.ts` | config | batch/test | `01-RESEARCH.md` Wave 0 gaps | contract-only |
| `playwright.config.ts` | config | request-response/E2E | `01-RESEARCH.md` validation architecture | contract-only |
| `.env.example` | config | request-response | `MONOREPO_STRUCTURE.md` environment list + Phase 1 decisions | partial draft |
| `infra/docker-compose.yml` | config | event-driven/health | `ARCHITECTURE.md` §§5–6 | contract-only |
| `packages/config/src/{api,web,worker}.ts` | config | transform | `01-RESEARCH.md` server-only configuration guidance | contract-only |
| `packages/database/prisma/schema.prisma` | model | CRUD/audit | root `schema.prisma` | draft-match; modernization required |
| `packages/database/prisma.config.ts` | config | CRUD/migration | `01-RESEARCH.md` lines 267–280 | reference-example |
| `packages/database/src/client.ts` | provider | CRUD | `01-RESEARCH.md` lines 277–280 | reference-example |
| `packages/database/prisma/seed.ts` | utility | batch/CRUD | no executable analog | none |
| `packages/domain/src/data-state.ts` | model | transform | `01-UI-SPEC.md` line 140 + context D-13–D-16 | contract-only |
| `packages/domain/src/eligibility.ts` | service/policy | request-response | `01-RESEARCH.md` lines 215–218 | contract-only |
| `packages/domain/src/reconciliation.ts` | service/policy | CRUD/transform | `ARCHITECTURE.md` lines 175–179 | contract-only |
| `packages/domain/src/forecast-eligibility.ts` | service/policy | transform | context D-14 and DATA-06 | contract-only |
| `packages/football-data/src/provider.interface.ts` | provider/port | request-response | `ARCHITECTURE.md` lines 73–81 | exact contract, not implementation |
| `packages/football-data/src/providers/football-data-org/schema.ts` | model/validation | transform | `01-RESEARCH.md` lines 194–196 | reference-example |
| `packages/football-data/src/providers/football-data-org/normalize.ts` | utility | transform | `01-RESEARCH.md` lines 194–196 | reference-example |
| `packages/football-data/src/providers/football-data-org/client.ts` | service/adapter | request-response | `ARCHITECTURE.md` provider port | role-contract |
| `packages/football-data/src/providers/stub/provider.ts` | service/adapter | request-response | no executable analog | none |
| `workers/data-sync/src/jobs/fixtures.ts` | service/job | event-driven/CRUD | `ARCHITECTURE.md` morning sync + lines 175–179 | contract-only |
| `apps/api/src/modules/fixtures/*` | controller/service | request-response/CRUD | `ARCHITECTURE.md` API boundary | role-contract |
| `apps/api/src/modules/reconciliation/*` | controller/service/guard | request-response/CRUD/audit | context D-17–D-19 + research Pattern 3 | contract-only |
| `apps/api/src/modules/eligibility/*` | controller/service/guard | request-response | research Pattern 5 | contract-only |
| `apps/api/src/modules/health/*` | controller/service | request-response | research responsibility map | contract-only |
| `apps/web/app/fixtures/page.tsx` | component/route | request-response | `01-UI-SPEC.md` Fixture Dashboard | UI contract-only |
| `apps/web/app/fixtures/[fixtureId]/page.tsx` | component/route | request-response | `01-UI-SPEC.md` Fixture Detail | UI contract-only |
| `apps/web/app/internal/reconciliation/page.tsx` | component/route | request-response/CRUD | `01-UI-SPEC.md` Protected Review Queue | UI contract-only |
| `apps/web/components/data-state-notice.tsx` | component | transform | `01-UI-SPEC.md` lines 140–147 | component contract-only |
| `apps/web/components/eligibility-gate.tsx` | component | request-response | `01-UI-SPEC.md` Eligibility Gate | component contract-only |
| `tests/integration/{health,eligibility,reconciliation}.test.ts` | test | request-response/CRUD | `01-RESEARCH.md` requirement-to-test map | test contract-only |
| `tests/e2e/{fixture-discovery,reconciliation-review}.spec.ts` | test | request-response/E2E | `01-UI-SPEC.md` Testable Acceptance Contract | test contract-only |

## Pattern Assignments

### `packages/database/prisma/schema.prisma` (model, CRUD/audit)

**Draft source:** `schema.prisma`. This is the only source artifact close to implementation, but it is explicitly a Prisma 6-shaped draft. Preserve its canonical identity relations and external-reference uniqueness; do not copy its generator/datasource header unchanged.

**Generator modernization source** (`01-RESEARCH.md`, lines 267–280):

```prisma
generator client {
  provider = "prisma-client"
  output   = "../src/generated/prisma"
}

datasource db {
  provider = "postgresql"
}
```

**Canonical external-reference pattern** (`schema.prisma`, lines 97–108; same constraint also appears at lines 64–71 and 167–176):

```prisma
model TeamExternalRef {
  id         String   @id @default(cuid())
  teamId     String
  provider   String
  externalId String
  rawName    String
  matchedBy  String
  matchedAt  DateTime @default(now())
  team       Team     @relation(fields: [teamId], references: [id])

  @@unique([provider, externalId])
}
```

**Fixture candidate lookup index** (`schema.prisma`, lines 134–164):

```prisma
model Fixture {
  id         String   @id @default(cuid())
  leagueId   String
  seasonId   String
  homeTeamId String
  awayTeamId String
  kickoff    DateTime
  // relations omitted
  @@index([kickoff])
  @@index([homeTeamId, awayTeamId, kickoff])
}
```

Keep this as an index, not a uniqueness rule. Add Phase 1 models absent from the draft: provider capability, reconciliation case/candidates, append-only decisions with supersession, provenance/freshness fields, and a current-decision/version mechanism for conflict detection. Do not implement deferred prediction, odds, lineup, injury, Elo, or backtest tables merely because they appear in the draft.

---

### `packages/database/src/client.ts` and `packages/database/prisma.config.ts` (provider/config, CRUD)

**Reference source:** `01-RESEARCH.md`, lines 277–280.

```ts
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client';

const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });
export const prisma = new PrismaClient({ adapter });
```

The database package should own the generated client and adapter. Other packages import the database package, not generated Prisma internals. Configuration must be parsed before client construction and secrets must never be projected to browser code or health responses.

---

### `packages/football-data/src/provider.interface.ts` (provider port, request-response)

**Contract source:** `ARCHITECTURE.md`, lines 73–81.

```ts
interface FootballDataProvider {
  getUpcomingFixtures(): Promise<FixtureDto[]>;
  getTeamRecentMatches(teamId: string): Promise<FixtureDto[]>;
  getStandings(leagueId: string): Promise<StandingDto[]>;
  getInjuries(fixtureId: string): Promise<InjuryDto[]>;
  getLineups(fixtureId: string): Promise<LineupDto[]>;
  getOdds(fixtureId: string): Promise<OddsDto[]>;
  getCoverage(leagueId: string, season: string): Promise<CoverageFlagsDto>;
}
```

For Phase 1, narrow the implemented live port to upcoming Premier League fixtures and capability lookup. Do not force the football-data.org adapter to pretend it supports deferred endpoints. Keep raw provider DTOs private to the adapter and return normalized provider-independent DTOs.

---

### `packages/football-data/src/providers/football-data-org/{schema,normalize,client}.ts` (validation/transform/adapter)

**Parse-before-normalize source:** `01-RESEARCH.md`, lines 194–196.

```ts
const parsed = footballDataMatchSchema.safeParse(raw);
if (!parsed.success) return { kind: 'rejected', issues: parsed.error.issues };
return normalizeFootballDataMatch(parsed.data);
```

Apply this boundary in three stages:

1. `client.ts` fetches unknown JSON with timeout and redacted request metadata.
2. `schema.ts` strictly parses provider data and preserves nullable values.
3. `normalize.ts` explicitly maps every provider status into the closed domain status; an unknown value is a rejected quality event, never a cast.

The deterministic stub implements the same normalized port. It is enabled only in development/test; production fails closed without required provider credentials.

---

### `packages/domain/src/reconciliation.ts` and `workers/data-sync/src/jobs/fixtures.ts` (policy/job, CRUD + event-driven)

**Decision flow source:** `ARCHITECTURE.md`, lines 175–179.

```text
1. Look up an existing external reference by (provider, externalId).
2. Otherwise search canonical entities using normalized identity evidence.
3. Ambiguous or low-confidence matches enter manual review; do not auto-create/link.
4. For fixtures, exact FixtureExternalRef precedes team-pair + kickoff-window candidates.
```

The implementation transaction must atomically perform the canonical/external-ref mutation, append its evidence-bearing decision, and update the review case. Exact lineage may update a postponed fixture; a kickoff change without lineage is quarantined. Use deterministic job IDs and preserve idempotency, but leave the broad retry/budget pipeline to Phase 2 except for what the runnable worker skeleton needs.

---

### `packages/domain/src/data-state.ts` and `apps/web/components/data-state-notice.tsx` (model/component, transform)

**Component contract source:** `01-UI-SPEC.md`, lines 140–147.

```ts
type DataState =
  | 'AVAILABLE'
  | 'LIMITED'
  | 'STALE'
  | 'UNSUPPORTED'
  | 'UNRESOLVED';

type DataStateNoticeProps = {
  state: DataState;
  reason: string;
  provider: string;
  capturedAt: string;
  sourceUpdatedAt: string | null;
  freshnessThreshold: string;
};
```

This excerpt is a concrete TypeScript translation of the UI contract, not existing source. Put the closed union and state policy in `packages/domain`; the UI package/component consumes it. Every non-available state renders an inline explanation, all timestamps use semantic `<time datetime>`, and unknown enum input fails closed rather than becoming AVAILABLE. Preserve `null`; never use falsy conversion that turns unknown into zero.

---

### `packages/domain/src/eligibility.ts` and `apps/api/src/modules/eligibility/*` (policy/guard/controller, request-response)

**Policy source:** `01-RESEARCH.md`, lines 215–218.

```ts
type EligibilityDecision =
  | { allowed: true }
  | {
      allowed: false;
      reason: 'UNKNOWN_REGION' | 'REGION_NOT_ALLOWED' | 'AGE_NOT_ACKNOWLEDGED';
    };
```

This is a concrete translation of the research contract, not an existing analog. The server evaluates an explicit region against an allowlist and requires an affirmative 18+ acknowledgement. Missing, stale, failed, or unknown inputs deny. Public fixture routes remain outside the guard. Protected responses must not be cached without varying on the full decision.

---

### `apps/api/src/modules/reconciliation/*` and `apps/web/app/internal/reconciliation/page.tsx` (controller/service/guard/component, request-response + audited CRUD)

**Append-only source:** `01-RESEARCH.md`, lines 207–213, plus `01-UI-SPEC.md` Protected Ambiguity Review Queue.

```ts
type ReviewCommand =
  | { action: 'APPROVE_CANDIDATE'; candidateId: string; evidenceNote: string }
  | { action: 'LINK_MANUALLY'; canonicalId: string; evidenceNote: string }
  | { action: 'CREATE_CANONICAL'; reviewSummary: string }
  | { action: 'CORRECT_DECISION'; supersedesDecisionId: string; targetId: string; evidenceNote: string };
```

Again, this is a contract translation. Each command appends a decision; correction never edits/deletes history. Require optimistic version/current-decision checking so a concurrent resolution returns conflict rather than overwriting. The operator guard uses a server-only credential and constant-time comparison; when absent, the module/route is disabled. Raw provider data is escaped inert text and credentials never enter URL, client storage, telemetry, or UI errors.

---

### `apps/api/src/modules/fixtures/*` (controller/service, request-response)

No Nest controller analog exists. Follow the role boundary from research:

```ts
type FixtureReadModel = {
  id: string;
  competition: { id: string; name: string };
  season: number;
  homeTeam: { id: string; name: string };
  awayTeam: { id: string; name: string };
  kickoff: string;
  status: string;
  dataState: DataStateNoticeProps;
};
```

The list endpoint validates UTC `from`/`to` instants and competition filters. The browser—not the API—groups kickoff instants into local calendar dates. The detail projection includes canonical identity, provenance, capture/source update times, and freshness. Use a stable structured error envelope with a safe correlation ID; raw provider/DB exceptions never cross the boundary.

---

### `apps/web/app/fixtures/page.tsx` and `apps/web/app/fixtures/[fixtureId]/page.tsx` (routes/components, request-response)

**UI source:** `01-UI-SPEC.md`, Fixture Dashboard and Fixture Detail sections.

Copy these concrete interaction patterns from the contract:

- URL query parameters are the source of filter state; default range is local start-of-today through +48 hours.
- API queries use UTC instants; grouping happens by the browser's explicit IANA time zone.
- Sort date groups and fixtures ascending and retain stable order during refetch.
- Each fixture has an explicit link; do not make a whole card with nested interactive controls.
- Detail metadata uses a semantic definition list and shows “Not available”/“Not reported” for null fields.
- Do not render forecast, odds, value, disabled, or “coming soon” placeholders.

Use semantic HTML and Tailwind 4 project-owned components; no component-library analog or shadcn initialization exists.

---

### Tests and validation configuration (test/config, batch + request-response)

No test analog exists. Create tests from the requirement matrix in `01-RESEARCH.md` and acceptance contract in `01-UI-SPEC.md`:

- Vitest project tests: config fail-fast/redaction, status normalization, data-state/null preservation, capability unknown→unsupported, eligibility deny-by-default, forecast blocked for unresolved identity, prohibited-copy scan.
- PostgreSQL/Testcontainers integration: unique provider refs, transactionally coupled decision/link, concurrent review conflict, postponement continuity, no duplicate fixture.
- Supertest: fixture list/detail envelopes, operator guard disabled/unauthorized behavior, health redaction.
- Playwright: local-date filters, five-state matrix, list/detail navigation, no protected hydration flash, keyboard review actions, conflict reload, 320/768/1440 layouts.

Use Vitest `test.projects`, not the deprecated workspace config. Playwright should own multi-server startup and locator-based waits; do not introduce sleep-based orchestration.

## Shared Patterns

### Boundary Validation

**Source:** `01-RESEARCH.md`, lines 194–196.  
**Apply to:** environment variables, HTTP query/body inputs, provider payloads.

```ts
const parsed = schema.safeParse(input);
if (!parsed.success) return rejected(parsed.error.issues);
return useValidated(parsed.data);
```

Provider input remains `unknown` until parsed. Validation errors become safe domain/API errors or data-quality events, not raw exception responses.

### Canonical Identity and Audit

**Sources:** `schema.prisma`, lines 64–71, 97–108, 167–176; `ARCHITECTURE.md`, lines 175–179.  
**Apply to:** League, Season, Team, Player, Fixture, reconciliation worker/API.

```prisma
@@unique([provider, externalId])
```

Canonical IDs never encode provider identity. Exact external reference wins; candidate matching is conservative; ambiguous identity is durable review state. Every mutation and its audit record share one transaction.

### Authorization and Secrets

**Source:** context D-04–D-07 and D-19; research security domain.  
**Apply to:** eligibility routes, protected analytics shells, operator review API/UI, config, health/logging.

- Server decisions are authoritative and deny unknown/failure/stale states.
- Operator review is absent/disabled without its credential and excluded from public navigation.
- Secrets remain server-only and are redacted from errors, logs, health, URLs, and client bundles.

### Error Handling

**Source:** `01-RESEARCH.md` anti-patterns and `01-UI-SPEC.md` interaction/copy contracts.  
**Apply to:** all controllers, jobs, pages, and mutations.

Use stable machine reason codes plus safe user copy and optional correlation ID. A failed mutation explicitly states that no decision changed. Concurrent review changes return conflict and require reload. Provider schema failures record a quality event and perform no durable domain write.

### Data Freshness and Missing Values

**Source:** context D-13–D-16 and `01-UI-SPEC.md` line 140.  
**Apply to:** normalized DTOs, database projection, API read models, UI.

Carry provider, captured time, source-updated time, configured freshness threshold, state, and reason together. `LIMITED` and `STALE` remain readable; `UNRESOLVED` blocks forecast entry. Null remains null through every layer and is rendered explicitly, never as zero.

### Accessibility and Responsible Copy

**Source:** `01-UI-SPEC.md` Accessibility and Copywriting contracts.  
**Apply to:** all web routes/components and content tests.

Prefer native controls, visible focus, non-color state labels/icons, semantic time elements, polite status vs alert semantics, and 48px targets. Repository tests reject certainty, urgency, risk-free, and guaranteed-profit language. The public fixture UI stays neutral and contains no betting placeholders.

## No Executable Analog Found

Every implementation file lacks a real codebase analog. Planner actions should use the listed draft/contract source and the Phase 1 research examples, then establish the first project convention.

| File/Family | Role | Data Flow | Reason |
|---|---|---|---|
| Root workspace/build/test configs | config | batch | No package/workspace config exists |
| API modules/controllers/guards | controller/service/middleware | request-response | No NestJS source exists |
| Web routes/components | component/route | request-response | No Next.js/React source or design system exists |
| Worker/job implementation | service/job | event-driven/CRUD | No BullMQ or worker source exists |
| Domain policies/types | model/service | transform | Only prose contracts exist |
| Provider adapter/stub | service/adapter | request-response | Only interface prose and parsing example exist |
| Tests/helpers | test | mixed | No test source or configuration exists |
| Seed/migrations/Compose | migration/config | batch/CRUD | Only schema and architecture drafts exist |

## Planner Guidance for First-Pattern Establishment

Because there are no code analogs, the first plan should explicitly establish and test conventions rather than claim to follow existing ones:

1. ESM TypeScript, strict mode, `noUncheckedIndexedAccess`, package exports, and dependency direction.
2. Zod `safeParse` at every untrusted boundary.
3. Domain packages free of Nest, Prisma, Swagger, and React imports.
4. Controllers thin; domain services/policies return discriminated unions; database package owns persistence details.
5. One structured error envelope and one redacted logging convention.
6. Test files colocated for unit contracts, with top-level `tests/integration` and `tests/e2e` for cross-process flows.
7. A human verification checkpoint before installing research-marked `[SUS]` packages.

## Metadata

**Analog search scope:** repository root including hidden `.planning`; excluded `.git` and did not treat research-cache JSON as source code  
**Repository implementation files scanned:** 3 `.prisma` copies, 0 TypeScript/JavaScript/React files, 0 runtime package/config files  
**Strong source artifacts used:** 4  
**Pattern extraction date:** 2026-08-27

