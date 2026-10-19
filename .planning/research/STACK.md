# Technology Stack

**Project:** bet-stats — Football Prediction & Value Betting Platform (v1.1 milestone additions)
**Researched:** 2026-10-19

> Scope of this document: libraries and tooling **added by the v1.1 milestone** (CI, backups, alerting, Lighthouse audit, calibration, Dixon-Coles, CLV diary, AH/exact-score markets, value scanner, paper journal). It extends, and does not replace, the v1.0 stack already pinned in the repository. All version claims below were verified against npm/GitHub/release notes in October 2026; repo facts were verified against the actual codebase (`package.json`, lockfile, source tree), not the milestone brief.

## Repository Baseline (verified, unchanged by this milestone)

| Component | Pinned in repo today | Notes |
|-----------|----------------------|-------|
| Node.js | 24.11.1 (`infra/Dockerfile.app`) | LTS line |
| pnpm | 10.34.5 (`packageManager`) | workspace + Turborepo |
| Turborepo | 2.10.12 | root devDep |
| TypeScript | 5.9.3 | strict |
| Next.js | 16.3.3 (App Router, Turbopack) | `apps/web` |
| React | 19.2.8 | — |
| NestJS | 11.1.29 | `apps/api` |
| Prisma ORM | 7.10.0 + `@prisma/adapter-pg` | — |
| PostgreSQL | 18.6 (compose) | source of truth |
| Redis / BullMQ | 8.2.1 / ^6.3.2 | queues + cache |
| Vitest / Playwright | 4.1.11 / 1.62.1 (+ `@axe-core/playwright` 4.13.0) | unit + integration + E2E |
| decimal.js / Zod / cockatiel | 10.6.0 / 4.4.3 / ^3.2.1 | money math, validation, breakers |

**Important corrections vs. the milestone brief** (verified against the code):
- There is **no Recharts, no TanStack Query, no Tailwind, no Testcontainers** in the repo. The web app uses server components, a hand-written CSS design system (`globals.css`), and plain tables. The heaviest client asset is `apps/web/app/fixtures/[fixtureId]/forecast-workbench.tsx` (~39 KB, `"use client"`) — this, not charts, is the Lighthouse target.
- There is **no CI** (`.github/` absent) and **lint exists only in `apps/web`** (eslint 9.39.5 + eslint-config-next 16.3.3). `turbo run lint` therefore covers one package only.
- `fast-check` is only a **transitive** dependency (via `effect`) — not usable until declared explicitly.
- E2E live-stack tests shell out to `cmd.exe` (`tests/e2e/live-provider-stack.ts`) — Windows-only; CI must use the cross-platform `scripts/verify-release-integration.mjs` path (Docker `postgres:18-alpine` / `redis:8-alpine`).

## Recommended Stack

### CI / Quality Gates (Feature 1)

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| GitHub Actions | hosted `ubuntu-latest` | Single CI workflow: install → schema verify → typecheck → lint → unit tests → integration (Docker services) → build → E2E smoke | Zero-infrastructure CI on the free tier (milestone constraint: free tiers only). `ubuntu-latest` ships Docker, so `verify-release-integration.mjs` runs unmodified. **Confidence: HIGH.** |
| `actions/checkout` | `v6` (v6.1.0 verified) | Repo checkout | v6 runs on the Node 24 action runtime; v6 is the current documented default. **Confidence: HIGH.** |
| `actions/setup-node` | `v7` (v7.0.0, Jul 2026) | Node 24 + pnpm store cache | v7 is current; `node-version: 24` matches the Dockerfile runtime exactly. **Confidence: HIGH.** |
| `pnpm/action-setup` | `v5`+ (v6.0.9 verified) | Install pnpm from `packageManager` field | Reads `pnpm@10.34.5` from root `package.json` — no version drift between local and CI. **Confidence: HIGH.** |
| ESLint flat config (repo-local) | eslint 9.x line already pinned | Extend lint to `apps/api`, `apps/api-e2e`, `workers/*` using `typescript-eslint` | CI must not gate on a script that silently covers one package. Reuses the web flat-config pattern; `typescript-eslint` is already in the tree via `eslint-config-next`. **Confidence: HIGH.** |

