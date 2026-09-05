# Phase 3: Forecast and Manual Value Workbench - Research

**Researched:** 2026-09-05
**Domain:** cutoff-correct football probability forecasts, immutable analytical snapshots, manual odds normalization, and gated value analysis
**Confidence:** HIGH for repository architecture and locked behavior; MEDIUM for the initial numeric policy defaults

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

### Forecast Model and Probability Contract
- **D-01:** V1 uses one transparent, versioned ensemble: a Poisson score matrix covering 0:0 through 7:7 supplies score-derived markets, while Elo, recent form, venue strength, goal rates, rest, and low-weight H2H adjust expected goals through explicit bounded configuration. Raw component inputs and every transformation parameter remain receipt-visible.
- **D-02:** The published 1X2 distribution is normalized to a strict configured tolerance, and Over/Under 2.5 plus BTTS Yes/No are derived from the same score matrix. Tail mass outside 7:7 is measured and disclosed; it may be normalized under a versioned rule but never silently discarded.
- **D-03:** Fair decimal odds are the reciprocal of the final published event probability, computed with decimal-safe boundary handling. Unsupported or zero probability produces unavailable rather than infinity or a fabricated number.
- **D-04:** Missing or weak evidence is never imputed as neutral zero. The forecast may remain inspectable with limitations, but any component that violates configured minimum evidence or freshness rules contributes to an explicit insufficient-evidence gate.
- **D-05:** Prediction snapshots are append-only and uniquely identify fixture, snapshot kind, model version, configuration hash, as-of cutoff, evidence-build IDs, exact feature inputs, source timestamps, generated probabilities, confidence components, assumptions, and creation time. Corrections create a new snapshot; they never mutate an issued receipt. — **Reversibility:** one-way — changing snapshot identity or mutability after Phase 4 begins would require migrating historical evaluations and break receipt reproducibility.
- **D-06:** INITIAL is the first eligible forecast; PRE_MATCH is the latest scheduled cutoff before kickoff; LINEUP_CONFIRMED is created only from an official confirmed-lineup observation. Re-running the same logical kind/input/config returns the existing snapshot, while changed inputs or config create a new immutable revision.
- **D-07:** Event probability and confidence are separate. Confidence is a versioned aggregate of completeness, lineup availability, freshness, source reliability, and model stability; the UI always shows the components and never converts confidence into certainty language.
- **D-08:** Forecast generation fails closed for unresolved canonical identity, unavailable required evidence, post-cutoff inputs, or ineligible jurisdiction/age state. Stale or limited evidence follows configurable gates and remains visible with machine-readable reasons.

### Manual Odds Book and Normalization
- **D-09:** Odds entry is market-at-a-time and requires the complete mutually exclusive selection set: Home/Draw/Away, Over/Under 2.5, or BTTS Yes/No. Every value must be finite decimal odds greater than 1.00; field errors identify missing, malformed, duplicate, or out-of-range selections before submission.
- **D-10:** A submitted manual odds book is an immutable snapshot tied to fixture, market, selection odds, user-entered source label, capture time, and schema/version metadata. Editing creates a replacement snapshot and leaves the prior observation auditable. — **Reversibility:** costly — mutable odds would invalidate value receipts and later settlement/CLV comparisons.
- **D-11:** The MVP uses multiplicative normalization across the complete book (`(1/odds) / sum(1/odds)`) and displays both bookmaker implied probability and normalized no-vig probability, plus total overround. Partial books are saved only as drafts outside analysis and cannot produce value output.
- **D-12:** The user compares one explicitly selected forecast snapshot with one explicitly selected odds snapshot; the server does not silently switch either input when newer snapshots appear.

### Value Decision and User Experience
- **D-13:** Edge is model probability minus normalized market probability; expected value is `modelProbability * decimalOdds - 1`. Calculations retain full precision and round only for display.
- **D-14:** A value candidate appears only when edge, expected value, minimum confidence, and data-quality gates all pass for the exact snapshot pair. Thresholds and gate versions are stored in the receipt. A positive EV alone is not sufficient.
- **D-15:** The workbench leads with the three-state outcome: value candidate, no value, or insufficient evidence. It then shows market comparison, confidence breakdown, evidence/model explanation, and an expandable immutable receipt. No state uses stake sizing, urgency, guaranteed-profit language, or automatic wagering cues.
- **D-16:** No-value explains that the evidence was sufficient but configured thresholds were not met. Insufficient-evidence lists the failed evidence/confidence/data-quality gates and does not rank a near-miss as a recommendation.
- **D-17:** The prediction receipt is downloadable/copyable as structured JSON and human-readable on screen, including IDs and versions for exact forecast, odds, model/config, cutoff, sources, assumptions, formulas, thresholds, and gate outcomes.

