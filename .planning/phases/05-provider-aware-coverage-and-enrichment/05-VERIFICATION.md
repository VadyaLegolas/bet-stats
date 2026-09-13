---
phase: 05-provider-aware-coverage-and-enrichment
verified: 2026-09-13T09:07:11Z
status: gaps_found
score: 4/14 must-haves verified
behavior_unverified: 2
overrides_applied: 0
gaps:
  - truth: "D-01/D-02/D-03: production ingestion routes configured competitions across providers without changing canonical identity"
    status: failed
    reason: "The route matrix, fallback runner, and canonical resolver exist, but production worker execution never calls them. The default runtime constructs only FootballDataOrgClient and fixture ingestion hardcodes football-data.org."
    artifacts:
      - path: "workers/data-sync/src/main.ts"
        issue: "startReplayWorker creates one FootballDataOrgClient factory for every competition and endpoint."
      - path: "workers/data-sync/src/ingestion/runner.ts"
        issue: "runProviderRoute is referenced only by tests."
      - path: "packages/database/src/reconciliation/provider-fixture-resolver.ts"
        issue: "Canonical cross-provider resolver is referenced only by its integration test, not by production ingestion."
    missing:
      - "Select football-data.org/API-Football factories from the versioned route in the production worker."
      - "Execute bounded fallback and persist classified outcomes for fixture/result/standings jobs."
      - "Route fallback observations through resolveProviderFixture before publication."
  - truth: "D-04/D-05: sole-source failures expose timestamped last-valid data as limited and not current"
    status: failed
    reason: "The lower-level fallback helper can carry lastValidAt, but the production fixture projection always returns lastValidAt: null and the production route helper is unwired."
    artifacts:
      - path: "apps/api/src/modules/fixtures/fixtures.service.ts"
        issue: "projectProviderState unconditionally sets lastValidAt to null, including NO_FALLBACK."
      - path: "tests/integration/provider-state-api.test.ts"
        issue: "The no-fallback test asserts lastValidAt: null, so it codifies the missing contract instead of detecting it."
    missing:
      - "Query and project the timestamp of the latest valid immutable observation for NO_FALLBACK routes."
      - "Add an API test proving stale last-valid data is labelled with its real timestamp."
  - truth: "D-04/D-06: every route attempt is durably recorded and later primary recovery appends rather than rewrites fallback facts"
    status: failed
    reason: "The durable repository exists, but the production ingestion path does not use createProviderRoutingRepository/runProviderRoute. runProviderRoute itself only calls persistAttempt before provider I/O and has no success/failure append callback."
    artifacts:
      - path: "packages/database/src/provider-routing/repository.ts"
        issue: "Substantive append-only repository is not wired into production worker routing."
      - path: "workers/data-sync/src/ingestion/runner.ts"
        issue: "Fallback helper records pre-call selection only; terminal success/failure is not persisted by this contract."
    missing:
      - "Wire route and attempt repositories into live ingestion and append terminal outcome/source receipt evidence."
      - "Run the database-backed recovery/append behavioral test with PostgreSQL."
  - truth: "D-08/D-09: optional enrichment is scheduled and executed only after capability, circuit, and protected-budget admission"
    status: failed
    reason: "Admission logic and queue construction are substantive and tested in isolation, but no enrichment Worker is registered, createEnrichmentQueue is unused, scheduleFixtureEnrichment is unused, and runEnrichmentJob has no production caller."
    artifacts:
      - path: "workers/data-sync/src/main.ts"
        issue: "Starts replay, settlement, and backtest workers only; no optional enrichment worker or queue."
      - path: "workers/data-sync/src/jobs/enrichment.ts"
        issue: "runEnrichmentJob is referenced only by tests."
      - path: "workers/data-sync/src/queues/index.ts"
        issue: "createEnrichmentQueue exists but is not constructed by the runtime."
    missing:
      - "Register an enrichment queue consumer and map provider endpoint calls to runEnrichmentJob."
      - "Schedule enrichment from the fixture lifecycle and persist attributable observations/forecast revisions."
  - truth: "D-12: every absent forecast kind is shown with its exact server-derived reason"
    status: failed
    reason: "The API implements reason-coded availability, but the web workbench never calls the availability endpoint and hardcodes generic insufficient-evidence/no-lineup copy."
    artifacts:
      - path: "apps/api/src/modules/forecasts/forecast-comparison.service.ts"
        issue: "Reason-coded availability exists and is wired to an API route."
      - path: "apps/web/app/fixtures/[fixtureId]/forecast-workbench.tsx"
        issue: "Renders local hardcoded absence text and never fetches /forecasts/availability."
    missing:
      - "Load the server availability DTO in the fixture UI and render CAPABILITY_DENIED, BUDGET_PROTECTED, PROVIDER_UNAVAILABLE, NO_CONFIRMED_LINEUP, or INSUFFICIENT_EVIDENCE exactly."
