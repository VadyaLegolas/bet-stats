# 08-01 Deferred Items

## Pre-existing (out of scope per executor boundary)

- `tests/unit/fixtures-sync.test.ts` — 7 tests fail on this Windows machine with
  `PrismaClientKnownRequestError: Authentication failed against the database server, the
  provided database credentials for 'user' are not valid`. The test hardcodes
  `DATABASE_URL=postgresql://user:pass@127.0.0.1:5432/betstats-test` (placeholder creds)
  and needs a reachable local PostgreSQL seeded for that database. Unrelated to phase 8
  (imports are relative paths only; the Task 2 vitest alias addition cannot affect it).
  Discovered during Task 2 GREEN full-unit run; not fixed here.
