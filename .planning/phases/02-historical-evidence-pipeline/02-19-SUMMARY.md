---
phase: 02-historical-evidence-pipeline
plan: 19
subsystem: operator-ingress
tags: [docker, basic-auth, hmac, nextjs, nestjs, postgresql, replay]
requires:
  - phase: 02-historical-evidence-pipeline
    provides: durable replay policy and private server-held operator credential
provides:
  - Docker Basic Auth ingress for protected replay routes
  - HMAC-bound verified operator identity at the Next.js replay proxy
  - Private Docker topology with durable replay actor audit
  - Fast direct evidence browser-boundary contract
affects: [replay, operator-security, docker-deployment, evidence-browser]
actuals:
  tasks: 4
  commits: 11
tech-stack:
  added: []
  patterns: [gateway-only published port, stripped-and-resigned operator headers, durable verified actor]
key-files:
  created:
    - infra/operator-gateway/security.mjs
    - infra/operator-gateway/server.mjs
    - infra/operator-gateway/Dockerfile
    - infra/Dockerfile.app
    - infra/docker-compose.operator.yml
    - tests/unit/operator-gateway.test.ts
    - tests/integration/operator-gateway.test.ts
    - tests/integration/operator-gateway-deployment.test.ts
    - tests/integration/evidence-browser-contract.test.ts
  modified:
    - apps/web/src/security/operator-proxy-authorization.ts
    - apps/web/app/internal-api/pipeline/replay/[[...path]]/route.ts
    - apps/api/src/modules/reconciliation/operator.guard.ts
    - apps/api/src/modules/replay/replay.controller.ts
    - apps/api/src/modules/replay/replay.service.ts
    - tests/integration/replay-boundary.test.ts
key-decisions:
  - "Only the replay path families are Basic-authenticated; fixture and evidence routes remain anonymous."
  - "The gateway strips every inbound operator identity header and emits the existing method/path/query-bound HMAC contract."
  - "Only port 8080 is published; Next, Nest, PostgreSQL, Redis, and the Worker remain private."
patterns-established:
  - "A browser identity becomes authoritative only after ingress authentication, header replacement, Next signature verification, and Nest credential verification."
  - "Deployment evidence records outcomes and secret-leak counts without recording credential values."
requirements-completed: [PIPE-06, PIPE-07, PIPE-08]
completed: 2026-09-01
status: complete
---

# Phase 02 Plan 19: Authenticated Operator Ingress Summary

**Replay operations now pass through a Docker Basic Auth gateway that replaces untrusted identity headers with a verified HMAC-bound subject, while the public evidence surface remains anonymous and the application services remain private.**

## Accomplishments

- Added fail-closed ingress authorization with constant-time Basic credential comparison, spoofed-header removal, and the existing canonical HMAC request contract.
- Preserved the verified ingress subject through Next and credential-authenticated Nest boundaries into `ReplayPreview.actor` and `ReplayPlan.actor`.
- Added a gateway-only published Docker topology using production Node 24 images and persistent PostgreSQL/Redis volumes.
- Added fast operator gateway, deployment topology, replay boundary, and direct evidence browser-contract witnesses.

## Deployment Checkpoint

The successful isolated deployment used Compose project `betstatsoperatorsmoke2` and the repository-ignored `.env` file:

```powershell
docker compose -p betstatsoperatorsmoke2 --env-file .env -f infra/docker-compose.operator.yml up --build -d
docker compose -p betstatsoperatorsmoke2 --env-file .env -f infra/docker-compose.operator.yml ps
```

Observed results:

- Public `GET /fixtures`: HTTP `200` without Basic Auth.
- Protected replay preview without Basic Auth: HTTP `401`.
- Authenticated replay preview: HTTP `201`.
- Authenticated replay queue: HTTP `201`.
- Spoofed inbound operator headers were discarded; the latest durable preview and plan actors both equalled `local-test-operator`.
- Host access to ports `3000` and `3001` failed as required; only gateway port `8080` was published.
- Credential/signing-secret scan across Compose logs returned `secret_leak_count=0`.
- Production containers ran Node `24.11.1`.

Teardown preserved named data volumes and deliberately omitted `-v`:

```powershell
docker compose -p betstatsoperatorsmoke2 --env-file .env -f infra/docker-compose.operator.yml down
```

## Verification

- `pnpm test -- operator-gateway evidence-browser-contract --run` — 1 unit file, 12 tests passed. The root unit project selects the gateway suite; the evidence contract was also run explicitly under the integration project.
- `pnpm test:integration -- evidence-browser-contract --run` — 1 file, 2 tests passed.
- `pnpm test:integration -- operator-gateway replay-boundary operator-gateway-deployment --run` with process-only `OPERATOR_PROXY_SIGNING_SECRET` and `OPERATOR_AUTHORIZED_SUBJECTS=local-test-operator` — 3 files, 28 tests passed.
- `pnpm --filter @bet-stats/web typecheck` — passed.
- `pnpm --filter @bet-stats/api typecheck` — passed.

The host runner emitted the known Node `25.2.1` engine warning; the production Docker checkpoint used the required Node 24 runtime.

## Task Commits

1. **Ingress authorization and durable actor boundary** — `1c2bebc`, `e58e27d`
2. **Direct evidence browser contract** — `5c8215c`, `aebd5f8`
3. **Basic Auth/HMAC gateway** — `e596ba8`, `9cd5311`, `9561b8e`, `f63919e`
4. **Private Docker topology and deployment hardening** — `b66d0d3`, `c81c462`, `5cabcb8`

## Issues Encountered

The first smoke reused an older PostgreSQL volume configured with a different password and correctly failed database authentication. Verification moved to the isolated `betstatsoperatorsmoke2` Compose project with fresh named volumes; no existing volume was deleted. The isolated database also required a CLOSED provider circuit-state seed because replay admission intentionally fails closed when durable circuit state is absent.

## User Setup Required

For local Docker use, populate the ignored `.env` values documented in `.env.example`. Outside localhost, Basic Auth must be placed behind HTTPS. A future Vercel deployment should replace this gateway with OIDC/Auth.js in Next `proxy.ts` while retaining the same signed operator contract.

## Next Phase Readiness

The blocking authenticated-ingress deployment checkpoint is satisfied. Phase 2 gap plans 02-21 and 02-22 can proceed.

## Self-Check: PASSED

- Real Compose deployment produced the required `200`, `401`, and `201` outcomes.
- Durable actor, spoof resistance, port isolation, and zero secret leakage were observed.
- Targeted tests and both application typechecks passed.

---
*Phase: 02-historical-evidence-pipeline*
*Completed: 2026-09-01*
