# Feature Research

**Domain:** Football prediction and value-betting analytics platform
**Researched:** 2026-08-27
**Confidence:** MEDIUM

## Product Positioning

The viable product is not a tipster feed and not a bookmaker front end. It is a transparent forecasting workbench: users inspect upcoming fixtures, understand a probability estimate, enter decimal odds, see whether the price differs from the model, and later verify how the frozen forecast performed. Current products already normalize odds, compare model and market probabilities, publish value signals, and expose performance history. Merely producing picks is therefore table stakes; the defensible advantage is auditability, calibration, visible data quality, and an honest ability to say “no value.”

The free-tier constraint materially shapes the feature set. Manual odds entry is a first-class launch workflow, not an embarrassing fallback. Injuries, detailed statistics, lineups, and provider odds must be treated as conditional enrichment. Every match view needs to communicate whether a field is confirmed, stale, manually entered, or unavailable.

## Feature Landscape

### Table Stakes (Users Expect These)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Upcoming fixtures dashboard | Users need a clear starting point for today and the next 48 hours | MEDIUM | Filter by competition, kickoff date, data status, and whether a forecast exists; use the configurable competition list |
| Match analysis page | A probability without context looks like an unexplained tip | MEDIUM | Show recent 5/10-match form, home/away split, league position, Elo difference, rest days, low-weight H2H, and only available secondary inputs |
| Multi-market probabilities | Comparable products cover more than a single winner pick | HIGH | Launch with 1X2, O/U 2.5, and BTTS; derive double chance, O/U 1.5/3.5, and team totals from the same score matrix once validated |
| Fair odds and probability explanation | Users must be able to translate a model probability into a comparable price | LOW | Display probability, fair decimal odds, expected goals, and a plain-language note that confidence is not event probability |
| Manual decimal-odds entry | Free plans do not provide reliable, current bookmaker odds across the required scope | MEDIUM | Validate market completeness and decimal range; record bookmaker label, source=`manual_user`, and capture time; do not silently reuse stale odds |
| No-vig market probability | Raw implied probabilities include bookmaker margin | MEDIUM | Normalize all outcomes in a market together; label the V1 multiplicative method and retain a future normalization-method field |
| Value calculation and filtering | Probability-to-market comparison is the core user job | MEDIUM | Show model probability, normalized market probability, edge, EV, threshold, and “no value” explicitly; default edge ≥5% and EV >0 are configurable |
| Immutable forecast history | Users cannot trust performance that can be edited after kickoff | HIGH | Persist INITIAL, PRE_MATCH, LINEUP_CONFIRMED, and FINAL snapshots with model version and captured time; never overwrite historical forecasts |
| Settled-results and forecast scorecard | Prediction products are expected to show receipts rather than selected wins | HIGH | Resolve every eligible forecast; show Brier Score, Log Loss, calibration, sample size, and accuracy by market/league/model version |
| Value-result tracking | Users evaluating value signals expect realized performance | HIGH | Track settled status, profit in units, ROI, and Yield. Show CLV only for cohorts with real timestamped closing odds |
| Data quality and freshness state | Free-provider degradation otherwise looks like model certainty | MEDIUM | Per fixture show completeness, source, last update, lineup status, and limited-data state; make EL/UECL dependency on API-Football visible |
| Transparent confidence breakdown | A single confidence badge is easily mistaken for win probability | MEDIUM | Expose completeness, lineup, freshness, source reliability, and model stability components separately from the aggregate score |
| Responsive and accessible UI | Fixtures and pre-match analysis are often viewed on mobile near kickoff | MEDIUM | Prioritize readable tables/cards, keyboard navigation, non-color-only states, UTC-safe localized kickoff times, and loading/error states |
| Responsible-gambling and legal guardrails | Betting-adjacent analytics must not imply certainty or unrestricted availability | MEDIUM | Persistent disclaimer on prediction/value screens, 18+/local age messaging, configurable jurisdiction flag, support links, no guaranteed-profit language, and no wagering controls |

