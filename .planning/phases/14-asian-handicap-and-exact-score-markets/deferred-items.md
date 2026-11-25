# Deferred items: phase 14

## From plan 14-01

- `pnpm typecheck` fails for `@bet-stats/web` because the generated file `apps/web/.next/dev/types/routes.d.ts` is syntactically corrupt (TS1434/TS1005 errors from line 65). `apps/web/next-env.d.ts` already differed from git before plan 14-01 started. Pre-existing and outside the plan's files; regenerate or delete `apps/web/.next` before relying on the root `pnpm typecheck`.
- `tests/integration/forecast-snapshots.test.ts` needs `DATABASE_URL` pointing at a database and was not run (rule: do not touch the dev database).