behavior_unverified_items:
  - truth: "D-06: primary recovery appends new facts without rewriting fallback-derived history"
    test: "Persist fallback facts, recover the primary provider, then inspect both immutable observations and the selected current projection."
    expected: "Both receipts remain; deterministic freshness may select primary without mutating the fallback record."
    why_human: "The database-backed provider-routing tests were skipped because Docker/PostgreSQL was unavailable in this verification environment."
  - truth: "D-10: URL-selected left/right forecast snapshots remain stable through refresh, arrival of a newer snapshot, and explicit swap"
    test: "Open a fixture with at least two snapshots, select a pair, refresh, add a newer snapshot, and use Swap."
    expected: "The URL and selected IDs remain exact until the user explicitly changes or swaps them."
    why_human: "Pure helper/unit coverage passed, but no running browser/server flow was exercised."
---

# Phase 5: Provider-Aware Coverage and Enrichment Verification Report

**Phase Goal:** As a football analytics user, I want to access configured competition coverage and pre-match evidence updates, so that provider failures remain visible and canonical identities remain stable.
**Verified:** 2026-09-13T09:07:11Z
**Status:** gaps_found
**Re-verification:** No — initial verification after MVP goal normalization

## User Flow Coverage

| Step | Expected | Evidence | Status |
| --- | --- | --- | --- |
| Open configured competition coverage | Top-five/UCL use football-data.org with eligible API-Football fallback; UEL/UECL use API-Football | Route matrix exists in `provider-route.ts`, but `workers/data-sync/src/main.ts` constructs only `FootballDataOrgClient` | ✗ |
| Observe a provider failure | Failure is visibly limited/unavailable and preserves timestamped last-valid data | Provider notice renders states; `FixturesService.projectProviderState()` always emits `lastValidAt: null` | ✗ |
| Receive pre-match evidence updates | Optional calls run only after capability/circuit/budget admission | Admission helper passes tests, but there is no production enrichment queue consumer or caller | ✗ |
| Compare immutable forecast revisions | Exact pair remains selected and material deltas are shown | Domain/API/UI implementations exist; 46 unit tests and relevant integration tests pass | ⚠ behavior unverified in browser |
| Outcome | Provider failures remain visible and canonical identities remain stable in the live path | Critical provider routing and resolver artifacts are not connected to production ingestion | ✗ |

## Goal Achievement

### Observable Truths

The five roadmap criteria and PLAN details were deduplicated into the fourteen trackable decisions from `05-CONTEXT.md`.

| # | Truth | Status | Evidence |
| --- | --- | --- | --- |
| 1 | D-01 provider roles are explicit and versioned in production | ✗ FAILED | Matrix exists, but production runtime always creates `FootballDataOrgClient`. |
| 2 | D-02 fallback is classified and cannot redefine canonical identity | ✗ FAILED | `runProviderRoute` and API-Football adapter are not called by production worker. |
| 3 | D-03 ambiguous cross-provider fixtures are quarantined | ✗ FAILED | Resolver is substantive but only imported by tests. |
| 4 | D-04 attempts and safe user-visible states retain route evidence | ✗ FAILED | Repository and notice exist; production routing is unwired and `lastValidAt` is discarded. |
| 5 | D-05 UEL/UECL are no-fallback with timestamped last-valid state | ✗ FAILED | Route matrix models sole source; live worker does not select it and API emits null last-valid timestamp. |
| 6 | D-06 recovery appends and deterministic freshness selects current facts | ⚠ PRESENT_BEHAVIOR_UNVERIFIED | Append repository exists; DB behavioral tests could not run and production routing is absent. |
| 7 | D-07 exact fresh capability plus circuit and atomic budget gate admission/policy approval | ✓ VERIFIED | Transactional admission and authenticated policy approval are wired; linked unit/integration tests passed. |
| 8 | D-08 optional calls protect critical headroom and never automate wagering | ✗ FAILED | Policy helper is correct in isolation; optional execution has no production worker. |
| 9 | D-09 official same-fixture pre-cutoff lineup gates LINEUP_CONFIRMED | ✗ FAILED | Helper test passed, but helper has no production caller. |
| 10 | D-10 exact comparison pair remains stable | ⚠ PRESENT_BEHAVIOR_UNVERIFIED | Exact server validation and URL helper tests passed; browser state transition was not exercised. |
| 11 | D-11 comparison leads with evidence/model/limitation/probability deltas and receipts | ✓ VERIFIED | `compareForecastPair`, API projection, and `ForecastComparisonPanel` are wired; value-level tests passed. |
| 12 | D-12 absent kinds expose exact reason instead of empty/generic content | ✗ FAILED | API reasons exist but UI does not consume availability and hardcodes copy. |
| 13 | D-13 TheSportsDB is suggestion-only and cannot supply match evidence/auto-approve | ✓ VERIFIED | Suggestion DTO is separated from decisions and forecast evidence; boundary tests passed. |
| 14 | D-14 logo candidates cross a guarded validated application boundary | ✓ VERIFIED | AppModule → MediaModule → OperatorGuard → validation service → bounded response is wired; hostile-input tests passed. |

