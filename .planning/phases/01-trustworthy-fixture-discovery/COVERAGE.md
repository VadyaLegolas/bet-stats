# Phase 1 External API Capability Surface

This file is the implementation contract for every external football-data capability considered by Phase 1. Unknown capability is treated as unsupported until explicitly configured or probed, per D-15. No provider request may bypass capability lookup or the Phase-1 atomic request reservation persisted by provider, UTC date, and endpoint type. Phase 2 owns priority allocation, broad retry orchestration, richer budget reporting, and historical synchronization; fallback routing and enrichment remain in their roadmap phases.

| Provider / surface | Competition scope | Phase 1 decision | Reason and enforcement |
|---|---|---|---|
| football-data.org competition matches (`GET /competitions/PL/matches`) | Premier League, current configured season | **INTEGRATE** | Required by D-01 for the single production fixture path. Parse untrusted JSON, normalize to provider-independent DTOs, preserve provenance/capture time, and use a deterministic development/test adapter when credentials are absent outside production. |
| football-data.org competition metadata / capability verification | Premier League, current configured season, `FIXTURES` endpoint | **INTEGRATE** | Required by DATA-08 and D-15. Persist provider + competition + season + endpoint + support state + verification time before the fixture request is eligible. Unknown is unsupported. |
| football-data.org standings/results | Any | **OPT-OUT** | Phase 2 owns historical evidence and result/standing synchronization. Phase 1 records capability shape only and does not call these endpoints. |
| football-data.org lineups, injuries, odds, detailed statistics | Any | **OPT-OUT** | Not part of the provider's Phase 1 fixture contract and conditionally available enrichment is Phase 5. No placeholder methods or calls. |
| API-Football fixtures/fallback/enrichment | Any | **OPT-OUT** | Fallback and Europa/Conference League coverage are Phase 5. Adding it now would violate D-01's narrow verified path. |
| TheSportsDB names/logos | Any | **OPT-OUT** | Reconciliation suggestions are Phase 5; it must never provide production match statistics or silently approve identity. |
| Provider bookmaker/wager execution APIs | Any | **OPT-OUT** | Automatic wagering is prohibited. Phase 1 contains no odds, staking, or bet-placement capability. |

## Request invariants

- Canonical IDs never contain provider IDs; `(provider, externalId)` lives only in external-reference records (D-08).
- The implemented fixture job uses a deterministic job/idempotency key and produces no duplicate canonical facts when rerun. Before every live call it atomically reserves capacity and persists provider, UTC request date, endpoint type, timestamp, and job key; denied capability or exhausted allowance performs zero network calls, and retrying the same job key does not consume a second reservation. Phase 2 extends this contract with priority allocation, broad retry orchestration, richer reporting, and historical endpoint budgets.
- Raw provider payloads are validated before normalization; malformed or unknown status data creates a safe quality rejection and no canonical write.
- Durable facts, provenance, reconciliation decisions, and later immutable prediction snapshots belong in PostgreSQL. Redis/BullMQ is disposable coordination state and never stores authoritative history.
- No capability record, response, health endpoint, log, or client bundle exposes provider credentials.
