# Pitfalls Research — v1.1 Feature Additions

**Domain:** Football prediction and value-betting analytics platform (bet-stats)
**Researched:** 2026-10-19
**Confidence:** HIGH (grounded in the shipped v1.0 schema and infra; external claims verified against official runner/testcontainers documentation and the Dixon-Coles literature)
**Scope:** Pitfalls specific to *adding* the ten v1.1 features to the existing system. The v1.0-era pitfall catalog (leakage, identity corruption, quota exhaustion, RG-by-copy) remains valid and is preserved in git history at commit `8655694`; the most important carry-overs are restated in condensed form at the end. All phase references use workstream names because the v1.1 roadmap does not exist yet — see Pitfall-to-Phase Mapping for the recommended ordering.

System facts this document relies on (verified in the repo): `ForecastSnapshot` is append-only with supersession chains and a unique key over `(fixtureId, kind, cutoff, modelHash, configHash, inputHash, evidenceFingerprint, …)`; `ValueReceipt` links `forecastSnapshotId` + `oddsSnapshotId` with its own supersession chain; `ClosingOddsObservation` and `ValueSettlement` (with `clvStatus/clvReason/clvPolicyVersion`) already exist; `SettlementReceipt` carries `policyVersion/policyHash` and lifecycle/scoreability classes; `ForecastScore` carries `modelVersion` and `formulaVersion/formulaHash`; `ResultVersion` is itself versioned. No `.github/` directory exists yet; `infra/docker-compose.yml` runs `postgres:18.6-alpine` with `POSTGRES_PASSWORD` from env; `infra/.env` is gitignored; an operator gateway (`infra/operator-gateway/`) fronts the operator contour. The dev host is Windows; user-facing text must be Russian.

## Critical Pitfalls

### Pitfall 1: CI that is green on one OS and fiction on the other

**What goes wrong:**
The GitHub Actions pipeline passes on `ubuntu-latest` while the Windows dev host's `pnpm test` fails (or vice versa). Worse: integration tests are quietly skipped in CI because Testcontainers cannot start Docker — GitHub-hosted **Windows** runners do not support container operations at all (`actions/runner#904`: "Container operations are only supported on Linux runners"; the `windows-2025` image additionally breaks Testcontainers even when Docker is present — `testcontainers/testcontainers-node#1093`), so a CI matrix entry that runs the DB suite on Windows fails or, if misconfigured, "passes" without ever executing it. Meanwhile `pnpm install --frozen-lockfile` flakes because Corepack/pnpm versions drift between dev machine and runner, or CRLF normalization rewrites the lockfile.

**Why it happens:**
Dev happens on Windows, CI runs on Linux, and nobody declares which artifacts are OS-sensitive. Lockfile, generated Prisma client, and line endings are treated as machine-local instead of contract.

**How to avoid:**
- Run the **full suite (unit + Testcontainers integration) only on `ubuntu-latest`**; the Windows runner (if kept in the matrix at all) runs typecheck/lint/unit only — never anything needing Docker.
- Pin Node via `engines` + `.nvmrc` and pin pnpm via `packageManager`/Corepack so frozen-lockfile behavior is identical everywhere; commit a `.gitattributes` with `* text=auto eol=lf` and `*.lock`/`*.prisma` binary-safe rules.
- Cache `~/.pnpm-store` and the generated Prisma client keyed on `schema.prisma` hash; always run `prisma generate` before typecheck (types are generated, not committed).
- Run `prisma migrate validate`/`migrate deploy` against a service-container PostgreSQL in CI, and make CI a required status check via branch protection — a pipeline nobody is forced to pass is decorative.
- CI must never call live football providers (see Pitfall 13); use fixtures/mocks.

**Warning signs:**
`--frozen-lockfile` passes in CI but lockfile diffs appear on every dev pull; integration job duration ≈ 30 s (nothing ran); Windows-only type errors reported as "CI is fine"; tests skipped via `describe.skip` when `docker` is absent, with no failing signal.

**Phase to address:**
CI phase (first v1.1 phase — every later phase depends on this safety net).

---

### Pitfall 2: Backups that exist but cannot restore, and an RPO that silently loses irreplaceable facts

**What goes wrong:**
A cron job dumps `pg_dump` to a volume on the same Windows/Docker host; retention rotates files away; nobody ever restores. The first real restore fails (version mismatch, missing globals) or succeeds but yields a database whose append-only chains (`ResultVersion → SettlementReceipt → ForecastScore → ValueSettlement`, `supersedes*Id` graphs) are truncated mid-window, destroying the audit history that is the product's core value. Unlike a typical web app, *this* database cannot be reconstructed from users — immutable receipts and closing-odds observations exist nowhere else. A daily dump also means up to 24 h of irreproducible snapshots.

**Why it happens:**
"Backup" is conflated with "dump file exists." Verification is a file-exists check. Dump tooling versions drift (`pg_dump` 19 cannot restore into PostgreSQL 18; the compose file pins `postgres:18.6-alpine`). `-j` parallelism with plain SQL format produces per-table dumps taken at *different* snapshots. Roles/globals are forgotten. Redis is backed up as if it mattered (it is disposable coordination; PostgreSQL is the only source of truth).

**How to avoid:**
- Dump with the **server-matched major client** (`postgres:18.6-alpine` image, `pg_dump -Fc` custom format or `-Fd` directory format if using `--jobs`); never split plain-format dumps.
- Store backups **off-host** (object storage or a second machine); a backup on the same volume as the primary is a copy, not a recovery plan. Keep credentials out of compose files — reference `${BACKUP_…}` env vars, `infra/.env` stays untracked (already the case — keep it that way; do not commit real values in a `.env.example` either).
- **Restore verification is a scheduled job, not a chore:** weekly, spin a throwaway container on the *same image version*, restore, then assert: table row-count sanity, `prisma migrate status` clean, and referential integrity of supersession chains (no orphan `supersedes*Id`, no broken receipt→snapshot links), plus spot-check a known fixture's full chain from `ForecastSnapshot` to `ValueSettlement`. Record the result; make failure alert-worthy (Pitfall 3).
- Define RPO/TTL deliberately: a **transactional log shipping or WAL archiving** option if losing a day of manual odds/receipts is unacceptable; otherwise document that the daily dump is the accepted RPO. Prune Redis from the backup scope entirely.
- Schedule from inside a container/cron service, not Windows Task Scheduler, so the dev host's sleep/updates don't silently stop backups; monitor "last successful backup age," not just "backup ran."

