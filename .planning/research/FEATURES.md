# Feature Research

**Domain:** Football prediction & value-betting analytics platform (v1.1 milestone — 10 improvement features)
**Researched:** 2026-10-19
**Confidence:** MEDIUM

**Scope:** Expected behavior, user-visible states, edge cases, and honest-failure states for the 10 v1.1 target features only. v1.0 features (fixtures, forecasts, settlement, providers, ops center) are assumed shipped. Excluded from research: league expansion, user notifications, user accounts, UI i18n.

**RG language constraint applied throughout:** no urgency framing ("act before odds drop"), no certainty framing ("guaranteed profit"), paper trading explicitly virtual. Every feature below inherits the platform's persistent disclaimers and region gating.

---

## Per-Feature Breakdown

### 1. CI pipeline in GitHub Actions

**Category:** Table stakes (engineering hygiene) · **Complexity:** LOW

**Expected behavior:**
- Every PR and push to main runs: `pnpm install --frozen-lockfile` → Prisma schema validation → typecheck → lint → unit tests → integration tests (Postgres/Redis service containers) → build, via Turborepo task graph.
- pnpm store cached by lockfile hash; concurrency group cancels stale runs on PR updates; integration job gets ephemeral databases seeded with migrations.
- Failed job = failed check; branch protection blocks merge. Green check is the only "user-visible" surface (operator = developer here).

**User-visible states:** pass / fail with per-step logs; skipped (docs-only path filters); cache hit vs cold run (time difference only).

**Edge cases:** lockfile drift fails intentionally (correct); forked PRs must not receive secrets; flaky integration tests need retry policy *and* a flakiness report (silent retries hide broken tests); runner OS differences (Linux-only is fine, declare it); schema validation must run before tests so migrations fail fast.

**Honest-failure states:** CI *down* (Actions outage) must not be mistaken for "tests pass" — required checks show as pending, never silently green. Do not add `continue-on-error` to required steps.

**Notes:** Table stakes because there is currently *no* CI — v1.0 shipped 88 plans without it. Foundation for every later feature (Lighthouse gating, backup-verification runs, calibration evaluation jobs).

---

### 2. Automated PostgreSQL backups with rotation + restore verification

**Category:** Table stakes (production data safety) · **Complexity:** MEDIUM

**Expected behavior:**
- Scheduled `pg_dump` (custom format) with retention rotation (e.g., 7 daily / 4 weekly / 6 monthly), stored off the DB host.
- Periodic **restore drill**: restore latest backup into a throwaway instance, run validation queries (table counts, schema presence, latest canonical-ID continuity), record pass/fail + duration as evidence.
- Results surfaced in the operations center: "Last backup: 6h ago ✓ · Last restore verification: 7 days ago ✓".

**User-visible states (operator contour):** backup fresh / stale (age > 2× schedule) / failed; restore verification passed / failed / **never run**. Rotation visibly prunes (never zero backups).

**Edge cases:** backup succeeds but archive is corrupt (only a restore test catches this — integrity listing is not enough); schema migrations mean an old backup must restore *and* be compatible with rollback story; disk-full mid-dump (atomic temp file + rename); dump while writes happen (consistent snapshot via single-transaction flag); secrets must not leak into dumps used as CI fixtures.

**Honest-failure states:** "backups enabled" must not display green when the last *verification* failed or never ran — verification-never-run is a distinct, visible, non-green state. Failed verification raises an operator alert (see Feature 3).

**Notes:** Industry guidance is explicit: backups are only valuable if restorable; design the drill to fail loudly rather than pass quietly. WAL/PITR (pgBackRest, continuous archiving) is an anti-feature for this milestone's scale — daily dumps + verified restores match the risk profile.

---

### 3. Operator degradation alerting (provider quota, worker failures/dead-letters, 5xx spikes)

**Category:** Table stakes (ops maturity) · **Complexity:** MEDIUM

**Expected behavior:**
- Three signal families evaluated continuously:
  - **Provider quota:** remaining budget per provider/day/endpoint → warning near threshold (e.g., 80%), critical at exhaustion; shows reset time.
  - **Worker health:** BullMQ `failed` set counts/rate per queue, stalled jobs, backlog age. *BullMQ failures are silent by design* — worker stays alive, no 500, no crash — so the failed set is the only signal; treat it as a dead-letter queue with inspect → retry → drain actions.
  - **API 5xx:** error rate over sustained windows (multi-window burn-rate style, not instantaneous spikes), broken down by route/release.
