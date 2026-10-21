# Phase 06 External API Coverage

**Scope:** Current provider adapters only. Phase 06 adds no new external provider integration; first-party application, operations, and privacy routes are not third-party API integrations. An endpoint is `INTEGRATE` only when it is part of a current adapter; all other listed capabilities are explicit `OPT-OUT` decisions.

| capability | decision | reason |
|---|---|---|
| `football-data.org v4: GET /competitions/{code}/matches` | INTEGRATE | Current adapter supplies bounded scheduled-fixture and finished-result windows for configured competitions. |
| `football-data.org v4: GET /competitions/{code}/standings` | INTEGRATE | Current adapter supplies normalized standings snapshots for configured competitions. |
| `football-data.org v4: GET /competitions/{code}` (provider policy probe) | INTEGRATE | Existing provider policy probe checks configured competition availability without making this a forecast-evidence endpoint. |
| `football-data.org v4: GET /matches/{id}/head2head` | OPT-OUT | Chronological project evidence already owns head-to-head history; a second live path duplicates quota use and as-of semantics. |
| `football-data.org v4: team/person/scorer and other unimplemented resources` | OPT-OUT | No current adapter or Phase 06 consumer requires these resources; they must not expand provider quota or evidence scope implicitly. |
| `API-Football v3: GET /leagues` | INTEGRATE | Current adapter verifies configured league and season identity. |
| `API-Football v3: GET /fixtures` (date-window and fixture-ID queries) | INTEGRATE | Current adapter supplies eligible fixture/result data through the provider-neutral contract. |
| `API-Football v3: GET /standings` | INTEGRATE | Current adapter supplies normalized fallback or sole-source standings where configured. |
| `API-Football v3: GET /teams` | INTEGRATE | Current adapter supplies provider team observations for conservative identity reconciliation. |
| `API-Football v3: GET /fixtures/lineups` | INTEGRATE | Current adapter records optional lineup observations; endpoint success alone does not confirm a lineup. |
| `API-Football v3: GET /injuries` | INTEGRATE | Current adapter records optional attributable enrichment when capability and request-budget policy permit. |
| `API-Football v3: GET /odds` | INTEGRATE | Current adapter records optional provider odds with provenance; manual odds remain the primary workflow. |
| `API-Football v3: GET /fixtures/statistics` | INTEGRATE | Current adapter records optional statistics with explicit availability semantics. |
| `API-Football v3: player directories/leaderboards` | OPT-OUT | The current model/evidence contract does not require these additional endpoints. |
| `API-Football v3: GET /predictions` | OPT-OUT | Third-party forecasts must not replace or contaminate the transparent in-house model. |
| `API-Football v3: GET /odds/live` and in-play event endpoints | OPT-OUT | Live wagering and in-play analysis are outside the MVP boundary. |
| `API-Football v3: administrative/editorial endpoints` | OPT-OUT | Transfers, trophies, coaches, venues, timezones, and countries have no current consumer and would spend protected provider quota. |
| `TheSportsDB v1: GET /searchteams.php` | INTEGRATE | Current adapter returns bounded, suggestion-only team candidates for reconciliation. |
| `TheSportsDB v1: team/league lookup endpoints` | OPT-OUT | The current adapter exposes search suggestions only; no production evidence or canonical decision depends on these lookups. |
| `TheSportsDB v1: event, player, and match-detail endpoints` | OPT-OUT | TheSportsDB is not an authoritative production match-evidence source for this project. |
| `TheSportsDB v1: browser-rendered remote badge/logo URLs` | OPT-OUT | Untrusted remote URLs must not bypass the application's validated media boundary. |
| `External signed personal-data subject provider` | OPT-OUT | No provider has been selected or configured; durable personal-history opt-in remains fail-closed until explicit approved inputs exist. |

