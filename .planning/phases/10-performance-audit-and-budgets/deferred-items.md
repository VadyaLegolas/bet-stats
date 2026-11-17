# Phase 10 — Deferred Items (out-of-scope discoveries)

- [2026-11-17, 10-01 Task 2] `tests/unit/fixtures-sync.test.ts` — 7 pre-existing unit-test failures (fixtures live sync "emulated db" + leagues list, all `PrismaClientKnownRequestError`). Unrelated to Phase 10 (provider-sync domain; the audit plan touches only `scripts/perf-audit.mjs`, `tests/unit/perf-audit.test.ts`, `scripts/perf/*`, root devDeps). Not fixed per scope boundary — needs its own repair task.