- Alerts appear in the existing operations center with history and acknowledge/dismiss; optional outbound channel (webhook/email) is operator-only — user-facing notifications remain excluded.

**User-visible states:** per-signal healthy / warning / critical; alert feed with first-seen, count, affected scope; "alerting pipeline itself stale" meta-state (no evaluation in N minutes = its own alert).

**Edge cases:** alert fatigue (aggregate repeated occurrences, don't re-fire every job failure); flapping (require sustained windows before firing); quota resets keyed to provider timezone/UTC boundary; dead-letter drain must be idempotent (jobs are); 5xx denominator near zero at night → rate alerts need minimum request counts.

**Honest-failure states:** unknown ≠ healthy. If metrics haven't arrived, state is "unknown/stale", not green. Backup verification failures (Feature 2) and CI failures should feed the same surface rather than a separate silo.

**Notes:** References converge on Google-SRE-style multi-window burn-rate alerting over raw thresholds (page at fast burn, ticket at slow burn). For a single-operator product, severity = "needs attention today" vs "needs attention now" — avoid anything framed as time-critical to the *end user*.

---

### 4. Lighthouse/performance audit + measurable fixes for `/fixtures/[id]`

**Category:** Table stakes (page-speed expectation) · **Complexity:** MEDIUM (audit LOW, fixes MEDIUM)

**Expected behavior:**
- Baseline audit (mobile + desktop, cold and warm cache) on a stable, seeded fixture page → record LCP/CLS/INP/performance score and bundle sizes *before*; apply targeted fixes; re-audit → record *after* with the same method.
- Typical fix levers for this stack: server-render fixture content instead of client waterfall (TanStack Query double-fetch), code-split Recharts so chart bundle loads only when charts enter view, next/font + image optimization, cache provider lookups at the API edge, trim client JS.
- Optional hard gate: Lighthouse CI assertions (Core Web Vitals thresholds + `budget.json` byte budgets) in the CI pipeline (Feature 1) so regressions fail PRs.

**User-visible states:** faster page (primary); possibly a visible skeleton/loading-state change from removing layout shift; no new UI required.

**Edge cases:** lab vs field variance (Lighthouse is simulated throttling — treat as comparative, not absolute); data-dependent pages (a fixture with 20 H2H rows vs 0 renders differently — pick a deterministic fixture); charts dominate bundle; CI budget flakiness from noisy runners (assert on medians of 3 runs).

**Honest-failure states:** publish before/after numbers even when a fix underdelivers ("LCP improved 38%, CLS unchanged — cause remains X"). Do not chase the 100/100 vanity score at the cost of readability (e.g., disabling lazy chart loading to win a metric).

**Notes:** The question's "measurable fixes" is the differentiator: an audit without recorded before/after is theater. Score is a means; the milestone's success criterion should be metric deltas on the specific route.

---

### 5. Isotonic/Platt per-market calibration + versioned rollback on Brier regression

**Category:** Differentiator (core value: measured probability quality) · **Complexity:** HIGH

**Expected behavior:**
- Post-hoc calibration layer per market (1X2, O/U 2.5, BTTS; later per new market) fitted on a **held-out** set of settled predictions — never the data the model was fitted on (leakage rule).
- **Method selection by sample size:** Platt scaling (2-parameter sigmoid) is the safer default for small calibration sets; isotonic regression (monotone PAVA step function) only with sufficient data — cited guidance: Platt beats isotonic below ~200–1,000 examples; isotonic overfits below ~100 observations per class and shows jagged steps when starved. On a young platform this means **Platt first, isotonic as a versioned upgrade later**.
- Each fitted calibration layer is a versioned artifact (market → active version, params, fit window N, Brier/ECE before-after, method). Predictions record which layer version produced them (evidence chain).
- **Regression gate:** on a fresh settled window, compare active vs previous version's Brier on identical fixtures; if active regresses beyond a threshold *and* window N ≥ minimum, roll back to previous version; rollback event logged with numbers. Fresh-settled N below gate → "insufficient data to evaluate" (no rollback, no claim).
- 1X2 is 3-class: per-class Platt/isotonic outputs must be renormalized to sum to 1 (or calibrated jointly) — otherwise calibrated probabilities break the sum-1 invariant and corrupt fair odds.

**User-visible states:** calibrated probabilities in forecasts/methodology card; reliability diagram + before/after Brier per market in the model card; per-market badges: "uncalibrated (insufficient settled history)", "calibrated vN (Platt, N=…)", "rolled back vN→vM on Brier regression (…)".

**Edge cases:** early-season small samples per competition; concept drift (calibration fit window must time-decay or be refit periodically); isotonic jagged steps on small N; Brier noise — a regression on N=40 is variance, not signal (this is exactly why the min-N gate exists); comparing Brier across model versions mixes two changes (model vs layer) — evaluate the layer against the frozen model output it wraps.

**Honest-failure states:** never apply a fitted layer below minimum fit size — ship identity mapping with an explicit "not yet calibrated" state; never claim "improved" without the before/after numbers on held-out data; if calibration made Brier worse, say so (the reference calculator's honest mode: "Calibration did not improve Brier score").

**Notes:** Distinguishes this platform from competitors that market "AI-calibrated" probabilities without publishing reliability data. Rollback applies to the *calibration layer version* and (separately) the *model version* — keep the two registries distinct.

---

### 6. Dixon-Coles low-score correction for the Poisson goal model

**Category:** Differentiator (model quality) · **Complexity:** MEDIUM

**Expected behavior:**
- Apply the τ multiplier to exactly four joint cells — 0-0 (`1−λμρ`), 1-0 (`1+μρ`), 0-1 (`1+λρ`), 1-1 (`1−ρ`) — over the existing score matrix; all other cells untouched; normalization preserved (±δ cancel), marginals stay Poisson.
- ρ estimated from data (per-league or pooled top-5 with UEFA handled separately or pooled — decision point), recorded per snapshot in the evidence chain with estimation window and N. ρ=0 remains a reproducible baseline toggle.
- Ship with an out-of-sample backtest on the existing rolling-origin harness: Brier/log-loss delta for 1X2 (esp. draw), O/U 0.5/1.5, BTTS, exact score.

**User-visible states:** methodology card updated: "low-score correction active, ρ=… (estimated on N matches, window …)"; forecast evidence chain shows correction applied; version bump visible in model version columns.

**Edge cases:** **ρ bounds** `max(−1/λ,−1/μ) < ρ < min(1/(λμ),1)` — τ must stay strictly positive or probabilities break (τ=0 → log-likelihood collapses); ρ is league/data-dependent, not a universal constant — don't hard-code one "football ρ"; **O/U 2.5 does not move at fixed λ,μ** (all four corrected cells are under 2.5 and net to zero) — do not claim improvement there; O/U 0.5/1.5, BTTS and draw *do* move (+0.7pp draw typical); applying τ post-hoc vs refitting λ,μ with τ active gives different results — pick one, document it.

**Honest-failure states:** if backtest shows no out-of-sample improvement for a market, publish that ("DC improves draw calibration, neutral on O/U 2.5") — a better in-sample fit is not a betting edge, and the model card must not imply one.

**Notes:** Fits the platform's transparent-model philosophy: four explicit cells, one parameter, fully explainable. Prerequisite ordering: DC changes raw probabilities → calibration (Feature 5) should be fitted *after* DC settles, or its layer will re-fix errors that no longer exist.

---

### 7. CLV price diary (forecast-time price + closing price)

**Category:** Differentiator (professional-grade process metric) · **Complexity:** MEDIUM

**Expected behavior:**
- Every odds entry already carries a timestamp (forecast-time price). Add a **kickoff-cutoff capture job**: at a defined cutoff (e.g., T−15min or at kickoff) snapshot the closing price for each tracked line — but odds are *manual* on this platform, so closing price must be (a) the last manually entered book price before cutoff, (b) optionally an operator-supplied close, or (c) absent. **Absent is a first-class state.**
- CLV = taken odds ÷ **fair (de-vigged) closing odds** − 1. De-vig the close before comparison — raw comparison inflates CLV by several points. Same-line comparison only.
- Per-entry diary rows (taken price, close, CLV, captured-at timestamps) + aggregates (mean CLV, N, by market/period) behind the same sample-size honesty gates used for ROI.

**User-visible states:** CLV computed (+x%); **closing price unavailable — no comparable close captured** (fail-closed, consistent with the existing CLV fail-closed behavior); line moved / not comparable (differs from taken line); close stale (captured too early to be meaningful); aggregate panel hidden below N entries.

**Edge cases:** de-vig method consistency with existing no-vig normalization; entries created *after* cutoff (no forecast-time price → CLV impossible); timezone/kickoff scheduling failures (capture job retries — idempotent, deterministic job ID); closing capture for markets with no manual book at that moment; comparing own book's close vs a "sharp" close — this platform has one book, so document that CLV here measures *price captured late*, a weaker proxy than sharp-close CLV (honest framing, deferred MODEL-03 licensed feeds remain out of scope).

**Honest-failure states:** never synthesize a closing price from the forecast-time price; never compute CLV against the same row you took (meaningless); display "CLV unavailable" rather than 0%; aggregate CLV over 10 entries is not a skill claim — show N.

**Notes:** CLV is widely treated as the least-noisy skill metric (better early indicator than ROI), judged over 100+ bets. This feature is where "measured, not claimed" becomes user-visible — but its value depends entirely on honest unavailable states given manual odds entry.

---

### 8. New markets: Asian handicap (quarter lines/push) + exact score

**Category:** Differentiator (AH is table-stakes-adjacent for sharp-focused tools; exact score is differentiator) · **Complexity:** HIGH

**Expected behavior:**
- **Derivation:** both markets come from the *same frozen score matrix* in existing immutable snapshots — no new model, no new provider calls. Exact score: `P(i−j)` directly (with DC-adjusted cells once Feature 6 ships). Asian handicap: sum matrix mass over scorelines by handicap-adjusted outcome.
- **AH settlement semantics (must be exact):** whole-ball lines (0, 1, 2…) → push/refund on handicap tie; half-ball lines (±0.5, 1.5…) → never push, win/loss only; **quarter lines (0.25, 0.75) split the stake across two adjacent half-lines** → five P&L outcomes: full win, half win, half-push (half refunded), half loss, full loss. Settlement rules are versioned already — AH rules extend that versioned set.
- **AH probability/EV nuance:** the AH book is two-way but push is possible, so `EV = p_win × odds − 1` is wrong for whole/quarter lines — EV must account for the refunded (push) portion. Fair-odds display should show win probability, push probability, and push-adjusted fair price explicitly.
- **Exact score UX:** probability heatmap over a truncated grid (0-0…5-5/6-6) with tail mass aggregated to "other"; books typically quote 10–14 selected scorelines, so value gates operate on the quoted subset with its own overround cap.
- Odds entry extended per market; existing value gates (threshold, overround cap, lineup freshness) apply unchanged; settlement + Brier/log-loss extended per market with the existing sample-size honesty gates — a brand-new market starts with **"no settled history yet"**.

**User-visible states:** probabilities + fair odds per line/score; supported-line set shown (unsupported line rejected at entry, not silently mis-settled); settlement states incl. **push (stake returned)** and **half-win/half-loss**; per-market "settled sample: N — below reporting threshold".

**Edge cases:** quarter-line split arithmetic (off-by-one here silently corrupts bankroll accounting); DC correction interacts with exact score (it exists *for* these low cells — ship Feature 6 first or document independence); matrix truncation tail mass visible, not renormalized away silently; BTTS/O/U/1X2 consistency checks (marginals of the matrix must match existing markets — property-test this); scoreless/abandoned match settlement rules.

**Honest-failure states:** do not present exact-score longshots with hot-state framing (a 12.0 "top pick" is variance bait — display probability alongside odds, cap entry via existing gates); AH "draw eliminated" must not be framed as "no draw risk" (push ≠ win); exact-score calibration honestly reported (this market is the hardest to calibrate — expect wide reliability buckets).

**Notes:** Both markets are computable from shipped artifacts — high value per unit of new machinery, but settlement correctness is unforgiving. Combined with calibration (Feature 5): each new market gets its own calibration state.

---

### 9. Consolidated 7-day value-candidate scanner

**Category:** Table stakes (core user journey aggregated) · **Complexity:** LOW

**Expected behavior:**
- One page: **all** value candidates with kickoff in the next 7 days across all markets/competitions, sorted by configurable key (edge, confidence, freshness). Rows link to the fixture's forecast + odds receipt.
- Default sort opinionated: edge descending, but stale candidates demoted (freshness penalty) rather than buried — a 6% edge on 12-hour-old odds is not the top row.
- Filters: competition, market, min edge, min lineup freshness; filter state visible.

**User-visible states:** candidate count; **honest empty state** ("no candidates passed gates in next 7 days" — distinct from "data unavailable"); partial state when a competition is in limited/stale data mode (its fixtures excluded or flagged); per-row freshness age.

**Edge cases:** same fixture + market has one receipt (receipts are canonical — dedupe is automatic if receipts are the source); odds updated after receipt generation (show receipt-time value, flag "odds since updated" if a newer entry supersedes); 7-day window boundaries in UTC vs local kickoff display; tie-breaking deterministic (edge → kickoff → id); pagination/infinite scroll on mobile.

**Honest-failure states:** never show candidates that failed gates (overround cap, freshness, value threshold) — the scanner is a *view over passed receipts*, not a re-computation with looser rules; if the underlying forecast is stale, the row carries the stale badge rather than hiding it.

**Notes:** Pure aggregation over existing value receipts → cheapest feature on the list, but the highest user-visible leverage: today the journey requires visiting fixtures one by one. Differentiator via *honesty* (competitors' scanners are driven by live feeds and urgency UX; this one shows gates and freshness explicitly).

---

### 10. Paper-trading journal (operator-gated, virtual)

**Category:** Differentiator (process validation without wagering — strongest RG alignment) · **Complexity:** MEDIUM

**Expected behavior:**
- Operator records virtual bets from value receipts (one-click prefilled: market, odds, edge, recommended stake) with explicit **stake mode: flat-unit or Kelly fraction** (Kelly computed at entry from forecast probability + odds; recorded, not re-computed later).
- Settlement happens automatically from existing settlement pipeline; **push/void handled** (AH pushes return stake — excluded from ROI denominator, not counted as loss).
- Analytics: bankroll curve (virtual, starting bankroll configurable), units staked/won, **ROI = settled profit / settled stakes (pending and voided excluded — same rule as existing yield accounting)**, yield, current/max drawdown (peak-to-trough), win rate, average odds, longest losing streak, split series flat vs Kelly, per-market breakdown, optional CLV column per row (Feature 7 enhancement).
- Sample-size honesty gates reused: metrics below N settled bets shown as insufficient-sample, not as headline numbers.

**User-visible states:** bet list with pending/settled/void/push states; strategy series (flat vs Kelly) as separate curves; drawdown now vs max; "virtual bankroll — no real money" persistent label; empty journal state.

**Edge cases:** editing/deleting a recorded bet (append-only adjustment preferred — audit consistency with platform's immutable philosophy); mid-history bankroll resets/adjustments (record as explicit events, don't rewrite curve); Kelly stake using stale probability (tie to snapshot version at record time); settling AH half-win/half-loss correctly (depends on Feature 8); ties between receipt update and recorded odds.

**Honest-failure states:** never phrase results as "you would have won" without denominators and sample context; negative ROI must render without alarm framing *and* without sugar-coating; drawdown is a fact, not a warning siren; no "hot streak" gamification, no leaderboard, no persistence to public views.

**Notes:** This is the platform's answer to "does my process actually work?" without violating the no-automatic-wagering constraint. It closes the loop: receipts → journal → CLV → settlement metrics, all virtual.

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features users (and the operator) assume exist. Missing these = product feels incomplete or unsafe.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| CI pipeline (#1) | A production monorepo without CI is untrusted; every later feature needs it as a gate | LOW | Frozen lockfile, service containers for integration tests; foundation for #4 gating |
| Backups with verified restore (#2) | Losing the prediction/odds history destroys the platform's core promise (measurable, reproducible) | MEDIUM | Restore drill ≠ integrity check; "never verified" must be a visible non-green state |
| Degradation alerting (#3) | Free-tier providers and background jobs fail silently — BullMQ failures never crash anything | MEDIUM | Quota / dead-letter / 5xx families; unknown ≠ healthy; feeds ops center |
| Performance audit + fixes (#4) | Fixture detail is the primary analytical page; slow = unusable on mobile | MEDIUM | Measure before/after; optional Lighthouse CI gate on top of #1 |
| 7-day value scanner (#9) | The product's core journey (find value) is buried per-fixture today; aggregation is expected | LOW | View over passed receipts only; honest empty state; freshness demotion |

### Differentiators (Competitive Advantage)

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Calibration + versioned rollback (#5) | "Calibrated, and we publish the reliability diagram and rollback when it regresses" — almost no free tool does this visibly | HIGH | Platt-first (small N), isotonic later; sum-1 renormalization for 1X2; min-N gates on rollback |
| Dixon-Coles correction (#6) | Transparent, explainable low-score fix; directly improves draw/low-total/exact-score calibration feeding #8 | MEDIUM | ρ bounds enforced; no claimed effect on O/U 2.5; backtested on existing harness |
| CLV price diary (#7) | The professional process metric, with fail-closed unavailable states instead of fabricated closes | MEDIUM | De-vig the close; same-line only; aggregate gates on N |
| Asian handicap + exact score (#8) | Both derive from frozen score matrix — new markets with zero new data cost | HIGH | Push/half-win/half-loss settlement correctness; push-aware EV; per-market sample gates |
| Paper-trading journal (#10) | Validates the whole loop without wagering — strongest possible fit with the RG constraint | MEDIUM | Flat + Kelly series; push-aware ROI denominators; append-only bet edits |

### Anti-Features (Commonly Requested, Often Problematic)

| Anti-Feature | Why Requested | Why Problematic | Alternative |
|--------------|---------------|-----------------|-------------|
| Auto-betting / odds execution integration | "Scanner should act on the edge" | Out of scope by decree; changes legal/security scope; destroys analytical neutrality | Journal records virtual bets from receipts (Feature 10) |
| Urgency framing on scanner rows ("odds dropping, act now!") | Competitor scanners use it for engagement | Directly violates RG constraint (urgency + implied certainty); manual-odds freshness makes urgency *dishonest* | Freshness age shown neutrally; stale rows demoted, not sensationalized |
| Fabricated/synthesized closing prices | CLV looks broken with too many "unavailable" rows | Invented data poisons the "measured, not inferred" core value | Fail-closed "closing price unavailable" (existing CLV gate philosophy) |
| Auto-rollback on tiny Brier deltas | Automation sounds rigorous | N=40 regression is variance; churn erodes version comparability | Min-sample threshold + margin-gated rollback, logged with numbers |
| Calibrating on whatever settled data exists (incl. fitting data) | Faster to ship | Severe overfitting; leakage invalidates backtests | Held-out fit window, versioned layer, before/after published |
| Backup theater (dump job + "✓ Backups enabled") | Looks like ops maturity | Corrupt/never-restored backups discovered during the disaster | Restore drill with recorded evidence (Feature 2 core requirement) |
| Lighthouse 100/100 chasing | Shiny badge | Undermines UX (e.g., eager-loading all chart JS) to game a metric | Core Web Vitals budgets + honest before/after deltas |
| Exact-score "top picks" highlighting / gamified hot streaks in journal | Engagement | Longshot/variance bait; certainty-adjacent framing | Probability always shown beside odds; flat stats with sample gates |
| Paging on every individual job failure | "Be notified of everything" | Alert fatigue → real incidents ignored | Aggregate rates/windows; severity tiers (Feature 3) |

## Feature Dependencies

```
[1 CI] ──enables──> [4 Lighthouse gates]
   └──enables──> [2 restore drills in pipeline] ──feeds──> [3 alerting]

[6 Dixon-Coles] ──required-before──> [5 Calibration] ──gates──> [5 rollback]
        └──enhances──> [8 Exact score]

[7 CLV diary] ──enhances──> [10 Journal] (CLV column per bet)
[8 New markets] ──required-before──> [10 Journal] (push/half-loss P&L correctness)
[8 New markets] ──enhances──> [9 Scanner] (more candidate rows)
[9 Scanner] ──view-over──> [existing value receipts]
[10 Journal] ──one-click-from──> [9 Scanner / value receipts]

[3 Alerting] ──consumes──> [existing ops center, BullMQ, provider budgets]
```

### Dependency Notes

- **#6 before #5:** Dixon-Coles changes raw probabilities; fitting calibration on pre-DC outputs then shipping DC silently invalidates the fitted layer. Model change → then calibrate → then rollback gating.
- **#8 before #10:** the journal must settle AH half-win/half-loss and push refunds correctly; recording AH bets before settlement semantics exist corrupts the bankroll curve.
- **#1 before #4 (gating):** the audit itself can run standalone, but *asserted* budgets need CI first. #1 also hosts #2's scheduled verification run.
- **#3 consumes existing infrastructure:** provider budget counters, BullMQ, API error logging all exist — alerting is evaluation + surfacing, not new data collection. #2's verification results are one of its inputs.
- **#7 → #10 enhancement, not blocker:** journal ships without CLV; the CLV column fills as closing captures accumulate.
- **#9 is dependency-light:** pure read aggregation — can ship early for quick user-visible value, or late to include #8's markets. Conflicts: none; it must *not* re-run value gates with looser rules than receipts.

## Milestone Definition (v1.1)

### Launch With (must ship)

- [ ] #1 CI pipeline — everything else lands behind it
- [ ] #2 Backups + verified restore — before production staging/live usage
- [ ] #3 Degradation alerting — providers/jobs fail silently today
- [ ] #9 7-day scanner — cheapest highest-leverage user-visible win
- [ ] #6 Dixon-Coles — model change must precede calibration

### Add After Validation (within milestone)

- [ ] #5 Calibration + rollback — trigger: DC shipped and a settled evaluation window exists
- [ ] #7 CLV diary — trigger: scheduled cutoff-capture job proven idempotent
- [ ] #4 Performance fixes — trigger: baseline audit recorded (before/after discipline)
- [ ] #8 AH + exact score — trigger: backtest of DC-adjusted matrix; settlement tests pass

### Future Consideration (v2+ / deferred)

- [ ] Licensed closing-line feeds for true sharp-close CLV (MODEL-03, already deferred) — improves #7's proxy
- [ ] Isotonic layer upgrade — trigger: ≥1,000 settled predictions per market
- [ ] Shin/power overround methods (MODEL-02) — affects #8 fair-odds precision
- [ ] CI remote caching / affected-only runs — only when CI time becomes a problem

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| #1 CI pipeline | MEDIUM (indirect) | LOW | P1 |
| #2 Backups + restore verification | HIGH (existential) | MEDIUM | P1 |
| #3 Degradation alerting | HIGH | MEDIUM | P1 |
| #4 Lighthouse audit + fixes | MEDIUM | MEDIUM | P2 |
| #5 Calibration + rollback | HIGH (core value) | HIGH | P2 |
| #6 Dixon-Coles | MEDIUM-HIGH | MEDIUM | P1 (precedes #5) |
| #7 CLV diary | HIGH (process metric) | MEDIUM | P2 |
| #8 AH + exact score | HIGH | HIGH | P2 |
| #9 7-day scanner | HIGH (core journey) | LOW | P1 |
| #10 Paper-trading journal | MEDIUM-HIGH | MEDIUM | P2 |

**Priority key:** P1: foundational / ship first · P2: within-milestone, dependency-ordered · P3: future.

**Implied phase grouping (for roadmap):** (a) Foundations: #1 → #2 → #3 · (b) Performance: #4 · (c) Model quality: #6 → #5 · (d) Value experience: #7 → #8 → #9 → #10. Groups (b) and (c) are parallel-safe; (d) partly depends on (c) via exact-score matrix quality.

## Competitor Feature Analysis

| Feature | BetTheDrop / CLV tools | Value scanners (OddsJam-type) / Bet Journals (BetJournal, Metricroll) | Our Approach |
|---------|------------------------|--------------------------------------------------------------------------|--------------|
| CLV tracking | Core feature; fair (de-vigged) close, published 30-day CLV, treats CLV > ROI as skill metric | Journals show CLV trend after 50+ bets | Diary with fail-closed unavailable states; no licensed close feed → honest "captured-late price" proxy, documented as weaker (MODEL-03 deferred) |
| Value scanner | Alerts against sharp moves (urgency-native) | Real-time multi-book scanning vs Pinnacle close, EV in seconds | View over our own receipts: gates + freshness + confidence visible; no urgency framing; manual-odds reality stated |
| Calibration | Rarely published; some marketing claims | Almost never shown | Versioned per-market layers, reliability diagram + before/after Brier + logged rollbacks in the public model card |
| Paper journal | Tracker apps: ROI/drawdown/CLV, tilt detection | Flat vs Kelly rarely split into separate curves | Virtual-only, operator-gated, split strategy series, sample-size gates, RG-persistent labeling |
| Dixon-Coles / score matrix | Calculators (ImpliedScore, FootInsights) explain τ and league-ρ presets | N/A | Integrated into frozen snapshots with ρ provenance + out-of-sample backtest — not a standalone toy calculator |
| Restorable backups / CI / alerting | N/A (not differentiating publicly) | N/A | Table stakes executed with visible verification evidence in ops center |

**Positioning note:** competitors run on live paid odds feeds; our manual-odds model makes *freshness and unavailable states* the differentiating surface — features must be honest about that gap rather than mimicking real-time urgency UX.

## Sources

- ImpliedScore — Dixon-Coles model reference (τ formulas, ρ bounds, estimation, limitations) — https://impliedscore.com/dixon-coles-model/ — MEDIUM (deep fetch, corroborated by footinsights/statsultra/metricgate snippets)
- MetricGate — Calibration: Isotonic & Platt Scaling (method choice, sample-size thresholds, Brier/ECE before-after reporting, leakage warning) — https://metricgate.com/docs/calibration-isotonic-platt/ — MEDIUM (deep fetch, corroborated by Niculescu-Mizil/Caruana snippet via praveentn.live, arxiv 2509.23665, kdnuggets)
- BetTheDrop — Closing line value explained (CLV formula, de-vigged close, honest unreliable-close cases, sample guidance) — https://www.betthedrop.com/learn/closing-line-value — MEDIUM (deep fetch, corroborated by 10+ CLV guides in search: sportsbettingdime, thelines, oddsjam, evstrike)
- Asian handicap settlement semantics (whole/half/quarter lines, push, half-win/half-loss) — arbworld.net/info/handicap-outcomes-explained, onlinegamblers.org, x33.io, tofiko.com — MEDIUM (consistent multi-source snippets, no deep fetch)
- Betting journal conventions (ROI denominators excluding pending/void, drawdown, units, CLV trends) — betjournal.io, best-bookies.io, betmath.online, metricroll.com — MEDIUM (consistent multi-source snippets)
- Value scanner behavior (edge sorting, sharp-close benchmark, EV-before-disappearance) — valuebetfactory.com, sports-ai.dev, evkings.io, sportsbetedge.com — MEDIUM (snippets)
- Turborepo official GitHub Actions guide + pnpm monorepo CI templates — turborepo.dev/docs/guides/ci-vendors/github-actions, github.com template repos — MEDIUM (official-source snippet; context7/ctx7 CLI unavailable in this environment)
- PostgreSQL backup verification / restore drills — dev.to/piteradyson, datrick.com, restoreproof.io, runbook.academy — MEDIUM (snippets)
- BullMQ production monitoring & failed-set-as-DLQ — docs.bullmq.io/guide/going-to-production, piperadar.dev, dev.to/piperadar, task-queues.com — MEDIUM (official-doc snippet + corroborating guides)
- 5xx / error-budget alerting (multi-window burn rate) — Google Cloud SLO alerting docs, web-alert.io — MEDIUM (official-doc snippet)
- Lighthouse CI budgets + Core Web Vitals assertions — unlighthouse.dev, qaskills.sh, nextjs.org/learn/seo/lighthouse — MEDIUM (snippets)
- Model versioning & rollback (production aliases, health-triggered rollback, rehearsal) — dev.to, oneuptime.com, databricks developers — MEDIUM (snippets)
- Exact/correct score from Poisson matrix — impliedscore.com, footinsights.com, gamblingcalc.com — MEDIUM (snippets, consistent with Dixon-Coles source)

**Research-method note:** built-in web search returned no results in this environment and Brave key was absent; findings were gathered via DuckDuckGo HTML search through webfetch plus three deep page fetches, then cross-checked across independent sources per topic (confidence seam: verified websearch = MEDIUM). All 12 digests cached in the research store.

---
*Feature research for: Football Prediction & Value Betting Platform (v1.1)*
*Researched: 2026-10-19*