**Warning signs:**
Backup file size identical week over week (job writes to a full disk or same path); restore never attempted since launch; `pg_dump` version in the script ≠ compose image tag; backup volume is the named `postgres_data` volume's sibling directory; retention keeps N files but the oldest verified restore is "none."

**Phase to address:**
Backups phase (before any phase that changes the schema or model code — that is when a bad migration becomes unrecoverable).

---

### Pitfall 3: Alert fatigue, secret leakage in alert payloads, and free-tier delivery that silently stops

**What goes wrong:**
Every BullMQ retry and every transient 429 pages the operator; within a week all alerts are ignored, and the one that matters (provider quota exhausted → EL/UECL have *no fallback*, or worker dead → no forecasts before kickoff) is drowned. Alternatively, alert messages embed provider request context — and API keys ride in headers/URLs and raw payloads, so the alert channel (email, Telegram, webhook log) becomes a secret exfiltration path. Or delivery itself fails silently: free-tier email (SendResend/SMTP) hits rate limits, webhook tokens expire, and the alerting system never alerts on itself.

**Why it happens:**
Alerting is added as "log line → notification" without severity tiers, dedup, or a message-sanitization contract. Payload builders reuse the same JSON that `SourceObservation` raw audit stores — which is correct for audit storage but wrong for messages.

**How to avoid:**
- Define **severity tiers with explicit semantics**: `info` (recorded, no notification), `warning` (digest), `critical` (page). Page only for: provider quota exhausted or <10 % reserve with live fixtures pending, worker heartbeat missing past N intervals, 5xx/exception-rate SLO breach, last-backup age exceeded, restore-verification failure, migrations/schema drift. Everything else (single job retry, single 429 that was honored) is a metric, not a message.
- **Dedup + cooldown:** one alert key per (`severity`, `resource`) with a suppression window (e.g., 6 h for warnings, auto-acknowledge for recovered conditions); alert on *state transitions*, not on every observation. Escalate `warning → critical` only if the condition persists across two evaluation windows.
- **Sanitization contract:** alert payloads are built from a typed DTO allowlist (ids, counts, timestamps, enum states) — never from raw provider payloads or config objects; run a redaction unit test that feeds a fixture containing fake keys/tokens through the alert builder and asserts they do not appear.
- **Delivery health:** a weekly synthetic alert through the real channel; count sent vs bounced; treat delivery failure as `critical`. Prefer one durable channel (e.g., a webhook to a self-controlled endpoint) over several half-configured ones; keep the operator contour's alert history page as the system of record so a missed email is not a missed fact.
- All alert-facing text follows the Russian-language convention and avoids certainty framing ("прогноз мог ухудшиться" not "прогноз неверен").

**Warning signs:**
Operator mutes the channel; >20 alerts/day; alert history shows the same key hundreds of times; a message contains a URL, header dump, or `sourceRefs` blob; nobody can name the last alert that changed a decision.

**Phase to address:**
Alerting phase (after Backups — backup/restore verification is a prime alert source; before model-quality phases so Dixon-Coles/calibration rollouts are observable).

---

### Pitfall 4: Chasing synthetic Lighthouse scores while the real page gets slower