### Differentiators (Competitive Advantage)

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Reproducible “prediction receipt” | Lets users inspect exactly what the system knew, when it knew it, and which model produced the forecast | HIGH | Snapshot input manifest should include source timestamps, feature availability, model version, probability outputs, and confidence components |
| Calibration-first performance dashboard | Distinguishes probability quality from headline hit rate and short-run ROI | HIGH | Reliability diagrams, Brier/Log Loss, confidence bins, sample sizes, baselines, and league/market cohorts; suppress strong conclusions for small samples |
| Provider-aware evidence trail | Converts unreliable free data from a hidden weakness into visible honesty | HIGH | Display provider role, fallback use, coverage flags, completeness, freshness, and matching provenance without overwhelming the default view |
| Snapshot-delta explanation | Shows why probabilities changed from morning to pre-match or confirmed lineup | HIGH | Compare feature/input changes and probability deltas; avoid unsupported causal claims such as “player X caused exactly 4%” |
| Honest abstention / no-value state | Builds trust by making “no qualified opportunity” a normal result | MEDIUM | Explain which threshold failed and whether low data confidence suppressed a candidate; do not manufacture daily picks |
| Per-league and per-market model suitability | Prevents one aggregate score from hiding weak cohorts | MEDIUM | Show calibration/error and minimum sample requirements for each supported cohort; allow a market to be disabled when evidence is weak |
| Data-quality-aware filtering | Lets users exclude forecasts based on incomplete or stale evidence | MEDIUM | Filters for confirmed lineup, minimum completeness, source availability, and snapshot type; this is more useful than a decorative confidence badge |
| Auditable entity reconciliation admin | Protects historical continuity when providers disagree | HIGH | Queue ambiguous teams/fixtures, show match rationale, allow manual resolution, and preserve an audit log; essential operational differentiator, not a public marketing feature |
| Methodology and model-card page | Gives technically curious users a concise, versioned account of assumptions and limitations | MEDIUM | Explain Poisson/Elo/form, H2H’s low weight, score-matrix truncation, odds normalization, excluded inputs, evaluation window, and known limitations |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Automatic bet placement or bookmaker execution | Removes friction between signal and action | Violates the explicit analytical-only scope, increases licensing/security/compliance risk, and encourages impulsive use | Export/copy a clearly labeled analysis summary; user acts independently outside the product |
| Guaranteed picks, “sure bets,” or certainty badges | High-conversion marketing language | Misrepresents probabilistic forecasts, conflicts with responsible-gambling requirements, and destroys trust after inevitable losses | Use calibrated probabilities, uncertainty, “no value,” and risk disclaimers |
| Live/in-play betting signals | Appears engaging and time-sensitive | Free data latency and quotas cannot support dependable live decisions; creates much higher operational and harm risk | Restrict V1 to pre-match snapshots with visible capture times |
| Automated odds aggregation | Avoids manual entry | Reliable odds coverage is paid or inconsistent; it would turn a free-tier MVP into a brittle feed product | Make fast, well-validated manual entry excellent; add licensed paid integration only after validation |
| Unofficial scraping as a live dependency | Seems to unlock free xG and advanced stats | Can break without notice, may violate terms, and makes user-facing forecasts non-reproducible | Keep permitted historical/caution sources offline, cached, optional, and outside the live critical path |
| Black-box ML or an “AI” label in V1 | Sounds more sophisticated than Poisson/Elo | Adds leakage, calibration, explainability, and operations risk before a baseline exists | Measure a transparent TypeScript baseline first; require walk-forward evidence before introducing ML |
| Large league and market catalog at launch | Creates an impression of completeness | Dilutes data quality, API budget, calibration samples, and QA; users cannot tell which cohorts are credible | Bound V1 to the named competitions and three core markets, then enable cohorts only after quality gates |
| Parlays/accumulators and bet builders | Popular on consumer betting sites | Correlated legs, compounding margin, and high-variance UX conflict with an evidence-first MVP | Analyze single markets independently; consider correlation-aware education only much later |
| Personalized staking recommendations | Converts EV into an actionable stake | Requires bankroll/risk profiling, can overstate fragile edges, and expands responsible-gambling obligations | Report edge and EV in abstract units; optional educational calculator can be separate and conservative after validation |
| Social leaderboards, tipster feeds, and copy-bet mechanics | Drive engagement and virality | Reward volume, overconfidence, survivorship bias, and risky imitation | Publish model-level audited cohorts and methodology rather than user betting performance |
| Notifications designed around urgency or streaks | Increase return visits | Can encourage chasing and turn a research tool into a behavioral betting product | Optional neutral data-refresh alerts only after preference and safer-design review |
| Accuracy-only headline metric | Easy to understand | Rewards picking favorites and says little about probability quality or betting value | Lead with calibration, Brier/Log Loss, sample size, and market baselines; keep accuracy secondary |
| CLV without captured odds history | CLV is a respected long-run signal | Reconstructed or unmatched closing prices produce misleading comparisons | Display CLV only when both user-entered/opening and licensed closing prices are timestamped and comparable |