**CI pipeline order** (fail fast, cheapest first): `pnpm install --frozen-lockfile` → `pnpm verify:release:schema` → `pnpm typecheck` → `pnpm lint` → `pnpm test` (Vitest unit) → `node scripts/verify-release-integration.mjs` (integration, spins real PG 18/Redis 8 in Docker) → `pnpm build` → small Playwright suite gated on E2E env vars.

### Backups + Restore Verification (Feature 2)

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `pg_dump` via `docker compose exec` (shell script) | PG 18.6 client already in the `postgres:18.6` image | Nightly `-Fc` custom-format dumps + manifest + retention rotation | The repo already documents manual `pg_dump` in the README; automation wraps the *same* tool — no new dependency, no agent to install. Custom format supports single-object restore. **Confidence: HIGH.** |
| Throwaway `postgres:18.6-alpine` container | same image as `verify-release-integration.mjs` | **Restore verification**: restore latest dump into an ephemeral container, run `prisma migrate deploy` + smoke queries, then destroy | A backup that is never restored is a hope, not a plan. Reusing the existing verify script's container pattern keeps this free and consistent. **Confidence: HIGH.** |
| GitHub Actions `schedule:` (cron) **or** host cron/Task Scheduler | hosted runner | Orchestration | Host-side cron when the DB is not reachable from hosted runners (operator stack is single-host); hosted `schedule:` when dumps can run against a reachable DB. Decide per deployment; both are free. **Confidence: MEDIUM.** |

No backup library is added: pgBackRest/Barman are overkill for a single-node operator stack, and paid backup SaaS violates the free-tier constraint.

### Degradation Alerting — operator only (Feature 3)

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| BullMQ `QueueEvents` + `queue.getFailed()` (already installed) | ^6.3.2 | Dead-letter detection on `data-sync` queues | Queues already configure `attempts`, backoff, and `removeOnFail: {age:604800, count:5000}` — failed jobs are retained but never surfaced. A `QueueEvents` listener closes that gap with zero new dependencies. **Confidence: HIGH.** |
| NestJS exception filter + counters (framework built-in) | NestJS 11.1.29 | Count 5xx / provider-quota breaches per window | The API already has a centralized exception handler emitting console JSON events; persisting those events as alert rows is an incremental change. **Confidence: HIGH.** |
| Generic outbound webhook via built-in `fetch` (Slack/Telegram/Discord-style) | Node 24 native `fetch` | Delivery channel | One HTTP POST, operator-configured URL. Zero dependencies, no vendor lock-in, works with any operator channel. **Confidence: HIGH.** |
| `nodemailer` (optional, only if email is the chosen channel) | `^10.1.7` (latest, Oct 2026; Node ≥20, zero deps, built-in types) | SMTP delivery | Only install if SMTP is actually the operator's channel; otherwise skip. **Confidence: HIGH.** |
| Alert state table (Prisma + PostgreSQL) | existing stack | Durable alert rows, throttling/dedup, operator-only visibility | Keeps alert history auditable and behind the existing Basic Auth operator contour — no user-facing notification surface (explicitly out of scope). **Confidence: HIGH.** |

Thresholds to wire: API-Football daily quota (100 req/day free tier — burn-rate warning), queue failure rate, consecutive provider circuit-breaker opens (cockatiel already installed), DB/Redis connectivity loss, backup job failure.

