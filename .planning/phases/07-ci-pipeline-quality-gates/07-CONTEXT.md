# Phase 7: CI Pipeline & Quality Gates - Context

**Gathered:** 2026-10-19
**Status:** Ready for planning
**Mode:** Auto-generated (infrastructure phase — discuss skipped)

<domain>
## Phase Boundary

A developer can rely on one GitHub Actions pipeline that proves the workspace is installable, schema-valid, type-clean, lint-clean, tested (unit + Docker-backed integration on Linux), and buildable on every push and pull request — the safety net all later v1.1 schema/model changes land behind.

Requirements: CI-01, CI-02, CI-03, CI-04.

</domain>

<decisions>
## Implementation Decisions

### the agent's Discretion
All implementation choices are at the agent's discretion — pure infrastructure phase. Use ROADMAP phase goal, success criteria, research findings, and codebase conventions to guide decisions.

Research-informed defaults to respect (from .planning/research/SUMMARY.md and PITFALLS.md):
- Hosted GitHub Actions on ubuntu-latest; actions/checkout@v6, actions/setup-node@v7, pnpm/action-setup@v5+ reading `packageManager`.
- Integration tests are Linux-only with Docker; missing Docker must FAIL, not skip. Windows runners cannot run containers (actions/runner#904).
- CI must NEVER call live external providers (free-tier budget).
- Extend flat ESLint config to apps/api, apps/api-e2e, workers/* before lint becomes a required gate.
- CI uses the cross-platform scripts/verify-release-integration.mjs path; E2E live-stack tests shell out to cmd.exe (Windows-only) and are excluded from the default CI job.
- CI-04: mutation-rejection tests prove snapshot/receipt tables reject UPDATE/DELETE at the DB layer.
- .gitattributes + Node/pnpm pins for parity.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- Root scripts already compose the gate chain: `verify:release:prerequisites` (Node 24 + Docker check), `verify:release:schema` (prisma validate), `typecheck`, `test`, `test:integration` (vitest integration project), `build`, `verify-release-integration.mjs` (Docker postgres:18-alpine / redis:8-alpine harness).
- turbo.json task graph for build/typecheck/lint across packages.

### Established Patterns
- pnpm 10 with packageManager pin; Vitest unit project + integration project; Playwright E2E (portable subset selectable per config file).
- Docker Compose (infra/docker-compose.yml) for local PostgreSQL 18 + Redis 8.

### Integration Points
- New files: .github/workflows/ci.yml, lint config extension to api/workers/domain, .gitattributes, mutation-rejection integration test(s).

</code_context>

<specifics>
## Specific Ideas

No specific requirements — infrastructure phase. Research flags: decide the portable Playwright subset for CI vs manually-triggered live smoke (CI must not burn free-tier provider budget).

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>
