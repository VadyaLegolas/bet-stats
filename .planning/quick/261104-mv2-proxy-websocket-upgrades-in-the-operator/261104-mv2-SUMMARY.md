---
task: mv2-proxy-websocket-upgrades-in-the-operator
quick_id: 261104-mv2
status: complete
created: "2026-11-04"
completed: "2026-11-05"
files_modified:
  - infra/operator-gateway/server.mjs
  - tests/integration/operator-gateway.test.ts
commits:
  - cc03a71
  - 66af450
duration: "resumed execution — Task 1 was committed by a prior interrupted run"
---

# Quick Task 261104-mv2: Proxy WebSocket upgrades in the operator gateway

Next 16.3.3 dev-mode `/internal/operations` behind the operator gateway on :8080 never hydrated: the HMR debug-channel WS handshake against the gateway hit a Node-default 404 because the gateway had no `'upgrade'` handler, leaving the React debug-channel readable open forever. The gateway now proxies WebSocket upgrades through the same target + Basic-auth gates as the HTTP path and relays the handshake verbatim.

## Commits

| Commit | Type | Content |
|--------|------|---------|
| `cc03a71` | fix | WebSocket upgrade handler in the operator gateway (Task 1) |
| `66af450` | test | 5 upgrade-boundary integration tests + 2 half-open/error teardown fixes (Task 2) |

## Tasks Completed

### Task 1: WebSocket upgrade handler in the operator gateway
- `server.on("upgrade")` attached to the `createServer` result inside `createGateway`; request handler and `main()` timeout assignments untouched.
- Fail-closed target gate: `requestTarget(incoming.url, config.webOrigin)` → `undefined` gets a raw `HTTP/1.1 400` (JSON `{"message":"Invalid request target"}`, `connection: close`, `content-length`) direct on the socket, zero upstream contact (T-mv2-01).
- Same auth gate: `isProtectedPath` + `authenticateBasic`, failure gets a raw `HTTP/1.1 401` with the exact `www-authenticate: Basic realm="Bet Stats Operator", charset="UTF-8"` realm from `unauthorized()`, socket ended before any upstream request (T-mv2-02).
- `upgradeForwardHeaders` copies client headers minus `host`, `authorization`, and `x-operator-*`, deliberately KEEPING `connection`, `upgrade`, and all `sec-websocket-*` (the HTTP path's `forwardHeaders` strips hop-by-hop by design and is untouched) (T-mv2-03).
- Upstream GET via the existing https/http branch; `'upgrade'` (real 101) relays the status line + raw upstream headers verbatim, forwards both `head` directions, then bidirectional pipe with peer-destroy on error/end/close; `'response'` (refusal) relays status + headers + body raw and ends — never a partial 101; 10s handshake timer destroys both sockets (T-mv2-04); `'error'` destroys the client socket.
- No HMAC signing on the upgrade path (locked: no HTTP route consumes it).

### Task 2: Integration tests for the upgrade proxy path
Five raw-TCP handshakes in `describe("operator gateway WebSocket upgrade boundary")`, reusing the file's local-upstream/startGateway/stop style (each upstream also answers `/health` on the HTTP path):
1. **Happy path**: real 101 handshake with `Upgrade: echo`, echoes `ping-immediate` and `ping-after-hold` across a 3-second hold (proves the pipe outlives gateway request/header timeouts and is what Next's debug-channel readable needs).
2. **Upstream refusal**: no upstream `'upgrade'` listener → pulled-through raw `404`, never a 101; `/health` afterward still 200 with gateway `exitCode` null.
3. **Auth denied**: protected-path handshake without credentials → raw `401` with the `Bet Stats Operator` realm; upstream upgrade-attempts stay 0.
4. **Auth allowed**: same handshake with `Basic <operator:test-password>` → 1 upstream attempt at `/internal/operations`, relayed 101, and the upstream never receives the `authorization` header (T-mv2-03 asserted end-to-end).
5. **Invalid target**: protocol-relative (`//evil.example/x`) and absolute-form (`http://evil.example/x`) request lines → raw `400`, zero non-`/health` upstream requests.

## Deviations from Plan

**[Rule 1 - Bug] Two upgrade-teardown fixes found during Task 2 test development** (committed with Task 2, `66af450`):
1. `socket.once("end", ...)`: `http.Server` sockets are allowHalfOpen, so a client FIN alone deferred `'close'` indefinitely and orphaned the upstream socket; the `'end'` handler destroys the peer.
2. On a refused upgrade, the relayed response stream gained an `'error'` handler that destroys the client socket, preventing an uncaught stream error on aborted relays.

Both change only the upgrade path; ordinary HTTP proxy behavior, `forwardHeaders`, and `security.mjs` semantics are byte-for-byte untouched.

## Verification

- `pnpm vitest run --project integration tests/integration/operator-gateway.test.ts` → **17/17 passed** (12 prior + 5 new).
- `pnpm vitest run --project unit tests/unit/operator-gateway.test.ts` → **17/17 passed** (unchanged).
- Full `pnpm test` deliberately not run per constraints (known `fixtures-sync.test.ts` failures are pre-existing); live stack not restarted; tests spawn their own gateway instances.

## Known Stubs

None.

## Self-Check: PASSED

- `infra/operator-gateway/server.mjs` — modified, committed (`cc03a71`, `66af450`).
- `tests/integration/operator-gateway.test.ts` — modified, committed (`66af450`).
- Both commits verified present in `git log`; user's dirty set left untracked/unstaged.
