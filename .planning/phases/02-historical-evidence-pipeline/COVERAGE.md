# Phase 2 football-data.org coverage

Phase 2 deliberately limits live football-data.org access to fixture continuity,
completed results, and standings. The endpoint priority lane is the primary
scheduling and budget policy; the endpoint surface is the variant detail within
that lane. Every live call still requires a durable reservation before provider
construction or network I/O.

Upcoming-fixture replay is competition-bound across PL, PD, BL1, SA, FL1, CL,
and EL: each request carries its exact bounded date window, and the adapter
rejects any provider envelope that reports a different competition.

## Coverage decisions

| capability | decision | reason |
|---|---|---|
| upcoming fixtures | INTEGRATE | |
| completed results | INTEGRATE | |
| standings | INTEGRATE | |
| lineups | OPT-OUT | Optional enrichment must not consume historical continuity headroom; scheduled for Phase 3. |
| injuries | OPT-OUT | Optional enrichment remains outside the Phase 2 live path; scheduled for Phase 3. |
| odds | OPT-OUT | MVP odds remain user-entered; provider odds are scheduled for Phase 5. |
| secondary statistics | OPT-OUT | Additional match statistics follow the core evidence pipeline in Phase 3. |
| fallback/enrichment endpoints | OPT-OUT | Fallback providers and broader enrichment require Phase 5 coverage and quota review. |

## Phase2EndpointCoverage

| Endpoint surface | Adapter method | Capability key | Endpoint priority lane | Reservation class | Normalized DTO | Durable observation/fact | Automated witness |
|---|---|---|---|---|---|---|---|
| upcoming fixtures | `fetchCompetitionFixtures` | `fixtures.read` | critical | fixture-continuity | `NormalizedFixture` | immutable provider observation + canonical fixture | provider contract: `tests/unit/provider-contract.test.ts`; replay boundary: `tests/integration/replay-boundary.test.ts` |
| completed results | `fetchCompletedResults` | `results.read` | critical | result-continuity | `NormalizedCompletedResult` | immutable provider observation + versioned completed-result fact | `tests/integration/pipeline-jobs.test.ts` |
| standings | `fetchStandings` | `standings.read` | standard | standings | `NormalizedStandingsSnapshot` | immutable provider observation + atomic standings snapshot | `tests/integration/temporal-provenance.test.ts` |

The result and standings symbols name the intended adapter boundary only. This
coverage contract does not require those future exports to exist before their
production plan is executed.

## Explicit opt-outs

| Endpoint surface | Phase 2 status | Target phase | Reason |
|---|---|---|---|
| lineups | deferred | Phase 3 | Optional enrichment must not consume historical continuity headroom. |
| injuries | deferred | Phase 3 | Optional enrichment remains outside the Phase 2 live path. |
| odds | deferred | Phase 5 | Provider odds are not needed while MVP odds remain user-entered. |
| secondary statistics | deferred | Phase 3 | Additional match statistics follow the core evidence pipeline. |
| fallback/enrichment endpoints | deferred | Phase 5 | Fallback providers and broader enrichment require later coverage and quota review. |

No deferred row authorizes a provider call in Phase 2. Adding one to the live
matrix requires a reviewed coverage change and a matching automated witness.