**What goes wrong:**
CI runs Lighthouse and gates on a "performance ≥ 90" score. Scores flap ±10 points run-to-run on throttled synthetic mobile, the gate becomes a rerun-until-green ritual, and the actual regression it was meant to catch (Recharts bundles and the fixture-detail page's client-side rendering growing with data) ships anyway. Meanwhile the numbers have no relationship to field performance because there are no real-user metrics.

**Why it happens:**
A single composite score is legible; LCP/TBT/JS-bytes budgets are not. Synthetic single-run Lighthouse variance (CPU throttling, CDN jitter for lab assets) is underestimated. The v1.0 stack already carries Recharts 3.8 client-side; new scanner/calibration pages will pull chart code into more routes.

**How to avoid:**
- Gate on **specific audits with headroom**, not the composite: total JS bytes per route, LCP, TBT, CLS, with thresholds set from a 7-run median baseline + generous band (e.g., +15 %), and `assert.assertMatrix`/median-of-3 runs in `lhci` to cut noise. Treat absolute score as a dashboard number, never a merge blocker.
- Run Lighthouse in CI **only for the routes that exist and matter** (fixture detail, scanner once built) against a **seeded local build with mocked data** — never against live providers (Pitfall 13).
- Structural fixes beat score-chasing: dynamic-import Recharts per chart component so the scanner route doesn't inherit calibration-chart code; keep server-side data fetch (App Router RSC) and hydrate only charts/interactive filters; set a Next.js bundle budget in the build.
- Acknowledge limits in the methodology card: synthetic lab scores are not field data; if/when traffic justifies it, add CrUX or lightweight RUM later — do not present lab numbers as user experience.

**Warning signs:**
Reruns to get a green Lighthouse; score changes with no code diff; "performance" improves while bundle bytes grow; the same chart library loaded on routes without charts; LCP dominated by client-side data waterfalls.

**Phase to address:**
Performance-audit phase — placed **before** the Scanner and New-markets UI phases so the bundle/rendering budget exists when those pages are built, not after.

---

### Pitfall 5: Calibration fitted on the evidence it is graded on, and applied by mutating frozen snapshots

**What goes wrong:**
Isotonic/Platt calibrators are fitted on the pool of settled `ForecastScore`s and then post-calibration Brier is reported *on that same pool* — isotonic regression makes in-sample reliability near-perfect by construction, so the "improvement" is an artifact. Per-market *per-league* cohorts are tiny (a season of one league ≈ 300+ fixtures × 3 1X2 classes ≈ still small for isotonic's step function), producing degenerate staircase calibrators that map everything below the median to a constant. The tempting implementation shortcut — write calibrated probabilities back into `ForecastMarket.probabilities` — retroactively rewrites the record of what the model said, violating the immutability that `ForecastSnapshot`'s hash-keyed uniqueness exists to protect (and colliding with the unique key's meaning). A later rollback on "Brier regression" then thrashes: each noisy window flips the active calibrator.

**Why it happens:**
Calibration looks like a post-processing utility, but it is a *model component* that must obey the same versioning, leakage, and freeze discipline as the Poisson model. The existing schema separates raw scoring (`ForecastScore.rawChosenProbability/clippedChosenProbability`, `formulaVersion/formulaHash`) but has no home for a calibrator, so developers reach for the probabilities JSON.

**How to avoid:**
- Introduce a first-class **`CalibratorVersion`** entity: `(id, modelVersion, modelHash, configHash, market, league scope, method, fitWindow, fitDatasetFingerprint, minSample, artifact, state)`. Calibrators reference the exact model/config hash they were fitted on — a calibrator fitted on V1-Poisson snapshots must be *structurally refused* when serving V2/Dixon-Coles snapshots (see Integration Gotchas).
- **Never mutate snapshots.** Calibrated probability = `f_calibrator(raw)` computed at read/scoring time or stored in a derived, rebuildable score layer; `ValueReceipt.modelProbability` stays raw, and any displayed calibrated value names its calibrator version.
- **Leakage-free fitting:** fit only on forecasts whose `cutoff < kickoff` and whose settlement completed before `fitWindow.end`; evaluate the calibrator on a strictly later window (rolling-origin), and report Brier/Log Loss deltas with sample sizes per cohort. Enforce a **minimum cohort size** (rule of thumb: ≥ 200 events per class for isotonic; below that fall back to Platt, below that to global/league-level scaling, below that *no calibration* with an honest "недостаточно данных" state).
- **Rollback with hysteresis:** compare on a fixed rolling window with a materiality threshold (e.g., Brier worse by > 2 % relative *and* ≥ 100 events), keep at most one rollback per window, and record every activation/supersession in the calibrator's own supersession chain. Drift detection compares settled-forecast windows only — never in-flight forecasts (lookahead).
- Double-count guard: if Dixon-Coles is active, the calibrator is fitted on DC-produced probabilities; never stack "Poisson→calibrator fitted pre-DC" on top of DC outputs (Integration Gotcha C1).

**Warning signs:**
Post-calibration Brier reported on the fit window; isotonic curve with 4 steps from 40 samples; `ForecastMarket.probabilities` rows updated after `issuedAt`; calibrator selected per-request "whichever scores best today"; calibrated and raw probabilities shown without labels; Brier improving while Log Loss explodes on longshots.

**Phase to address:**
Calibration phase (after Dixon-Coles — calibrators must be fitted on the final model pipeline; after CLV-diary groundwork is irrelevant, but *before* the Scanner so the scanner can display labeled calibrated probabilities from day one).

---

### Pitfall 6: Dixon-Coles sign conventions, unstable fits, and double-counted home advantage

**What goes wrong:**
Three failure modes cluster into one feature. (a) **Sign convention bug:** sources define τ with opposite signs — the modern convention is `τ(0,0)=1−λμρ, τ(1,0)=1+μρ, τ(0,1)=1+λρ, τ(1,1)=1−ρ` with ρ<0 *increasing* 0-0 and 1-1; other summaries (including several blog implementations of the 1997 paper) use `τ(0,0)=1+λμρ …` with the opposite mapping. Fitting ρ under one convention and applying τ under the other inverts the correction — and worse, a ρ fitted on historical data via a library with the other convention is simply the wrong sign. (b) **Fitting instability:** unconstrained optimizers step outside the admissible band `max(−1/λ, −1/μ) < ρ < min(1/(λμ), 1)`, producing zero/negative cell probabilities and a log-likelihood of −∞; per-team attack/defence fits early in a season have ~5 matches of history and swing wildly; fitting decay ξ jointly with parameters inflates the weighted likelihood by construction. (c) **Identity collision with Elo:** the platform's λ,μ already come from Elo + weighted form with a home adjustment; naively applying τ to *Elo-derived* λ,μ with a borrowed league-average ρ is a half-integration that changes all 1X2/BTTS probabilities without a model change, and re-deriving λ,μ from DC attack/defence (which contains its own home factor γ) *plus* the Elo home adjustment double-counts home advantage.

**Why it happens:**
Dixon-Coles is described online as "add a ρ to the Poisson matrix," hiding that it is a full estimation procedure (team parameters, home advantage, ρ, separate decay selection, identification constraints) or, if used as a four-cell correction, that the correction's meaning depends on where λ,μ came from.

**How to avoid:**
- **Pin one convention in code, document it in the model card, and test it:** unit tests asserting (i) the corrected matrix sums to 1 over the truncated grid, (ii) ρ=0 reproduces independent Poisson exactly, (iii) with the documented sign, 0-0 and 1-1 move *up* and 1-0/0-1 *down* for the fitted ρ's sign, (iv) every τ multiplier is strictly positive for the fixture's λ,μ. Any external ρ value is converted to the pinned convention explicitly or rejected.
- Constrain ρ with the admissible band (ε-inside; τ=0 ⇒ −∞ likelihood), constrain attack/defence positive via log-link, impose the identification constraint (e.g., mean attack = 1), and select the time-decay ξ in an **outer loop by out-of-sample 1X2 log loss**, never jointly in-sample.
- Decide the integration explicitly and record it in `modelVersion` + `configHash`: recommended for v1.1 — keep Elo/form-derived λ,μ and treat ρ as a per-league fitted correction with documented provenance, OR move to full DC team parameters; either is defensible, but the **home-advantage factor must exist exactly once** on the path from ratings to λ,μ. A hybrid (Elo λ,μ + DC τ) must be labeled as such in the methodology card, not called "Dixon-Coles model."
- **Bump `modelVersion`/`modelHash` the moment probabilities change.** The `ForecastSnapshot` unique key includes `modelHash` — failing to bump doesn't just break comparability, it lets two different "V1" behaviors coexist under one identity. Keep frozen V1 forecasts untouched; `BacktestPlan/BacktestWindow` must pin the model version they evaluate (see Integration Gotcha C3).

**Warning signs:**
Draw probability *falls* after "the low-score correction"; ρ pinned at the optimizer bound; attack parameters swinging >2× week to week; model card says "Dixon-Coles" while `modelVersion` is unchanged; backtest numbers jump with no data change because the model silently changed under the same version.

**Phase to address:**
Dixon-Coles phase (before Calibration — calibrators must sit on top of the final probability pipeline; before New-markets — Asian handicap/exact-score probabilities must derive from the corrected score matrix, not the old one).

---

### Pitfall 7: CLV diary that records survivorship, fake precision, and hindsight

**What goes wrong:**
The closing-line value diary sounds like one field, but the failure modes are many: closing prices are recorded from whichever book the operator happened to check (survivorship — the "closing line" is then not *the* market close); prices from different bookmakers are averaged or compared despite margin differences that dwarf typical CLV signals; `observedAt` is entered in local time or as kickoff time rather than the true capture instant, corrupting "price N minutes before kickoff"; decimal odds typed to 2 d.p. produce CLV figures like "+0.4 %," which with manual entry precision is noise dressed as signal; and — the sharpest edge — closing prices are (re)recorded *after* results are known, or CLV information is surfaced on the scanner *before* a paper bet is placed, contaminating the decision loop the diary exists to evaluate.

**Why it happens:**
CLV is treated as a settlement field rather than a data-capture discipline. The schema is already right (`ClosingOddsObservation` is a separate append-only entity with `observedAt`, `observationKind`, `sourceConvention`; `ValueSettlement` carries `clvStatus/clvReason/clvPolicyVersion` distinct from settlement `policyVersion`) — the pitfalls are in *behavior* around it.

**How to avoid:**
- Capture rules: closing observations must be appended with a true UTC `observedAt` at capture time, before settlement runs for that fixture; the pipeline refuses a closing observation for a fixture whose `kickoffUtc` has passed (except an explicit late-observation kind, excluded from CLV). No edits — corrections append a new observation and supersede.
- Comparability: compute CLV only when the closing observation matches the receipt's market/selection encoding and `sourceConvention`, and either the same book as the entry price or an explicitly declared comparable-book policy (same margin band); otherwise emit `clvStatus` unavailable with `clvReason` — the fail-closed states already designed into `ValueSettlement` must stay the default, never a fabricated midpoint.
- Precision honesty: report CLV in rounded bands (e.g., «≈ +2 %», «в пределах точности ввода») with the count of comparable pairs; suppress any CLV aggregate below a minimum comparable-pair count; state that entry prices are manual 2-d.p. input.
- Contamination firewall: CLV is **evaluation-only** — never displayed for unsettled fixtures, never an input to the scanner's ranking or to paper-journal decisions; the scanner must not join `ClosingOddsObservation`. A "record closing price" operator action must be blocked (or loudly audit-logged) after kickoff and is never backdatable.
- Backfill honesty: historical closing prices observed after the fact (from archives) must carry `observationKind` = retrospective and be excluded from CLV aggregates — otherwise the diary quietly converts into hindsight.

**Warning signs:**
CLV populated for fixtures that were never watched live; identical `observedAt` timestamps in batches; CLV shown on candidate cards pre-kickoff; aggregates over < 30 comparable pairs; every CLV positive (selection bias — only "good" lines recorded); timezones other than UTC in the capture path.

**Phase to address:**
CLV-diary phase (after Settlement-pipeline hardening — settlement ordering is a precondition — and before Paper-trading, so the journal inherits the same capture discipline).

---

### Pitfall 8: Asian handicap push accounting and exact-score markets breaking settlement or inflating fake value

**What goes wrong:**
Asian handicaps introduce **quarter lines** (e.g., −0.25 = half stake on 0 and half on −0.5), so a single "stake/return/profit" triple — exactly what `ValueSettlement.stakeUnits/returnUnits/profitUnits` stores as scalars — cannot represent a push split without an explicit half-bet model; implementations that round −0.25 to −0.5 or to 0 silently mis-settle pushes. Abandoned/postponed matches route around the existing `SettlementReceipt` lifecycle/scoreability classes into ad hoc "void?" logic, and results revised later (`ResultVersion` supersession) don't propagate to AH settlements. For the 3-way→2-way conversion (1X2 book → home/away handicap), developers reuse the 3-way overround or renormalize inconsistently, and — the deepest trap — **bookmaker overround on exact-score books is far larger and unevenly distributed** (longshots are priced disproportionately badly), so multiplicative no-vig on a 12-score entry produces confident-looking probabilities for 3 % outcomes whose "edges" are pure normalization artifacts. A value gate tuned for 1X2 surfaces a flood of exact-score "value" that is noise with enormous variance.

**Why it happens:**
The existing market pipeline (1X2, O/U 2.5, BTTS) has complete-book validation and settlement rules written for its selection counts; new markets are slotted into the same `market: String` / `selection: String` fields without extending the *rules* those fields imply.

**How to avoid:**
- Extend the domain layer first: canonical selection encoding (line as decimal, side home/away; exact score as `h:a` normalized), a quarter-line **half-bet decomposition** rule (stake split 50/50, per-half settlement including push), and settlement unit tests enumerating whole-line push, quarter-line split-push, and void paths per market.
- Route every new market's outcomes through the existing `SettlementReceipt` lifecycle/scoreability/financial-eligibility classes; abandoned ⇒ void with reason, never a fabricated loss; `ResultVersion` revision ⇒ `SettlementReceipt`/`ValueSettlement` supersession recomputation, same as v1.0 markets.
- 3-way→2-way: renormalize over the **two** outcomes only (remove the third's probability and the overround over the reduced book), never reuse the 3-way overround; derive AH probabilities **from the same (corrected) score matrix** the 1X2 comes from so markets stay coherent (Integration Gotcha C4) — and note Dixon-Coles shifts AH/draw-less markets differently than 1X2 (Pitfall 6).
- Exact score: enforce a **minimum probability floor** (e.g., ≥ 3–5 %) and a separate, higher value-gate threshold with sample-size context in UI; declare multiplicative normalization a documented limitation for longshot-heavy books (Shin/power deferred already in PROJECT.md); keep per-market Brier (`ForecastScore` is already keyed by market) so exact-score quality is measured before any value claims.
- All new market copy, fair-odds labels, and push explanations in Russian, with the persistent RG disclaimer — new markets are not a place to loosen the no-certainty language.

**Warning signs:**
AH settlement returns non-half-unit profits on quarter lines; void matches counted as losses in ROI; exact-score page shows dozens of positive-edge candidates; 2-way overround equals the 3-way number; AH probabilities don't match the score-matrix sum; pushes missing from `ValueSettlement` audit.

**Phase to address:**
New-markets phase (after Dixon-Coles — markets must derive from the corrected matrix — and after Settlement hardening so lifecycle rules exist to reuse).

---

### Pitfall 9: The 7-day scanner becomes a stale "best bets" megaphone

**What goes wrong:**
The scanner aggregates value candidates across fixtures for the next 7 days. Done naively it (a) **recomputes edge outside the immutable `ValueReceipt`** — formulas drift, and the scanner's number no longer matches the receipt that evaluation will score, breaking auditability at exactly the surface users trust most; (b) shows an odds snapshot captured five days ago with its edge as if the price were live ("stale candidates shown as fresh"); (c) orders by edge into a leaderboard — the most predictable RG failure mode, functionally a "top picks" list; (d) runs an N+1 query (latest forecast per fixture × latest odds × scores) that gets slower exactly when the slate is largest.

**Why it happens:**
A scanner page feels like a read model, so it gets built as live computation in a React component instead of as a projection over existing receipts.

**How to avoid:**
- **Read-only over receipts:** the scanner displays `ValueReceipt` rows (linking `forecastSnapshotId` + `oddsSnapshotId`) with their stored edge/EV under the receipt's `policyVersion` — never recompute; if the edge policy changes, new receipts are produced under a new policy version, old rows keep their historical meaning (Integration Gotcha C2).
- Freshness as a first-class column: odds age from `ManualOddsSnapshot.submittedAt`, forecast kind (`INITIAL/PRE_MATCH/LINEUP_CONFIRMED`) and `cutoff`, plus fixture kickoff; auto-mark candidates stale past a configured age and visually demote/exclude them by default with an explicit "показать устаревшие" toggle; degrade to an honest empty/limited state when no candidate is fresh.
- Query shape: one SQL projection (or materialized view) using window functions (`DISTINCT ON (fixtureId …)` / `row_number() over (partition by …)`) over the receipt/odds/fixture join with indexes covering kickoff-within-7-days + receipt creation; batch-load probabilities; no per-row API calls from the client; add an index if the plan shows a seq scan on receipts (the existing `(fixtureId, market, createdAt)` index is not by itself the scanner's access path).
- RG posture: no "лучшие ставки" ranking, no green-profit badges, edge shown with model version, odds timestamp, sample/uncertainty context and the persistent disclaimer; ordering (if any) is by kickoff, not by edge; scanner text is Russian and passes the prohibited-claims test suite extended for this surface.

**Warning signs:**
Scanner edge ≠ fixture page receipt edge; candidates from > 48 h ago displayed unmarked; page load grows linearly with fixtures (N+1); component fetches `/api/fixtures` per row; UI copy contains «топ», «лучшее», «гарантированно».

**Phase to address:**
Scanner phase (after Calibration — labeled calibrated probabilities must be displayable; after Performance audit — the bundle/perf budget is enforced as the page is built).

---

### Pitfall 10: The paper-trading journal drifts into casino semantics, Kelly over-betting, and tamperable history

**What goes wrong:**
A bankroll/units/drawdown/ROI journal inside the operator contour starts to *feel* like a real betting account: «депозит», «вывод», green profit totals, streak counters, and a staking suggestion that people follow literally. Kelly stakes computed from model edge compound the problem — full Kelly on a noisy 3 % edge over-bets, and any operator tendency to "chase" a drawdown in *paper* predicts the exact behavior the RG framework exists to prevent. Meanwhile the journal is just rows an operator UI can edit, so deleting losing bets silently inflates ROI — destroying the evaluation value of the journal and, if these numbers ever surface, making them misleading claims.

**Why it happens:**
Operator-gated features are assumed to be outside RG/UX scrutiny, and a journal is assumed to be a CRUD table. Both are wrong: this product's core value is honest measurement, and the journal is measurement of the *selection process*.

**How to avoid:**
- **Append-only with supersession, like every other receipt:** journal entries reference `valueReceiptId` (no free-floating bets — this also kills selection bias, Integration Gotcha C6), record stake policy + unit definition at entry time, and corrections supersede rather than update; the ROI shown is always recomputable from the entry set. Add a DB-level guard consistent with the existing append-only pattern (repository discipline + mutation-rejection test).
- **Semantics fixed at creation:** units are dimensionless («1 юнит = 1 % банка» declared once), no currency symbols, no deposit/withdrawal verbs; drawdown and ROI always shown with sample size and period; the UI labels the whole contour «Бумажная торговля — симуляция. Реальные ставки не совершаются» persistently, in Russian, next to every aggregate.
- **Kelly is descriptive, fractional, and capped:** display ¼-Kelly at most as an *explanatory* stake under a recorded stake policy (`policyVersion`), never as a recommendation banner, never with urgency; the same no-certainty language rules apply inside the operator contour.
- **Privacy boundary:** paper bets are betting-behavior data. Inside the operator-gated contour with the existing fail-closed privacy retention this is acceptable, but the journal must not leak into public read models, and any future exposure requires the consent path — do not wire journal rows into analytics events casually.
- Evaluation separation: journal ROI measures the operator's picking, not the model; model claims use the frozen-rule candidate population only. Never present journal ROI as model performance.

**Warning signs:**
Editable bet rows; an entry with no `valueReceiptId`; UI vocabulary «депозит/вывод/максимальная ставка»; Kelly % presented as advice; ROI improving when old losing rows "disappear"; journal totals quoted on public pages.

**Phase to address:**
Paper-trading phase (last or near-last — it consumes receipts from Scanner/New-markets and should inherit every discipline built earlier).

---

### Pitfall 11: Immutability eroded one convenience write at a time

**What goes wrong:**
Each new v1.1 feature adds a small exception — calibration "patches" a probability, the scanner "refreshes" a candidate's edge, the journal "fixes" a typo, Dixon-Coles "recomputes" an old forecast — and the append-only guarantee that `ForecastSnapshot`/`ValueReceipt`/`SettlementReceipt` supersession chains provide quietly dies. At that point backtests, Brier trends, CLV, and ROI stop being auditable claims, which is indistinguishable from the product failing its core value.

**Why it happens:**
Immutability was enforced per-v1.0-entity, not as a platform invariant; new entities and new *fields* arrive without the same treatment.

**How to avoid:**
- State the invariant once and enforce it everywhere new: **durable facts are appended; change is expressed as a superseding row with a reason; derived views are rebuildable projections.** Any new table holding a forecast/odds/settlement/entry fact gets: `supersedes*Id` chain or append-only + `policy/formula/model version` columns + a mutation-rejection test in CI.
- Code review gate: reject PRs that `UPDATE` receipt/snapshot tables outside migrations; add a Postgres trigger/permission in the production schema restricting updates on those tables (the v1.0 architecture research already recommended this — implement it in v1.1 now that ten new writers exist).
- Model identity discipline: `modelVersion/modelHash/configVersion/configHash/inputHash` participate in `ForecastSnapshot` uniqueness — every change to Dixon-Coles code, calibrator serving, or market derivation must bump the relevant version/hash or uniqueness means nothing.

**Warning signs:**
`UPDATE forecast_market` in a diff; "temporary" admin edit endpoints; a `createdAt`-only fact table (no version columns); backtest rerun producing different historical Brier; receipt JSON changing without supersession.

**Phase to address:**
All phases — but the DB-level restriction lands in the CI phase (it is testable in CI first) and is re-verified in every subsequent phase.

---

### Pitfall 12: Free-tier API budget consumed by CI, audits, probes, and alert "health checks"

**What goes wrong:**
CI integration tests hit live football providers; nightly "provider health" alert probes call the API just to confirm it answers; Lighthouse runs against a deployment with real data fetch; a scanner rebuild triggers fixture refetches. Each is small; together they burn the API-Football 100/day allowance and starve the critical result/lineup calls — the exact failure the v1.0 atomic budget ledger prevents *inside* the app but not *around* it.

**Why it happens:**
The quota guard lives in the provider policy layer; tooling built outside the app (CI, cron probes, audit harnesses) bypasses it invisibly.

**How to avoid:**
- CI never touches live providers: adapters are faked at the port boundary; recorded raw payloads (already captured for audit) double as test fixtures. If a live smoke test is truly needed, it is a separate, manually triggered, budget-accounted workflow — not part of PR CI.
- Alerting probes check *internal* state (last successful sync age, quota ledger remaining, circuit state, BullMQ heartbeat) rather than calling providers; "can the provider answer" is inferred from real sync outcomes.
- One shared egress discipline: anything that must call a provider goes through the same budget reservation (a dedicated CI/tooling budget bucket), so even a misconfigured job is throttled and observable.

**Warning signs:**
Provider request ledger shows calls from Actions IPs or odd hours; quota exhausted with no user-visible sync gap to explain it; `Retry-After` storms during CI; smoke tests in the default workflow.

**Phase to address:**
CI phase (establish the no-live-calls rule) and Alerting phase (probe design) both.

---

### Pitfall 13: New surfaces ship English, certainty-flavored, or disclaimer-free copy

**What goes wrong:**
Ten features mean dozens of new strings: scanner labels, calibration explanations («откалибровано»), AH push notices, paper-journal vocabulary, alert-facing operator text. Some ship in English (the codebase default), some carry outcome-colored framing («выигрыш», «убыток»), and the persistent RG disclaimer is absent on newly created pages — violating both the project convention (user-facing text in Russian, 2026-10-15) and the RG framework from v1.0.

**Why it happens:**
Copy is treated as polish; the v1.0 prohibited-claims suite covered old screens only.

**How to avoid:**
- Extend the prohibited-claims/prohibited-vocabulary test suite (Playwright + unit-level string scans) to every new surface *in the phase that builds it*: ban «гарантировано», «точная ставка», «топ/лучшая ставка», deposit/withdrawal verbs in the paper journal, and untranslated UI literals in new components (a simple scan for ASCII-only user-visible strings catches most leaks).
- Every new page composes the existing disclaimer/freshness/limited-data components rather than inventing layout; checklist item in every v1.1 phase's verification.

**Warning signs:**
New route renders raw enum values; disclaimer missing on scanner/paper-journal pages; green/red profit coloring without context; Lighthouse/accessibility pass while copy review never ran.

**Phase to address:**
Every phase; explicitly verified in Scanner and Paper-trading phases (highest-risk surfaces).

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Write calibrated probabilities into `ForecastMarket.probabilities` | No new entity/layer | Snapshot immutability broken; audit impossible | Never |
| Recompute scanner edge "just for display" | Faster to build than receipt projection | Display diverges from audited receipts | Never |
| Edit paper-journal rows in place | Simpler CRUD | ROI/journal becomes unverifiable; RG risk | Never |
| Borrow a published league-average ρ without provenance | Skips fitting work | Correction is unexplained noise; model card lies | Only behind an explicit, documented "preset" config version |
| Flat-file `pg_dump` on the same host, verify by file size | Zero infra effort | False recovery confidence | Only as a stopgap *until* the restore-verification job exists — days, not months |
| Alert on every retry/429 | Catches everything | Alert fatigue silences the channel | Never for `critical` tier; acceptable for recorded-only `info` |
| Gate CI on a composite Lighthouse score | Legible number | Flaky gate, rerun culture | Never; audit-level budgets only |
| CLV backfill from post-hoc price archives, unmarked | Instant history | Hindsight-contaminated evaluation | Only with `observationKind = retrospective`, excluded from aggregates |
| Journal stakes suggested at full Kelly | Exciting demo | Over-betting behavior modeled and encouraged | Never; ¼-Kelly descriptive at most |
| Copy 1X2 overround onto AH/exact-score books | One line of code | Systematically wrong fair odds | Never |

## Integration Gotchas (feature ↔ feature)

| ID | Interaction | Common Mistake | Correct Approach |
|----|-------------|----------------|------------------|
| C1 | **Calibration ↔ Dixon-Coles** | Fitting the calibrator on pre-DC forecasts and serving it on DC outputs (or stacking calibrators across model versions) | Calibrator pins `modelVersion`+`modelHash`; serving refuses mismatches; refit after every model bump |
| C2 | **Scanner ↔ ValueReceipts** | Scanner recomputes edge/EV with current formulas instead of reading receipts | Project receipt fields verbatim; policy change ⇒ new receipts, old rows historical |
| C3 | **Dixon-Coles ↔ Backtests** | Comparing V2 (DC) ROI/Brier to V1 history as if continuous; `BacktestPlan` not pinning model version | Pin model/config version per backtest window; keep frozen V1 baseline; label re-baselined series in UI |
| C4 | **New markets ↔ Score matrix** | AH/exact-score probabilities computed from separate ad hoc logic, drifting from 1X2/O-U | All markets derive from the same (DC-corrected, versioned) score matrix; coherence test across markets |
| C5 | **CLV ↔ Settlement ordering** | Closing observation appended after `ValueSettlement` wrote `clvStatus`; result revisions re-run settlement and silently recompute CLV | Pipeline order: capture close → settle → score; CLV depends on prices+kickoff only, so result supersession must preserve existing CLV fields |
| C6 | **Paper journal ↔ Scanner/receipts** | Free-form journal entries not linked to `valueReceiptId` | Every entry names its receipt; journal ROI is therefore reproducible and bias-auditable |
| C7 | **Calibration ↔ Scanner display** | Scanner shows calibrated probability while the receipt's edge used raw — numbers silently disagree | Receipt stays raw+authoritative; scanner labels calibrated values with calibrator version and shows the raw beside it or not at all |
| C8 | **Alerting ↔ Backups** | Restore-verification failures logged but never alerted | Backup-age and restore-verification are `critical` alert keys |
| C9 | **Performance audit ↔ Scanner/New-markets UI** | Chart/analytics code shared into new routes without budget | Dynamic-import Recharts per widget; bundle budget enforced in CI from the performance phase onward |
| C10 | **CI ↔ everything** | Integration suite silently skipped where Docker is missing | Linux-only integration job; missing-Docker state must *fail*, not skip; required check in branch protection |
| C11 | **New markets ↔ Existing settlement comparability** | New-market scoring changes shared `formulaVersion`, invalidating old `ForecastScore` comparability | Bump `formulaHash`; old rows keep old version; aggregates segmented by formula version |
| C12 | **CLV ↔ Paper journal** | CLV of settled bets surfaced in the journal influencing subsequent paper picks | CLV displayed only in evaluation views, never in the decision surface of the journal/scanner |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Scanner N+1 over fixtures × snapshots × odds | Page seconds slower as 7-day slate grows | Single projection query with window functions; precomputed read model | ~50+ fixtures in window (a full PL round + UECL night) |
| Lighthouse/CI running full builds per PR | 15+ min pipelines, flaky caches | Turbo remote/local cache, one Lighthouse job on changed routes only | Immediately; grows with pages |
| Calibrator serving recomputing fits per request | API latency spikes, CPU burn | Fit offline; serve artifact lookup by version key | Any traffic once isotonic is per-cohort |
| Dixon-Coles grid recomputed per market derivation | Slow forecast jobs | One corrected matrix per fixture, cached by `(modelHash, inputHash)`; truncate grid by tail tolerance | Full slate forecast refresh |
| Alert evaluation polling DB per rule per minute | Alert storm load on primary | Single metrics query per evaluation window; in-process aggregation | Tens of rules |
| Backup dump of growing receipt/audit tables on hot path | Lock/CPU pressure during morning sync | Dump off-peak; consider tablespace/`pg_dump` excludes of raw staging only if restore-tested | Multi-GB raw audit accumulation |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Alert messages containing provider keys/tokens from headers, URLs, or raw payloads | Secret exfiltration via email/webhook/logs | Typed allowlist DTOs for alert payloads; redaction test with planted secrets |
| Backup credentials / SMTP / webhook secrets inline in compose `environment:` or committed `.env` variants | Repo leak grants DB or channel takeover | `${VAR}` references + untracked `.env` (current state preserved); secret scan in CI (e.g., gitleaks step) |
| CI secrets exposed to PRs from forks (Lighthouse/audit workflows with broad permissions) | Token theft | `pull_request` (not `pull_request_target`), least-privilege `permissions:`, environment-gated secrets |
| Restore-verification dumps containing personal/retention-managed data copied to long-lived locations | Privacy-retention breach (`RetentionSubject`/purge audits become lies) | Anonymize or restrict verification dumps; TTL on verification instances; keep purge audit as source of truth |
| Operator gateway bypassed by new scanner/journal routes mounted publicly | RG/operator data exposed | All new operator-contoured routes pass the gateway's auth/eligibility policy; server-side check, not route-by-convention |
| Paper-journal + CLV data flowing into product analytics without consent | Betting-behavior data without basis | No analytics events on operator contour; consent boundary documented now, accounts are future work |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Scanner sorted by edge with green badges | Reads as «лучшие ставки» — certainty framing | Sort by kickoff; edge with timestamp/uncertainty; persistent disclaimer |
| Calibrated % shown bare | Users treat recalibration as increased certainty | Label «откалибровано (версия X)», show raw beside, link methodology |
| Stale odds rendered like fresh ones | False actionable value | Age badge + default exclusion + explicit toggle |
| AH push shown as loss/win without split | Mistrust of settlement | Show half-stake decomposition and push reason in receipt view |
| Paper journal in casino vocabulary («депозит», «вывод», bright green totals) | Normalizes real-money framing | Russian «юниты/симуляция» vocabulary; neutral coloring; persistent simulation banner |
| Lighthouse score displayed as user performance | Misleading methodology claim | Report lab audits honestly labeled as synthetic; no field claims without field data |
| English enum leakage on new pages | Breaks product convention | String-scan tests for user-visible literals |

## "Looks Done But Isn't" Checklist

- [ ] **CI:** a deliberately broken test/type actually blocks a merge (branch protection proven); integration suite provably ran (duration + container logs), not skipped.
- [ ] **Backups:** a dump was restored into a *fresh* container on the pinned image and passed chain-integrity queries — this month, not "at creation."
- [ ] **Alerting:** one real induced failure (stopped worker / exhausted budget fixture) produced exactly one deduplicated page; message contains no secrets (planted-key test).
- [ ] **Lighthouse:** CI gates on audit budgets with headroom; two consecutive no-change runs are both green; bundle bytes recorded as a trend.
- [ ] **Calibration:** reported Brier deltas come from a window *after* the fit window; min-cohort rule produces an honest «недостаточно данных» for a small league; `ForecastMarket` rows untouched.
- [ ] **Dixon-Coles:** unit tests pin the τ convention; ρ=0 reproduces Poisson bitwise; `modelVersion` bumped; methodology card names the exact integration (Elo-λ + τ vs full refit).
- [ ] **CLV diary:** a fixture settled without a comparable closing price shows `clvStatus` unavailable with reason — no fabricated value; no pre-kickoff CLV anywhere in UI.
- [ ] **New markets:** quarter-line push, whole-line push, and abandoned-match void each tested per market; scanner/AH probabilities reconcile with the score matrix.
- [ ] **Scanner:** displayed edge equals the stored `ValueReceipt` edge byte-for-byte; stale candidates demoted by default; query is one projection (EXPLAIN checked).
- [ ] **Paper journal:** entries cannot be edited/deleted (supersession only); every entry links a `valueReceiptId`; no deposit/withdrawal vocabulary; Kelly ≤ ¼ descriptive.
- [ ] **Cross-cutting:** new user-visible strings are Russian and pass the extended prohibited-claims suite; free-tier ledger shows no CI/audit traffic.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| CI never gated (bad merges landed) | MEDIUM | Freeze merges; run full suite locally/CI on affected range; fix forward per phase |
| Backups unverified, restore fails | HIGH (until fixed) | Stop trusting backups; restore-drill immediately; fix dump tooling; only then resume normal work |
| Alert fatigue set in | MEDIUM | Mute channel; redesign tiers/dedup; re-launch with strict `critical` list; require an "alert changelog" |
| Calibration fitted with leakage | HIGH | Quarantine calibrated series; refit on clean windows; restate Brier claims; calibrator supersession entry documents it |
| DC sign/convention bug shipped | HIGH | Roll back to ρ=0 (Poisson) immediately — it is a valid fallback; re-verify tests; refit; bump model version; invalidate affected forecasts' claims |
| CLV contaminated by hindsight | HIGH | Mark affected observations retrospective; recompute aggregates excluding them; state correction in methodology card |
| Scanner displayed divergent edges | MEDIUM | Take scanner down (honest maintenance state); rebuild as receipt projection; reconcile any recorded decisions |
| Journal edited/tampered | MEDIUM–HIGH | If no append log exists, declare journal history unverifiable; restart journal under append-only rules; note in operator log |

## Pitfall-to-Phase Mapping

Recommended v1.1 phase order and the pitfalls each phase must *structurally* prevent (verification = a check that fails the phase if absent):

| # | Phase (workstream) | Pitfalls addressed structurally | Verification |
|---|--------------------|----------------------------------|--------------|
| 1 | **CI pipeline** | P1 (OS parity, Testcontainers on Linux only), P11 (mutation-rejection tests in CI), P12 (no live provider calls), P13 (string/claims scan) | Required check proven blocking; integration job container logs; secret scan |
| 2 | **PostgreSQL backups** | P2 (restore verification), C8 (backup alerts) | Scheduled restore drill passing chain-integrity queries |
| 3 | **Degradation alerting** | P3 (tiers/dedup/redaction), C8, P12 (probes are internal-only) | Induced-failure drill; planted-secret redaction test |
| 4 | **Lighthouse/performance audit** | P4 (audit budgets not composite gate), C9 (bundle budget for later UI) | Two green no-change runs; Recharts code-split proven by bundle analyzers |
| 5 | **Dixon-Coles** | P6 (τ convention tests, ρ bounds, single home advantage), C3 (model versioning, backtest pinning), P11 | ρ=0 bitwise-Poisson test; model version bump; methodology card section |
| 6 | **Isotonic/Platt calibration** | P5 (leakage-free fit windows, min cohorts, no snapshot mutation, hysteresis), C1, C7, C11 | Out-of-time Brier delta with sample sizes; mutation-rejection on snapshots |
| 7 | **CLV price diary** | P7 (capture discipline, comparability, contamination firewall), C5, C12 | Fail-closed unavailable states; post-kickoff capture blocked |
| 8 | **Asian handicap & exact score** | P8 (quarter-line splits, void routing, 2-way renorm, value floors), C4, C11 | Push/void settlement matrix tests; cross-market coherence test |
| 9 | **7-day value scanner** | P9 (receipt projection, staleness, RG posture), C2, C7, C12 | Edge byte-equality vs receipts; EXPLAIN single-projection check; RG copy suite |
| 10 | **Paper-trading journal** | P10 (append-only, receipt linkage, vocabulary, fractional Kelly), C6, C13 privacy | Mutation-rejection; vocabulary scan; every entry links a receipt |

**Ordering rationale:** CI first (everything else needs the gate) → backups before any schema/model mutation risk → alerting before risky model changes so rollouts are observable → performance budgets before new heavy UI → Dixon-Coles before calibration (calibrators fit the final pipeline) → calibration before scanner (labeled display) → CLV before settlement-consuming surfaces → new markets after the corrected matrix exists → scanner as the aggregation surface → journal last, consuming receipts from all prior phases.

**Research flags for phases:**
- **Dixon-Coles phase:** needs a domain decision (documented, recorded in `modelVersion`) on Elo-derived λ,μ + fitted per-league ρ vs full attack/defence refit; ρ fitting window and decay selection are project-specific.
- **Calibration phase:** minimum cohort sizes and materiality thresholds for rollback are policy decisions to record in `configVersion`.
- **Backups phase:** RPO target (daily dump vs WAL shipping) is an operator decision; off-host destination must be chosen for the deployment target.
- **Alerting phase:** actual free-tier email/webhook channel choice and its rate limits need runtime verification at implementation time.

## Carry-over Pitfalls from v1.0 (still enforced in v1.1)

Condensed; full text in git history (commit `8655694`): temporal leakage via current-state tables (now also threatened by calibration fitting and DC refits — see P5/P6); false value claims from unvalidated odds math (now threatened by scanner presentation and AH/exact-score normalization — see P8/P9); quota exhaustion (see P12); RG reduced to disclaimer (see P10/P13); miscalibration presented as accuracy (see P5). Every v1.1 phase re-runs the v1.0 "Looks Done But Isn't" checks relevant to its data.

## Sources

- GitHub Actions runner: container operations Linux-only (`actions/runner#904`); Testcontainers-node failures on `windows-2025` runners (`testcontainers/testcontainers-node#1093`, 2025-07); Testcontainers Windows documentation — **HIGH confidence** (official/first-party trackers).
- Dixon, M. J. & Coles, S. G. (1997), *Modelling Association Football Scores and Inefficiencies in the Football Betting Market*, JRSS-C 46(2):265–280 (DOI 10.1113/jrsssc.46.2.265-era canonical citation per publisher) — τ four-cell correction, time-decay pseudo-likelihood, ρ bounds — **HIGH confidence** (primary source, content cross-checked via secondary implementation documentation showing the opposite-sign convention exists in the wild — that divergence is Pitfall 6).
- scikit-learn common pitfalls & probability calibration documentation — calibrator fit/eval separation, small-sample isotonic behavior — **HIGH confidence** (official docs; principles are framework-independent).
- PostgreSQL official documentation: `pg_dump` consistency (single snapshot), parallel dump format constraints, major-version restore compatibility — **HIGH confidence**.
- Lighthouse CI (`@lhci/cli`) assert/median-run documentation and Chrome-Lighthouse variance discussions — score noise, audit-level assertions — **MEDIUM confidence** (official tool docs + well-established community consensus).
- Project sources (HIGH confidence for system claims): `.planning/PROJECT.md`, `.planning/research/ARCHITECTURE.md` (v1.0), `packages/database/prisma/schema.prisma` (ForecastSnapshot, ValueReceipt, ClosingOddsObservation, ValueSettlement, SettlementReceipt, ForecastScore, ResultVersion), `infra/docker-compose.yml`, `infra/operator-gateway/`, `.gitignore` (env handling), absence of `.github/`.

---
*Pitfalls research for: v1.1 feature additions — Football Prediction & Value Betting Platform*
*Researched: 2026-10-19*
