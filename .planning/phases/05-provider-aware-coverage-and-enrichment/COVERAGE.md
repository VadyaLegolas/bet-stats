# Phase 05 Provider API Coverage

**Policy:** default to `INTEGRATE`. This inventory is the Phase 05 implementation and verification boundary; provider-specific paths are adapter details behind the provider-neutral football-data contract.

## football-data.org v4

| capability | decision | reason |
|---|---|---|
| `GET /competitions` and `GET /competitions/{code}` | INTEGRATE | Discover and verify configured competition/season identity and coverage. |
| `GET /competitions/{code}/matches` | INTEGRATE | Primary fixtures and results for top-five leagues and Champions League. |
| `GET /competitions/{code}/standings` | INTEGRATE | Primary standings for configured football-data.org competitions. |
| `GET /matches/{id}` | INTEGRATE | Exact fixture/result refresh and receipt provenance. |
| `GET /teams/{id}` and `GET /competitions/{code}/teams` | INTEGRATE | Team external-reference resolution and canonical reconciliation evidence. |
| `GET /teams/{id}/matches` | INTEGRATE | Bounded historical/result recovery through the normalized match contract. |
| `GET /matches/{id}/head2head` | OPT-OUT | Existing chronological evidence owns H2H; another live path would duplicate quota spend and as-of semantics. |
| `GET /competitions/{code}/scorers`, `/persons/{id}` | OPT-OUT | Individual scorers/person profiles do not satisfy PROV-01–07 and cannot feed Phase 05 evidence. |

## API-Football v3

| capability | decision | reason |
|---|---|---|
| `GET /leagues` | INTEGRATE | Credentialed competition/season discovery and seasonal capability records; no guessed league IDs. |
| `GET /fixtures` and `GET /fixtures?id=...` | INTEGRATE | Eligible fallback for top-five/UCL and sole production fixture/result source for UEL/UECL. |
| `GET /standings` | INTEGRATE | Fallback or sole-source standings under the route matrix. |
| `GET /teams` | INTEGRATE | Provider external references and conservative canonical identity resolution. |
| `GET /fixtures/lineups` | INTEGRATE | Optional-lane official confirmed-lineup observations; endpoint success alone is not confirmation. |
| `GET /injuries` | INTEGRATE | Optional cutoff-safe, attributable evidence when seasonal capability and budget permit. |
| `GET /odds` | INTEGRATE | Optional provenance-bearing provider odds only; manual odds stay the primary value workflow. |
| `GET /fixtures/statistics` | INTEGRATE | Optional detailed statistics with explicit observed-empty/unavailable semantics. |
| API-Football player directory and leaderboard endpoints | OPT-OUT | Player directory and leaderboard breadth is outside PROV-01–07; lineup/injury endpoints provide admitted evidence. |
| `GET /predictions` | OPT-OUT | Third-party predictions cannot become model evidence or replace the transparent in-house forecast. |
| `GET /odds/live`, `/fixtures/events` | OPT-OUT | Live/in-play signals are explicitly outside MVP scope. |
| API-Football administrative/editorial endpoints | OPT-OUT | Transfers, trophies, coaches, venues, timezones and countries do not satisfy this phase and consume protected quota. |

## TheSportsDB v1

| capability | decision | reason |
|---|---|---|
| `searchteams.php?t={name}` | INTEGRATE | Suggestion-only names, aliases and validated logo candidates for an existing reconciliation case. |
| `lookupteam.php?id={id}` | INTEGRATE | Refresh one selected suggestion with provider provenance. |
| `lookup_all_teams.php?id={leagueId}` | INTEGRATE | Bounded administrator-triggered candidate discovery where league mapping is known. |
| `all_leagues.php` / `search_all_leagues.php` | INTEGRATE | Resolve suggestion search scope without granting production authority. |
| TheSportsDB event schedule/result endpoints | OPT-OUT | TheSportsDB cannot supply production fixtures, results, or match evidence per D-13. |
| Event statistics/lineups/timelines and player endpoints | OPT-OUT | These fields cannot enter forecast evidence or canonical decisions in Phase 05. |
| Direct browser rendering of remote badge/logo URLs | OPT-OUT | Untrusted URLs create SSRF/content risks; only the application’s validated HTTPS host/type/size boundary may render them. |

## Cross-provider invariants

- Every integrated match/standing/team variant validates at its adapter boundary and round-trips through one provider-neutral normalized contract.
- Provider IDs, payloads, paths and headers remain adapter/provenance details; canonical league, season, team, player and fixture IDs never derive from them.
- Capability discovery records provider, competition, season, endpoint, support state, verification time, expiry and receipt; it is not a permanent availability boolean.
- Every admitted call follows capability (where required), circuit, atomic reservation/throttle, call, header observation and append-only receipt ordering.