### Lighthouse Audit of `/fixtures/[id]` (Feature 4)

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `@lhci/cli` | `^0.15.1` (bundles Lighthouse 12.6.1) | Budget-gated Lighthouse runs against the **production** build (`next build && next start`) | `lhci autorun` gives performance-budget assertions in CI for free (Lighthouse CI's hosted storage is free for public/OSS; assertions run locally in the runner regardless). Budgets prevent regressions on the fixture page. **Confidence: HIGH.** |
| Next.js built-in bundle analyzer | `npx next experimental-analyze` (Next ≥16.1, already in node_modules) | Identify what inflates the fixture route | The likely offender is `forecast-workbench.tsx` (~39 KB client component). Analyzer output guides `next/dynamic` code-splitting and deferred rendering — no dependency needed. **Confidence: MEDIUM-HIGH.** |
| `@axe-core/playwright` | 4.13.0 (already installed) | Accessibility gate alongside Lighthouse a11y | Already in the repo; reuse rather than duplicate. **Confidence: HIGH.** |

Fix strategy (no new libraries): split `forecast-workbench.tsx` with `next/dynamic` + streaming, keep tables as server components, defer non-critical client islands. **Do not add a charting library for this milestone** — charts are not currently used, and adding one would *hurt* the Lighthouse budget the milestone is trying to pass.

### Calibration — isotonic / Platt + versioned rollback (Feature 5)

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Pure TypeScript in `packages/domain` | n/a (no dependency) | PAVA isotonic regression (~40 lines) and Platt scaling (logistic fit via a few Newton steps) | Both are small, transparent, closed-form-ish algorithms. The project rule is explicit: simple formulas stay as pure, auditable functions — a numerical/ML package would obscure them and add bundle surface for nothing. **Confidence: HIGH.** |
| Prisma table `CalibratorVersion` | existing Prisma 7 | Keyed `(modelVersion, market, method, trainedThroughSnapshotId)`, active-pointer flag | Rollback = pointer flip; snapshots remain immutable (calibration is a **derived layer**, never written back into snapshots). **Confidence: HIGH.** |
| `fast-check` + `@fast-check/vitest` (optional, devDeps) | `^4.8.0` / `^0.4.1` (peer: vitest ^4.1.0 ✓ — repo has 4.1.11) | Property tests: isotonic output is monotone & bounded [0,1]; Platt preserves rank order | Only test-time dependency; today `fast-check` is transitive via `effect`, so it must be declared explicitly to be imported. Adopt if property tests are written; otherwise skip. **Confidence: MEDIUM.** |

### Dixon-Coles correction (Feature 6)

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Pure TypeScript in `packages/domain/src/forecast` | n/a | τ(ρ) low-score correlation correction applied to the existing Poisson score matrix | The Poisson goal model already exists in domain. Dixon-Coles is a ~10-line multiplicative correction; ρ is fit by 1-D grid search (bounded scalar — no optimizer library needed). Model config gets a version bump on new snapshots. **Confidence: HIGH.** |

### CLV Price Diary (Feature 7)

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Extend `packages/domain/src/evaluation/clv.ts` | existing | Add timestamped observation rows (forecast-time price, closing price, window) to the existing `odds-ratio-clv-v1` fail-closed policy | CLV receipts already exist and are fail-closed; the diary adds durable, timestamped price observations rather than recomputing. **Confidence: HIGH.** |
| Prisma table + `decimal.js` | existing stack | Persist forecast/close prices; exact odds-ratio math | `decimal.js` 10.6.0 is already pinned for money math — CLV ratios are money-adjacent, keep it consistent. **Confidence: HIGH.** |

### Asian Handicap + Exact Score markets (Feature 8)

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Pure TypeScript in `packages/domain` | n/a | Exact score = sum over the Poisson score matrix (already computed for 1X2/O-U); AH quarter-line = average of the two adjacent half-lines with push (void) handling | Both are direct transforms of structures that already exist. `decimal.js` for stake/payout math, following existing money-math rules. New `OddsMarket`/`OddsSelection` enum values flow through the existing normalize → value → settlement paths. **Confidence: HIGH.** |

No new dependency: no maintained, trustworthy TS library exists for these, and the math is trivial relative to the auditability requirement.

### 7-Day Value Scanner page (Feature 9)

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Next.js server component route (e.g. `apps/web/app/value/page.tsx`) | Next 16.3.3 (installed) | Query value receipts for a kickoff window filter, render as plain table | Matches the existing `internal-api` route pattern behind Basic Auth. **No TanStack Query** — the repo has no query library and this is a server-rendered read; adding one would contradict the current architecture. **Confidence: HIGH.** |

### Paper-Trading Journal (Feature 10)

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Prisma models (`PaperBet`, `BankrollLedger`) | Prisma 7.10.0 | Durable journal rows + append-only bankroll ledger | Immutable, auditable history — consistent with the platform's snapshot/audit posture. **Confidence: HIGH.** |
| `packages/domain/evaluation/financial.ts` (existing) + `decimal.js` | existing | ROI, yield, drawdown, flat-stake math over journal rows | The financial evaluation module already exists; the journal feeds it new rows. Units/bankroll in `Decimal` per the established money-math rule. **Confidence: HIGH.** |
| Operator-gated page under existing Basic Auth contour | existing | UI for journal entry/review | No user-facing notification or payment surface (out of scope). **Confidence: HIGH.** |

## Installation

```bash
# CI — nothing to install locally; workflow files only:
#   .github/workflows/ci.yml using actions/checkout@v6, actions/setup-node@v7, pnpm/action-setup@v5+

# Lighthouse budget gate (devDependency, root)
pnpm add -D -w @lhci/cli@^0.15.1

# Alert delivery — only if SMTP is the chosen operator channel
pnpm add nodemailer@^10.1.7        # otherwise skip; webhook via native fetch needs nothing

# Optional property tests for calibration/market math (devDependencies, root)
pnpm add -D -w fast-check@^4.8.0 @fast-check/vitest@^0.4.1

# Lint extension to api/worker/domain — reuses flat config; typescript-eslint already in tree
#   (add eslint + typescript-eslint devDeps per package only if not hoisted)
```

Everything else in this milestone installs **zero** new runtime dependencies: backups wrap `pg_dump`, alerting reuses BullMQ/NestJS/native `fetch`, calibration/Dixon-Coles/AH/exact-score are pure domain functions, and the scanner/journal reuse Next.js + Prisma + decimal.js.

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| CI | GitHub Actions (hosted, free) | Self-hosted runner on the operator host | More moving parts on a single-host deployment; hosted runners cover everything except unreachable-DB jobs, which stay on host cron anyway. |
| Backup orchestration | `pg_dump` script + throwaway-container restore check | pgBackRest / Barman | Both are designed for multi-node/PITR fleets; overkill and heavier to operate than the single-node operator stack. |
| Backup storage | Local/host volume + rotation (free) | S3-compatible paid backup tier | Violates the free-tier-only constraint for MVP. |
| Alerting channel | Native `fetch` webhook + optional `nodemailer` | Sentry / PagerDuty / Healthchecks.io paid tiers | Paid tiers are out of scope; webhook covers operator alerting with zero deps. Sentry *could* be revisited later on its free tier, but is not needed for operator-only degradation alerts. |
| Alerting metrics | In-DB counters + BullMQ `QueueEvents` | Prometheus + Grafana | A full metrics stack is disproportionate for one operator on one host; PostgreSQL alert rows are auditable and queryable already. |
| Perf audit | `@lhci/cli` + `next experimental-analyze` | Lighthouse SaaS / paid perf monitors | Free local CI assertions achieve the same gate. |
| Calibration math | Pure TS in `packages/domain` | scikit-learn / Python service / JS ML framework | Milestone keeps TypeScript-only and dependency-light; PAVA and Platt fits are tens of lines and must stay auditable. Python stays deferred (v1.0 decision). |
| Property testing | `fast-check` + `@fast-check/vitest` | Rely on example-based unit tests alone | Property tests are the cheap, high-yield way to prove monotonicity/boundedness of calibrators and push-handling in AH; optional because it's test-only. |
| Scanner data | Existing value receipts via server component | Add TanStack Query + client polling | The repo has no query library; server rendering fits the existing route pattern and avoids new client-state machinery. |
| Lighthouse fix | `next/dynamic` code-splitting of `forecast-workbench.tsx` | Add Recharts for "visual" charts | Charts are not used today and would increase bundle size against the very budget the milestone must pass. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| Recharts / TanStack Query / Tailwind "because the brief says so" | Verified absent from the repo; adding them mid-milestone expands scope and hurts the Lighthouse budget | Existing server components, plain tables, hand-written CSS |
| Testcontainers | The repo already achieves real-container integration via `scripts/verify-release-integration.mjs` + Docker Compose | Reuse the existing harness in CI |
| Paid odds APIs, scraping, Understat live dependency | Free-tier + no-scraping constraints (v1.0 decisions, unchanged) | Existing provider adapters with quota accounting |
| Python/scikit-learn for calibration or Dixon-Coles | Deferred to a later milestone; these algorithms are tiny | Pure TS in `packages/domain` |
| Sentry/PagerDuty paid tiers, user-facing notification stack | Alerting is operator-only this milestone; user notifications explicitly out of scope | Webhook/SMTP to operator channel, alerts persisted in PostgreSQL |
| `bull` (legacy) | Repo standard is BullMQ 6 | `bullmq` (already installed) |
| Axios for alert/HTTP calls | Node 24 native `fetch` suffices | Built-in `fetch` |
| SQLite for backup verification | Diverges from PostgreSQL 18 semantics | Throwaway `postgres:18.6-alpine` container (existing pattern) |
| Mutating snapshots for calibration | Snapshots are immutable; retroactive prediction mutation is forbidden | Separate derived `CalibratorVersion` layer with pointer-flip rollback |

## Stack Patterns by Variant

- **Minimal (no new runtime deps):** CI workflow + backup script + `QueueEvents` alerting + pure-domain calibration/Dixon-Coles/AH + server-component scanner/journal. Only devDeps added: `@lhci/cli` (± `fast-check` pair).
- **With email alerts:** add `nodemailer@^10.1.7` (zero runtime deps, built-in types) and operator SMTP env vars validated by the existing Zod config package.
- **With property tests:** add `fast-check@^4.8.0` + `@fast-check/vitest@^0.4.1` as root devDeps; colocate property tests with existing Vitest unit tests in `tests/unit`/`packages`.
- **CI-lint parity:** extend flat ESLint config to `apps/api`, `apps/api-e2e`, `workers/*` before enabling `pnpm lint` as a required gate — otherwise CI enforces a check that only covers `apps/web`.

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| Node 24.11.1 | `@lhci/cli@0.15.x` (Lighthouse 12.6), `nodemailer@10.x` (engines ≥20) | All verified within Node 24 LTS. Standalone `lighthouse@13.x` requires Node ≥22.19 — also fine, but prefer Lighthouse bundled in LHCI. |
| Vitest 4.1.11 | `@fast-check/vitest@0.4.x` (peer `vitest ^4.1.0`) | Peer range satisfied exactly. |
| React 19.2.8 / Next 16.3.3 | `next experimental-analyze` (built-in ≥16.1) | No install needed. |
| pnpm 10.34.5 (`packageManager`) | `pnpm/action-setup@v5+` | Action reads the field; no hardcoded version drift. |
| PG 18.6 image | `pg_dump`/restore verification container | Same image for dump + restore keeps format versions identical. |
| BullMQ ^6.3.2 | `QueueEvents` on Redis 8.2.1 | Existing queue config retains failed jobs 7 days / 5000 count — alerting reads within that window. |

## Sources

- GitHub Actions releases: `actions/checkout` v6 (Node 24 runtime), `actions/setup-node` v7.0.0 (Jul 2026), `pnpm/action-setup` v5+/v6 — official release notes and READMEs. **HIGH confidence.**
- Lighthouse CI: `@lhci/cli@0.15.1` bundles Lighthouse 12.6.1; standalone `lighthouse@13.5.0` (Node ≥22.19) — npm registry metadata. **HIGH confidence.**
- `nodemailer@10.1.7` — npm registry (engines node ≥20, zero deps, bundled types). **HIGH confidence.**
- `fast-check@4.8.0` + `@fast-check/vitest@0.4.1` (peer vitest ^4.1.0) — npm registry metadata. **HIGH confidence.**
- Next.js 16 built-in bundle analyzer (`next experimental-analyze`) — node_modules docs/release notes. **MEDIUM-HIGH confidence** (experimental command surface may shift within 16.x).
- Dixon-Coles (1997) τ-correction; PAVA isotonic regression; Platt (1999) scaling — standard published methods; no maintained TS library identified (search inconclusive → implement in-house). **HIGH confidence** in the method, **MEDIUM** that no viable off-the-shelf TS package exists.
- Repo facts (versions, absent CI/lint gaps, `forecast-workbench.tsx` size, BullMQ retention config, `cmd.exe` E2E, README `pg_dump`) — verified directly against the codebase, 2026-10-19. **HIGH confidence.**