## Feature Dependencies

```text
[Provider ingestion + API budgets]
    └──requires──> [Canonical entity reconciliation]
                       └──enables──> [Clean fixture and team history]
                                          └──requires──> [Feature engine: form/Elo/home-away]
                                                             └──requires──> [Versioned probability model]
                                                                                └──requires──> [Immutable snapshots]
                                                                                                   └──requires──> [Result settlement]
                                                                                                                      └──enables──> [Calibration + backtest dashboard]

[Manual odds entry]
    └──requires──> [Market taxonomy + validation]
                       └──requires──> [No-vig normalization]
                                          └──combines-with──> [Snapshot probability]
                                                                 └──produces──> [Value candidate]
                                                                                    └──requires──> [Result settlement for ROI/Yield]

[Coverage/freshness logging] ──feeds──> [Confidence components]
[Coverage/freshness logging] ──feeds──> [Limited-data UI and filters]
[Lineup availability] ──optionally-enriches──> [LINEUP_CONFIRMED snapshot]
[Timestamped closing odds] ──required-for──> [CLV]
[Jurisdiction + age policy] ──gates──> [Betting-related analysis views]
[Auto-betting] ──conflicts-with──> [Analytical-only responsible-gambling scope]
```

### Dependency Notes

- **Canonical reconciliation precedes modeling:** duplicated teams or fixtures corrupt recent form, Elo history, snapshots, and evaluation cohorts.
- **Immutable snapshots precede trustworthy evaluation:** backtests must score the actual pre-match artifact, not a recomputed forecast using later data.
- **Odds validation precedes value detection:** the engine must know the complete mutually exclusive outcome set before removing overround.
- **Result settlement precedes ROI/Yield:** unresolved, postponed, cancelled, and void fixtures need explicit rules before aggregates are credible.
- **CLV requires actual odds history:** it cannot be inferred from a single manual price or retroactively scraped without comparable timestamps.
- **Conditional enrichment must not block the baseline:** injuries, lineups, and detailed statistics improve a snapshot only when coverage is confirmed.
- **Responsible-gambling controls are cross-cutting:** copy, routing, saved-history consent, and notifications must use the same region/age policy rather than ad hoc page checks.

## MVP Definition

### Launch With (v1)

- [ ] Configurable top-five leagues plus UCL fixture dashboard with visible provider/data status
- [ ] Canonical teams, leagues, and fixtures with auditable external references and an ambiguous-match review queue
- [ ] Recent 5/10-match form, home/away strength, Elo, rest days, league position, and low-weight H2H from available data
- [ ] Versioned Poisson + Elo + weighted-form forecasts for 1X2, O/U 2.5, and BTTS
- [ ] Match page showing probabilities, fair odds, expected goals, confidence components, freshness, and limitations
- [ ] Fast manual decimal-odds entry for a complete market, multiplicative no-vig normalization, edge, and EV
- [ ] Value list with configurable thresholds and a first-class “no qualified value” state
- [ ] Immutable INITIAL/PRE_MATCH snapshots; LINEUP_CONFIRMED only when a confirmed lineup exists
- [ ] Automated result settlement and model scorecard with Brier, Log Loss, calibration, sample size, and accuracy
- [ ] Settled value-candidate reporting with profit units, ROI, and Yield
- [ ] Persistent risk disclaimer, jurisdiction flag, age messaging, privacy/consent boundaries, and zero wager execution