### the agent's Discretion
- Exact bounded adjustment weights, probability tolerance, tail-mass warning threshold, confidence aggregation weights, and value thresholds, provided they are versioned, research-backed, configurable, and covered by deterministic/property tests.
- Exact responsive card/table layout, chart choice, microcopy, and progressive disclosure within the established accessibility and responsible-gambling patterns.
- Exact API resource names and database table names, provided snapshot pairing and append-only receipt semantics remain explicit.

### Deferred Ideas (OUT OF SCOPE)
- Settlement, scoring, calibration, ROI/Yield, rolling-origin backtests, and CLV — Phase 4.
- Automated provider odds, official lineup/injury enrichment, snapshot comparison across evidence updates, and additional competitions — Phase 5.
- Stake sizing, bankroll optimization, automatic wager placement, live/in-play signals, and personalized betting prompts — out of MVP scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PRED-01 | Normalized 1X2 probabilities satisfy invariant | One canonical score matrix plus deterministic normalization and invariant tests |
| PRED-02 | O/U 2.5 and BTTS from at least 0:0–7:7 matrix | Matrix marginalization formulas and explicit tail receipt |
| PRED-03 | Fair decimal odds | Decimal boundary module; unavailable for zero/unsupported events |
| PRED-04 | Immutable forecast snapshot | Append-only schema, content identity, evidence-build references |
| PRED-05 | Separate probability and confidence | Separate DTO fields, versioned confidence components and gates |
| PRED-06 | INITIAL, PRE_MATCH, conditional LINEUP_CONFIRMED | Snapshot-kind policy and idempotent scheduling |
| ODDS-01 | Complete valid mutually exclusive odds set | Strict market-selection parser and server-side validation |
| ODDS-02 | Immutable manual odds | Append-only book plus selection children and replacement link |
| ODDS-03 | Multiplicative no-vig probabilities | Decimal normalization and overround invariant tests |
| VALUE-01 | Edge and EV from exact pair | Explicit forecastSnapshotId + oddsSnapshotId comparison command |
| VALUE-02 | Candidate only when all gates pass | Pure versioned decision function with all-of gate semantics |
| VALUE-03 | No-value or insufficient-evidence | Tagged outcome union; evidence gates take precedence |
| VALUE-04 | Reproducible receipt | Persisted self-contained value receipt and canonical JSON response |
</phase_requirements>

## Summary

Phase 3 should be planned as a vertical analytical slice with the calculation core completed before persistence, API, worker scheduling, and UI. The live Phase 2 contract already exposes cutoff-aware evidence components and source references; its verbatim component kinds are `"form5" | "form10" | "elo" | "homeStrength" | "awayStrength" | "goalRates" | "restDays" | "h2h"`, and projection states are `"COMPLETE" | "LIMITED" | "PENDING"` with freshness `"FRESH" | "STALE" | "UNAVAILABLE"`. [VERIFIED: packages/domain/src/evidence/contract.ts:52-75]

