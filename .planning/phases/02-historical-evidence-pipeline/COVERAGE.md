# Phase 2 football-data.org coverage

Phase 2 deliberately limits live football-data.org access to fixture continuity,
completed results, and standings. The endpoint priority lane is the primary
scheduling and budget policy; the endpoint surface is the variant detail within
that lane. Every live call still requires a durable reservation before provider
construction or network I/O.

## Phase2EndpointCoverage

| Endpoint surface | Adapter method | Capability key | Endpoint priority lane | Reservation class | Normalized DTO | Durable observation/fact | Automated witness |
|---|---|---|---|---|---|---|---|
| upcoming fixtures | `fetchPremierLeagueFixtures` | `fixtures.read` | critical | fixture-continuity | `NormalizedFixture` | immutable provider observation + canonical fixture | `tests/unit/provider-contract.test.ts` |
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