### Add After Validation (v1.x)

- [ ] Double chance, O/U 1.5 and 3.5, and team totals — after core score-matrix probabilities pass calibration tests
- [ ] Prediction-snapshot comparison and change explanation — after multiple snapshot types are reliably populated
- [ ] Per-league/per-market quality gates and filtering — after cohorts have defensible sample sizes
- [ ] Alternative overround removal (Shin/power) — after enough entered odds exist to compare bias and UX impact
- [ ] Neutral saved-fixture/data-refresh alerts — only after preferences and safer-design review
- [ ] CSV/JSON export of forecasts and evaluation cohorts — after privacy and schema stability review
- [ ] Support for EL/UECL — when API-Football current-season coverage and budget are verified; always retain a limited-data state

### Future Consideration (v2+)

- [ ] Python/ML challenger models — only after leak-free walk-forward comparison beats the transparent baseline on proper scoring rules
- [ ] Licensed automated odds and closing-line feeds — only when product value supports paid data and terms permit storage/display
- [ ] CLV dashboard — only with timestamped, comparable historical prices
- [ ] User accounts, saved analysis history, and explicit betting-behavior consent — when cross-device retention becomes validated demand
- [ ] Layered safer-gambling controls, including activity limits and self-exclusion — before any engagement or personalization expansion
- [ ] Carefully governed additional competitions and markets — one cohort at a time, gated by coverage and calibration evidence

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Fixture dashboard and match pages | HIGH | MEDIUM | P1 |
| Canonical entity/fixture reconciliation | HIGH | HIGH | P1 |
| Transparent core probabilities | HIGH | HIGH | P1 |
| Manual odds + no-vig normalization | HIGH | MEDIUM | P1 |
| Edge/EV and honest no-value state | HIGH | MEDIUM | P1 |
| Immutable prediction receipts | HIGH | HIGH | P1 |
| Result settlement and calibration scorecard | HIGH | HIGH | P1 |
| Data-quality/confidence explanation | HIGH | MEDIUM | P1 |
| Responsible-gambling/region guardrails | HIGH | MEDIUM | P1 |
| Additional derived markets | MEDIUM | MEDIUM | P2 |
| Snapshot-delta explanation | HIGH | HIGH | P2 |
| Alternative overround methods | MEDIUM | MEDIUM | P2 |
| Export and neutral alerts | MEDIUM | MEDIUM | P2 |
| Automated odds/CLV | HIGH | HIGH | P3 |
| ML challenger models | MEDIUM | HIGH | P3 |

**Priority key:**

- P1: Must have for launch
- P2: Add after the core pipeline is validated
- P3: Future consideration with explicit evidence or paid-data trigger

## Competitor Feature Analysis

| Feature | MetricKick | Sportmonks Predictions | Our Recommended Approach |
|---------|------------|------------------------|--------------------------|
| Probability and fair-price view | Model probability, market probability, no-vig fair odds, edge, EV | Probabilities across 20+ markets, fair odds, value flag | Launch with three calibrated markets and transparent fair odds rather than breadth |
| Value detection | Thresholded live value board | Value object can explicitly return `is_value: false` | Make “no value” normal; show failed threshold and data-quality suppression |
| Performance transparency | Public result history and model performance | Prediction history, log loss, hit ratio, predictability by league | Go further with immutable receipts, calibration diagrams, model versions, and sample sizes |
| Odds ingestion | Automated live prices | Paid odds/prediction ecosystem | Manual decimal odds first; no claim of live market coverage |
| Model explanation | “How Predictions Work” and audited results positioning | Describes historical model inputs and player contribution | Versioned model card plus per-snapshot data provenance and limitations |
| Responsible-use posture | 18+, legal-only, informational/not guaranteed messaging | Primarily an API product | Persistent in-product risk messaging, jurisdiction gate, and no execution or urgency mechanics |