**Score:** 4/14 truths verified (2 present, behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
| --- | --- | --- | --- |
| `packages/football-data/src/providers/api-football/client.ts` | Strict API-Football adapter | ✓ substantive, ⚠ orphaned from runtime | Adapter tests pass; no production factory selects it. |
| `packages/football-data/src/routing/provider-route.ts` | Versioned provider route | ✓ substantive, ⚠ partial wiring | Job-ID helpers use it; runtime execution does not. |
| `packages/database/src/provider-routing/repository.ts` | Append-only route/admission evidence | ✓ substantive, ⚠ orphaned from ingestion | Used by policy approval/tests, not live ingestion. |
| `packages/database/src/reconciliation/provider-fixture-resolver.ts` | Canonical fallback resolver | ✓ substantive, ⚠ orphaned | No production import. |
| `workers/data-sync/src/jobs/enrichment.ts` | Optional admission/execution | ✓ substantive, ⚠ orphaned | Only tests call `runEnrichmentJob`. |
| `apps/web/components/provider-state-notice.tsx` | Honest degradation UI | ✓ wired, ⚠ hollow timestamp | Receives API projection that never supplies last-valid time. |
| `packages/domain/src/forecast/comparison.ts` | Deterministic exact-pair delta | ✓ VERIFIED | Domain → API → web proxy/UI flow exists. |
| `packages/football-data/src/providers/thesportsdb/client.ts` | Review-only suggestions | ✓ VERIFIED | Used only by reconciliation suggestion endpoint. |
| `apps/api/src/modules/media/provider-logo.controller.ts` | Guarded image boundary | ✓ VERIFIED | Registered through MediaModule in AppModule. |

### Key Link Verification

| From | To | Via | Status | Details |
| --- | --- | --- | --- | --- |
| Route policy | production provider clients | worker factory selection | ✗ NOT_WIRED | Runtime has one football-data.org factory. |
| Fallback response | canonical resolver | audited identity resolution | ✗ NOT_WIRED | Resolver is test-only. |
| Enrichment schedule | enrichment handler | BullMQ worker | ✗ NOT_WIRED | Queue creator/scheduler/handler are not composed. |
| Fixture route receipts | provider notice | fixture API DTO | ⚠ PARTIAL | State flows, but last-valid timestamp does not. |
| Exact IDs | comparison service | DB exact lookup and same-fixture validation | ✓ WIRED | GET proxy preserves exact left/right IDs and no-store semantics. |
| Availability API | absent-kind UI | reason-coded DTO | ✗ NOT_WIRED | Workbench renders hardcoded reasons. |
| TheSportsDB | review UI | sanitized suggestion endpoint | ✓ WIRED | Suggestions remain separate from decision mutation. |
| AppModule | provider logo bytes | guarded media controller/service | ✓ WIRED | Authentication, SSRF/MIME/size/signature checks, bounded response. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
| --- | --- | --- | --- | --- |
| Provider state notice | `providerState` | Prisma route/attempt projection | Partial; last-valid data is replaced with null | ⚠ HOLLOW |
| Forecast comparison | `revisionComparison` | Next proxy → Nest → Prisma exact snapshots | Yes | ✓ FLOWING |
| Forecast availability | absence reason | Prisma lineup/route facts | Yes at API, not consumed by UI | ✗ DISCONNECTED |
| Reconciliation suggestions | suggestion list/logoRef | TheSportsDB → Nest sanitizer/signer → web | Yes | ✓ FLOWING |
| Provider logo | image bytes | signed opaque ref → allowlisted HTTPS fetch → validation | Yes | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| --- | --- | --- | --- |
| Phase 5 unit contracts | `vitest run --project unit` on 5 linked files | 5 files, 46 tests passed | ✓ PASS |
| Non-container Phase 5 integration contracts | `vitest run --project integration` on 8 linked files | 7 files/39 tests passed; forecast snapshot suite required DATABASE_URL | ⚠ PARTIAL |
| Database-backed routing/fallback | linked integration invocation | 10 tests skipped because Docker/PostgreSQL was unavailable | ? SKIP |
| Workspace type safety | `turbo run typecheck` under Node 24.14.0 | 7/7 packages successful | ✓ PASS |

### Probe Execution

No `probe-*.sh` artifact is declared. `scripts/provider-policy-probe.ts` is a credential-dependent probe generator; its redaction and request-binding contracts were exercised by the passing unit tests. Live provider credentials were not used during verification.

### Requirements Coverage

| Requirement | Source Plans | Status | Evidence |
| --- | --- | --- | --- |
| PROV-01 | 01, 02, 03, 05, 08, 09, 10 | ✗ BLOCKED | Primary route policy exists but is not executed by production worker. |
| PROV-02 | 01, 02, 03, 05, 08, 09, 10 | ✗ BLOCKED | API-Football fallback and resolver are not wired into live ingestion. |
| PROV-03 | 01, 02, 03, 05, 08, 09, 10 | ✗ BLOCKED | UEL/UECL matrix exists, but worker defaults to football-data.org only. |
| PROV-04 | 02, 03, 05, 08, 09, 10 | ✗ BLOCKED | Limited notice exists; live sole-source routing and last-valid timestamp do not. |
| PROV-05 | 02, 04, 08, 09, 10 | ✗ BLOCKED | Admission helper is isolated from any production optional worker. |
| PROV-06 | 06, 07, 08, 10 | ? NEEDS HUMAN | Server comparison and UI markup exist; exact browser flow remains unexercised and absent reasons are disconnected. |
| PROV-07 | 08, 10 | ✓ SATISFIED | Suggestion-only controller/service/UI and guarded logo boundary are wired and tested. |

No orphaned Phase 5 requirements were found.

### Test Quality Audit

| Test Area | Active | Skipped | Circular | Assertion Level | Verdict |
| --- | ---: | ---: | --- | --- | --- |
| Provider contracts/adapters | 22+ | 0 | No | Value/behavioral | Strong but does not prove runtime composition |
| Routing/fallback persistence | 0 executed here | 10 environment-skipped | No | Behavioral | ⚠ runtime evidence unavailable |
| Enrichment | 3 | 0 | No | Behavioral | Insufficient for production wiring |
| Comparison/API/UI helpers | 9+ | 0 | No | Value/behavioral | Strong for pure/server logic; browser flow unverified |
| TheSportsDB/media/security | 10+ | 0 | No | Behavioral | Strong |

**Disabled tests on requirements:** 0 source-level `.skip`/`.todo` markers.  
**Circular patterns detected:** 0.  
**Misleading passing evidence:** routing and enrichment tests call isolated helpers directly, so they pass while production composition omits those helpers.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| --- | ---: | --- | --- | --- |
| `workers/data-sync/src/main.ts` | 27 | Single hardcoded production provider factory | 🛑 Blocker | Prevents configured multi-provider routing. |
| `apps/api/src/modules/fixtures/fixtures.service.ts` | 39 | Hardcoded `lastValidAt: null` | 🛑 Blocker | Hides retained last-valid evidence. |
| `apps/web/app/fixtures/[fixtureId]/forecast-workbench.tsx` | 69, 72 | Hardcoded absence reason | 🛑 Blocker | Server capability/budget/provider reasons never reach the user. |

No unreferenced `TBD`, `FIXME`, or `XXX` markers were found in the phase-modified production files.

### Decision Coverage

The GSD decision-coverage heuristic reports **14/14 decisions mentioned by shipped artifacts**. This is non-blocking lexical coverage only; the Level 3/4 checks above show that several artifacts are not wired into production.

### Human Verification Required After Gap Closure

1. Open top-five/UCL and UEL/UECL fixtures with controlled primary/fallback failures and confirm exact limited/fallback copy plus timestamps.
2. Select two forecast snapshots, refresh, introduce a newer snapshot, swap, and confirm URL-stable selection and accessible delta focus.
3. Review TheSportsDB suggestions and logo failure states in the administrator UI; confirm suggestions cannot resolve a case without an explicit audited action.

### Gaps Summary

Phase 5 has substantive provider, policy, comparison, and media building blocks, but the core provider-routing and optional-enrichment slices stop at testable seams. The production worker still runs the earlier single-provider path, the canonical fallback resolver is not invoked, optional enrichment has no consumer, and two server-to-UI evidence links are incomplete. These are Phase 5 concerns and are not deferred to Phase 6, whose roadmap scope is release experience and operations.

---

_Verified: 2026-09-13T09:07:11Z_  
_Verifier: the agent (gsd-verifier)_