The planner should make snapshot identity and abstention semantics the spine of the phase. Compute a deterministic forecast draft from two exact evidence-build projections, validate all cutoffs and gates, then insert a content-addressed immutable snapshot. Manual odds and value receipts follow the same pattern. No endpoint may accept arbitrary probabilities, confidence, edge, or EV from the browser. [VERIFIED: packages/domain/src/forecast-eligibility.ts:1-4] [CITED: https://github.com/OWASP/ASVS/blob/master/5.0/en/0x17-V8-Authorization.md]

**Primary recommendation:** implement three pure domain pipelines (`forecast`, `odds`, `value`) around immutable string-decimal DTOs, then expose explicit snapshot-pair commands and render their tagged results in the fixture workbench.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Poisson matrix, market marginals, fair odds | Domain package | — | Pure deterministic math, independent of transport/persistence |
| Evidence/cutoff and confidence gates | Domain package | API | Domain returns reasons; API enforces eligibility and authoritative lookup |
| Immutable forecast/odds/value records | Database | API | PostgreSQL owns identity and append-only truth; API orchestrates transactions |
| INITIAL/PRE_MATCH generation | Worker | API/domain | Scheduler supplies cutoff/kind; shared service/domain performs identical generation |
| Manual odds validation and comparison | API | Web | Server validates and computes; browser provides field UX only |
| Three-state workbench and receipt export | Web | API | Web presents exact server receipt; API controls content and authorization |

## Project Constraints (from AGENTS.md)

- Use pnpm workspaces/Turborepo and the specified Next.js/React/TypeScript, NestJS, PostgreSQL/Prisma, Redis/BullMQ architecture. [VERIFIED: AGENTS.md]
- Use only free-tier football data and manual odds; track provider request budgets. [VERIFIED: AGENTS.md]
- Preserve canonical IDs, provider external-reference mapping, auditable matching, and immutable snapshots. [VERIFIED: AGENTS.md]
- External sync work must be idempotent, cached, retried with backoff, and circuit-breaker protected. [VERIFIED: AGENTS.md]
- Prevent temporal leakage and measure probability quality rather than hit rate. [VERIFIED: AGENTS.md]
- No automatic wagering or certainty claims; keep region restrictions and persistent disclaimers. [VERIFIED: AGENTS.md]
- For web implementation, read the installed Next.js documentation under `apps/web/node_modules/next/dist/docs/` because this version contains breaking changes. [VERIFIED: apps/web/AGENTS.md]
- No project-specific skills are present. [VERIFIED: AGENTS.md]

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript | 5.9.3 | Pure model/gate contracts | Already pinned across the monorepo. [VERIFIED: package.json] |
| Prisma ORM | 7.10.0 | Snapshot schema and atomic persistence | Already pinned; compound unique constraints support idempotent identity lookups. [VERIFIED: packages/database/package.json] [CITED: https://docs.prisma.io/docs/orm/prisma-client/special-fields-and-types/working-with-composite-ids-and-constraints] |
| PostgreSQL | project datasource | Durable append-only truth | Live Prisma datasource is verbatim `provider = "postgresql"`. [VERIFIED: packages/database/prisma/schema.prisma:6-8] |
| decimal.js | 10.6.0, add to domain/API boundary package | Decimal odds, reciprocals, normalization and EV | Official API supports isolated precision/rounding config and immutable operations; registry and legitimacy checks passed. [VERIFIED: npm registry] [CITED: https://mikemcl.github.io/decimal.js/] |
| Vitest | 4.1.11 | Deterministic/property-style unit and integration tests | Existing root test projects cover `packages/**/*.test.ts`, `tests/unit`, and `tests/integration`. [VERIFIED: package.json; vitest.config.ts] |
| Playwright | 1.62.1 | Keyboard/responsive workbench E2E | Existing configured E2E runner uses Chromium. [VERIFIED: package.json; playwright.config.ts] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| NestJS | 11.1.29 | Server policy and orchestration | Forecast/odds/value resources behind existing eligibility guard. [VERIFIED: apps/api/package.json] |
| Next.js / React | 16.3.3 / 19.2.8 | Fixture workbench | Server-render snapshot data; use a focused client component for odds form interaction. [VERIFIED: apps/web/package.json] |
| BullMQ | 6.3.x | Scheduled INITIAL/PRE_MATCH jobs | Reuse worker queue boundary; do not make queue state snapshot truth. [VERIFIED: apps/api/package.json] |

**Installation:** `corepack pnpm --filter @bet-stats/domain add decimal.js@10.6.0`

## Package Legitimacy Audit

| Package | Registry | Age/Publish | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-------------|-----------|-------------|---------|-------------|
| decimal.js | npm | modified 2025-07-06 | 84,968,422/week | github.com/MikeMcl/decimal.js | OK; no postinstall | Approved |

**Packages removed due to [SLOP] verdict:** none.  
**Packages flagged as suspicious [SUS]:** none.  
Registry version `10.6.0` and legitimacy signals were checked on 2026-09-05. [VERIFIED: npm registry]

## Architecture Patterns

### System Architecture Diagram

```text
fixture page / worker schedule
          |
          v
eligibility + exact fixture + cutoff policy ----fail----> insufficient evidence receipt
          |
          v
published home/away evidence builds
          |
          v
bounded expected-goals transform -> Poisson 0..7 matrix -> tail + market marginals
          |                                      |
          v                                      v
confidence components + gates             normalized probabilities/fair odds
          \                                      /
           ------> immutable forecast snapshot <------
                              |
manual complete odds form -> immutable odds snapshot
                              |
                 explicit snapshot-pair command
                              |
              pure edge/EV/all-gates decision
                              |
                 immutable value receipt
                              |
      value | no-value | insufficient-evidence UI + JSON
```

### Recommended Project Structure

```text
packages/domain/src/
├── forecast/       # config, expected goals, Poisson matrix, markets, confidence, DTO parser
├── odds/           # market selection contract, complete-book parser, no-vig normalization
└── value/          # pair contract, edge/EV, gates, tagged outcome, receipt schema
packages/database/prisma/ # append-only snapshot models + migration constraints/triggers
apps/api/src/modules/{forecasts,odds,value}/
workers/data-sync/src/jobs/forecasts.ts
apps/web/app/fixtures/[fixtureId]/ # server page plus client odds form/workbench components
```

### Pattern 1: Deterministic Calculation Then Atomic Insert

Build and validate a complete plain DTO without database side effects. Hash canonical, versioned inputs/config, then transact an insert guarded by a required compound unique identity. On a unique collision, fetch and return the existing row; never use an upsert with a mutating update branch for issued snapshots. Prisma compound unique members must be non-null, so optional lineup observation identity should be represented by a separate required fingerprint or separate uniqueness rule. [CITED: https://docs.prisma.io/docs/orm/reference/prisma-schema-reference]

### Pattern 2: One Matrix, Many Markets

For independent home and away Poisson goal counts, compute each cell from the NIST PMF `exp(-lambda) * lambda^x / x!`; derive 1X2, total-goals and BTTS by summing cells, then apply one documented normalization policy. The retained mass is the sum of all 64 cells and tail mass is `1 - retainedMass`; store both pre- and post-normalization values. [CITED: https://www.itl.nist.gov/div898/handbook/eda/section3/eda366j.htm]

### Pattern 3: Tagged Outcomes, Not Exceptions for Abstention

Use a strict result union such as outcome tags `VALUE_CANDIDATE`, `NO_VALUE`, `INSUFFICIENT_EVIDENCE`; calculation/input corruption is exceptional, but a failed evidence or threshold gate is a normal persisted result. Gate precedence should be: policy/canonical/cutoff/data quality -> confidence -> edge and EV. [ASSUMED]

### Pattern 4: Snapshot Pair Is Command Input

The value endpoint accepts exact `forecastSnapshotId` and `oddsSnapshotId`, verifies both belong to the fixture and same market, and persists both IDs in a receipt. Never accept “latest” for comparison and never recompute an older forecast from current evidence. [VERIFIED: 03-CONTEXT.md D-12 through D-17]

### Anti-Patterns to Avoid

- Do not calculate forecast or value in React; browser calculations cannot be authoritative or reproducible. [CITED: https://github.com/OWASP/ASVS/blob/master/5.0/en/0x17-V8-Authorization.md]
- Do not store only rounded percentages; persist canonical decimal strings/full-precision numeric representations and round at rendering. [CITED: https://mikemcl.github.io/decimal.js/]
- Do not encode snapshot state as mutable “current prediction” rows. [VERIFIED: 03-CONTEXT.md D-05]
- Do not treat `PENDING`, `LIMITED`, `STALE`, or a missing component as zero. [VERIFIED: packages/domain/src/evidence/contract.ts:69-80]
- Do not generate LINEUP_CONFIRMED from inferred or merely expected lineups. [VERIFIED: 03-CONTEXT.md D-06]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Arbitrary precision decimal boundary | Ad-hoc scaled integers/epsilon comparisons across modules | decimal.js with one cloned config | Centralizes precision and rounding semantics. [CITED: https://mikemcl.github.io/decimal.js/] |
| Durable uniqueness/idempotency | Check-then-insert without DB constraint | PostgreSQL compound unique constraint + transaction | Concurrent jobs can pass application checks. [CITED: https://docs.prisma.io/docs/orm/prisma-client/special-fields-and-types/working-with-composite-ids-and-constraints] |
| Separate market models | Independent 1X2/O-U/BTTS calculators | One score matrix and marginalizers | Prevents internally contradictory displayed probabilities. [VERIFIED: 03-CONTEXT.md D-01/D-02] |
| Client-only validation | HTML constraints alone | Strict domain parser + Nest validation/error mapping | Requests are untrusted and may bypass the form. [CITED: https://github.com/OWASP/ASVS/blob/master/5.0/docs_en/OWASP_Application_Security_Verification_Standard_5.0.0_en.flat.json] |

## Common Pitfalls

### Pitfall 1: Tail Renormalization Hides Model Truncation
**What goes wrong:** displayed markets sum correctly but the discarded 8+ goal mass disappears.  
**Avoidance:** store retained/tail mass, raw marginals, normalization rule/version, and warning-gate result. Test high-lambda configurations. [VERIFIED: 03-CONTEXT.md D-02]

### Pitfall 2: Snapshot Kind Is Mistaken for Snapshot Identity
**What goes wrong:** a uniqueness constraint on fixture+kind prevents legitimate revisions, or retries create duplicates.  
**Avoidance:** identity includes fixture, kind, cutoff, model/config fingerprint and evidence/input fingerprint; revision is append-only, and collision returns the identical row. [VERIFIED: 03-CONTEXT.md D-05/D-06]

### Pitfall 3: Decimal Values Cross JSON as Binary Numbers
**What goes wrong:** odds, implied probability and EV drift or receipt hashes differ between layers.  
**Avoidance:** accept validated decimal strings, construct Decimal from strings, serialize canonical strings, and convert only display values to formatted text. [CITED: https://mikemcl.github.io/decimal.js/]

### Pitfall 4: Confidence Is Used as a Probability Multiplier
**What goes wrong:** users cannot distinguish model probability from evidence quality.  
**Avoidance:** never multiply probability by confidence; return separate versioned components and use confidence only as a candidate gate. [VERIFIED: 03-CONTEXT.md D-07/D-14]

### Pitfall 5: “Latest” Creates Receipt Drift
**What goes wrong:** a refresh silently pairs new evidence/odds and makes the visible receipt irreproducible.  
**Avoidance:** selection IDs stay explicit in URL/form state and all API commands; newly available snapshots are a user-visible choice. [VERIFIED: 03-CONTEXT.md D-12]

### Pitfall 6: Database Rows Are Append-Only Only by Convention
**What goes wrong:** future service code updates or deletes an issued receipt.  
**Avoidance:** repository exposes create/read only, migrations add update/delete denial triggers for issued snapshots where project migration practice permits, and integration tests attempt mutation. [ASSUMED]

## Code Examples

### Pure Matrix Marginalization Skeleton

```typescript
// Source formula: https://www.itl.nist.gov/div898/handbook/eda/section3/eda366j.htm
function poisson(k: number, lambda: number): number {
  let factorial = 1;
  for (let i = 2; i <= k; i += 1) factorial *= i;
  return Math.exp(-lambda) * lambda ** k / factorial;
}

// Produce cells for homeGoals and awayGoals 0..7, sum raw market buckets,
// record retainedMass and 1-retainedMass, then apply the configured rule once.
```

### Decimal Odds Boundary Skeleton

```typescript
// Source: https://mikemcl.github.io/decimal.js/
import Decimal from "decimal.js";
export const ModelDecimal = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_EVEN });

export function impliedProbability(odds: string): string {
  const value = new ModelDecimal(odds);
  if (!value.isFinite() || !value.gt(1)) throw new Error("INVALID_DECIMAL_ODDS");
  return new ModelDecimal(1).div(value).toString();
}
```

The exact precision and rounding mode above are discretionary initial defaults and therefore `[ASSUMED]`; lock them in versioned config only after deterministic boundary tests. The error code `"INVALID_DECIMAL_ODDS"` is also `[ASSUMED]` until defined in the source contract.

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| Independent market calculators | One finite score matrix with disclosed tail | Coherent score-derived markets and auditable truncation. [VERIFIED: 03-CONTEXT.md D-01/D-02] |
| Mutable “current forecast” | Content-identified append-only revisions | Enables Phase 4 frozen evaluation. [VERIFIED: 03-CONTEXT.md D-05] |
| Positive EV as recommendation | Edge + EV + confidence + quality all-of gate | Makes abstention a first-class result. [VERIFIED: 03-CONTEXT.md D-14/D-16] |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Initial Decimal precision 40 and ROUND_HALF_EVEN | Code Examples | Receipt numbers/config hash change; must be locked before production snapshots |
| A2 | Database triggers should enforce issued-row immutability | Pitfall 6 | Prisma-only enforcement may be chosen instead; weaker defense-in-depth |
| A3 | Gate precedence is quality, confidence, then edge/EV | Pattern 3 | Changes classification/microcopy for multi-failure cases |
| A4 | Forecast expected-goal weights and candidate thresholds | User discretion | Must be research-backed and versioned before implementation; no product defaults are yet authoritative |

## Open Questions

1. **What are the initial versioned numeric defaults?**
   - Known: weights, tolerance, tail warning, confidence weights and value thresholds are discretionary.
   - Recommendation: create `forecast-config-v1` as an explicit reviewed artifact; test bounds and expose every value in receipts. Do not claim calibration before Phase 4.
2. **How are INITIAL and PRE_MATCH cutoffs scheduled?**
   - Known: kinds and semantics are locked; no exact lead time is locked.
   - Recommendation: choose named configurable durations and include cutoff-policy version; LINEUP_CONFIRMED remains dormant until official evidence exists.
3. **Should immutable enforcement include PostgreSQL triggers?**
   - Recommendation: yes for issued snapshots/receipts, plus repository restrictions and mutation integration tests; planner may split this into a migration hardening task.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | all tasks | wrong version | 25.2.1; project requires `>=24.0.0 <25` | Install/use Node 24 before verification |
| pnpm | workspace | yes | 10.34.5 | — |
| Docker | PostgreSQL integration/E2E | yes | 29.7.2 | — |
| psql CLI | manual DB inspection | no | — | Prisma/Testcontainers; not execution-blocking |
| redis-cli | queue inspection | no | — | Docker health checks/application client |

**Missing dependencies with no fallback:** Node 24 is required for project commands; the active Node 25 runtime violates the repository engine range. [VERIFIED: package.json; local version probes]

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.11 + Playwright 1.62.1 |
| Config file | `vitest.config.ts`, `playwright.config.ts` |
| Quick run command | `corepack pnpm test -- --run tests/unit/forecast.test.ts` |
| Full suite command | `corepack pnpm test && corepack pnpm test:integration && corepack pnpm test:e2e && corepack pnpm typecheck && corepack pnpm build` |

### Phase Requirements → Test Map

| Requirements | Behavior | Test Type | Automated Command | File Exists? |
|--------------|----------|-----------|-------------------|-------------|
| PRED-01..03 | matrix/marginals/invariants/fair odds | unit | `corepack pnpm exec vitest run --project unit tests/unit/forecast.test.ts` | ❌ Wave 0 |
| PRED-04..06 | append-only identity/kinds/cutoffs | integration | `corepack pnpm exec vitest run --project integration tests/integration/forecast-snapshots.test.ts` | ❌ Wave 0 |
| ODDS-01..03 | complete books/errors/no-vig | unit+integration | `corepack pnpm exec vitest run --project integration tests/integration/manual-odds.test.ts` | ❌ Wave 0 |
| VALUE-01..04 | exact pair/gates/outcomes/receipt | unit+integration | `corepack pnpm exec vitest run --project integration tests/integration/value-receipt.test.ts` | ❌ Wave 0 |
| all UI behavior | keyboard form, three states, receipt, disclaimer | E2E | `corepack pnpm exec playwright test tests/e2e/forecast-workbench.spec.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** relevant single unit/integration file under 30 seconds.
- **Per wave merge:** unit + integration projects.
- **Phase gate:** full suite, typecheck and build green under Node 24.

### Wave 0 Gaps
- [ ] `tests/unit/forecast.test.ts` — probability, tail, fair-odds and property/invariant coverage
- [ ] `tests/unit/value.test.ts` — complete books, no-vig, edge/EV and gate truth table
- [ ] `tests/integration/forecast-snapshots.test.ts` — idempotency, revisions, cutoff and immutability
- [ ] `tests/integration/manual-odds.test.ts` — strict validation and immutable replacement
- [ ] `tests/integration/value-receipt.test.ts` — exact snapshot pair and reproducible JSON
- [ ] `tests/e2e/forecast-workbench.spec.ts` — all outcome states, keyboard operation and risk copy

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| Authentication | no new mechanism | Reuse existing policy context |
| Session Management | no new mechanism | Reuse existing boundary |
| Authorization | yes | Server rechecks jurisdiction/age and fixture/snapshot relationship for every read/write |
| Validation / Business Logic | yes | Strict allowlisted market/selection parser; finite decimal > 1; complete mutually exclusive set; server computes all analytics |
| File Handling | yes | Receipt filename is server-generated; JSON content disposition/type fixed; no user path input |
| Cryptography | no new crypto | Use established platform hashing for config/input identity; never invent crypto |
| Logging | yes | Log IDs, versions and rejected reason codes; never log full user-entered/private payloads by default |

ASVS 5.0.0 is the latest stable release (May 2025). [CITED: https://github.com/OWASP/ASVS] The phase should verify authorization, input validation/business-logic integrity, generated-file safety and audit logging; input validation failures and access-control failures should be observable without leaking sensitive material. [CITED: https://github.com/OWASP/ASVS/blob/master/5.0/docs_en/OWASP_Application_Security_Verification_Standard_5.0.0_en.flat.json]

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Client submits fabricated model probability/EV | Tampering | DTO excludes derived fields; server recomputes from exact immutable IDs |
| Snapshot ID belongs to another fixture/market | Elevation/Tampering | Authoritative relational lookup and ownership/fixture equality checks |
| NaN/Infinity/extreme decimal causes invalid receipt or resource abuse | DoS/Tampering | String grammar, max length/scale, finite and >1 checks before Decimal construction |
| Receipt export path/header injection | Tampering | Fixed server filename template and content type; no source label in path/header |
| Policy bypass on new endpoints | Elevation | Apply existing eligibility guard at module/controller boundary and integration-test denial |

## Sources

### Primary (HIGH confidence repository)
- `packages/domain/src/evidence/contract.ts` — live cutoff/evidence/value vocabulary.
- `packages/domain/src/forecast-eligibility.ts` — live canonical identity fail-closed gate.
- `packages/database/prisma/schema.prisma` — live PostgreSQL and append-only evidence patterns.
- `package.json`, package manifests, Vitest/Playwright configs — installed versions and test commands.

### Secondary (MEDIUM confidence authoritative documentation)
- https://mikemcl.github.io/decimal.js/ — Decimal configuration, arithmetic, immutability and formatting.
- https://docs.prisma.io/docs/orm/prisma-client/special-fields-and-types/working-with-composite-ids-and-constraints — compound uniqueness/client operations.
- https://docs.prisma.io/docs/orm/reference/prisma-schema-reference — uniqueness/null semantics.
- https://www.itl.nist.gov/div898/handbook/eda/section3/eda366j.htm — Poisson PMF/CDF.
- https://github.com/OWASP/ASVS — ASVS 5.0.0 status and controls.

### Tertiary (LOW confidence)
- Initial numeric model/gate defaults remain assumptions pending review and Phase 4 evaluation.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — mostly installed stack; decimal.js verified via official docs, npm registry and legitimacy gate.
- Architecture: HIGH — constrained by CONTEXT.md and established Phase 2 boundaries.
- Numeric defaults: LOW — intentionally not locked; must be a versioned planning decision.
- Pitfalls: HIGH for cutoff/snapshot/rounding issues; MEDIUM for database trigger recommendation.

**Research date:** 2026-09-05  
**Valid until:** 2026-10-05 for dependencies; architecture remains valid while Phase 3 context is unchanged.