## Roadmap Guidance

1. **Start with trustworthy data identity and visible availability.** Provider adapters, budgets, canonical reconciliation, and data-quality states are product prerequisites, not invisible infrastructure.
2. **Deliver one vertical forecast receipt.** A user should open a fixture, see evidence and three market probabilities, enter odds, and save an immutable value assessment.
3. **Close the evaluation loop before expanding breadth.** Resolve results and prove calibration/performance on frozen predictions before adding leagues, markets, or models.
4. **Then deepen transparency.** Add snapshot deltas, cohort quality gates, richer calibration views, and alternative normalization.
5. **Only after validation consider paid feeds, accounts, CLV, and ML.** Each expands cost, privacy, compliance, or leakage risk and needs a specific trigger.

## Sources

- [Project specification](../../SPEC.md) — product requirements and free-tier constraints (project source; HIGH confidence)
- [Project architecture](../../ARCHITECTURE.md) — data flows, provider roles, and component boundaries (project source; HIGH confidence)
- [Draft Prisma schema](../../schema.prisma) — existing data-model support and gaps (project source; HIGH confidence)
- [football-data.org pricing](https://www.football-data.org/pricing) — current Free plan: fixtures, delayed schedules/scores, tables, 12 competitions, 10 calls/minute (official; HIGH confidence)
- [football-data.org API policies](https://docs.football-data.org/general/v4/policies.html) — request throttling and null/availability semantics (official; HIGH confidence)
- [API-Football pricing](https://www.api-football.com/pricing) — current 100 requests/day free allowance and season-limited endpoint access (official; HIGH confidence; runtime coverage must still be checked)
- [MetricKick product](https://www.metrickick.com/) — current competitor positioning around no-vig probabilities, EV, value board, and public performance history (vendor source; MEDIUM confidence)
- [Sportmonks Predictions API](https://www.sportmonks.com/football-api/football-predictions-api/) — current market breadth, value/no-value signals, prediction history, and per-league performance (vendor source; MEDIUM confidence)
- [Sportmonks probability documentation](https://docs.sportmonks.com/v3/tutorials-and-guides/tutorials/odds-and-predictions/predictions/probabilities) — log loss and league predictability fields (official vendor docs; MEDIUM confidence)
- [UK Gambling Commission age and identity verification](https://www.gamblingcommission.gov.uk/public-and-players/guide/age-and-id-verification) — age/identity safeguard context (official regulator; HIGH confidence, jurisdiction-specific)
- [GamCare self-exclusion guidance](https://www.gamcare.org.uk/self-help/self-exclusion/) — self-exclusion and limit guidance for future safer-gambling layers (recognized support organization; MEDIUM confidence)

## Confidence Assessment and Gaps

| Area | Confidence | Reason |
|------|------------|--------|
| Core analytics table stakes | MEDIUM | Cross-checked against two current competitor/vendor products and the project specification; not based on direct user interviews |
| Free-provider-dependent features | HIGH | Current official pricing/policy pages support the conservative design; actual league/season coverage still needs runtime verification |
| Evaluation and transparency features | MEDIUM | Strong agreement between project requirements and current prediction-product patterns; exact UX needs usability testing |
| Responsible-gambling features | MEDIUM | Official/support guidance is credible but jurisdiction-specific legal review remains necessary |
| Differentiator demand | MEDIUM | Aligns strongly with the project’s core value, but must be validated with target users |

Open questions for phase-specific research:

- Which initial user segment matters most: model builders, disciplined recreational bettors, or football analytics enthusiasts?
- Which jurisdiction is the launch default, and does an analytics-only product require age assurance rather than a lighter age gate there?
- How much technical detail should appear by default versus behind an “explain” expansion?
- What minimum sample sizes and calibration thresholds should disable a market/league or label it experimental?
- Can API-Football’s free plan serve the current seasons for every intended competition at implementation time, not merely expose the endpoint name?
- What manual-odds entry format yields the fewest market-mapping errors on mobile?

---
*Feature research for: football prediction and value-betting analytics platform*
*Researched: 2026-08-27*
