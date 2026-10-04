# Monorepo Structure

Recommended setup: pnpm workspaces + Turborepo.

```text
football-prediction/
├─ apps/
│  ├─ web/                       # Next.js frontend
│  │  ├─ app/
│  │  ├─ components/
│  │  ├─ features/
│  │  └─ lib/
│  └─ api/                       # NestJS backend
│     ├─ src/modules/fixtures/
│     ├─ src/modules/teams/
│     ├─ src/modules/predictions/
│     ├─ src/modules/value-bets/
│     ├─ src/modules/backtest/
│     └─ src/modules/providers/
│
├─ workers/
│  └─ data-sync/
│     ├─ src/jobs/fixtures.ts
│     ├─ src/jobs/results.ts
│     ├─ src/jobs/injuries.ts
│     ├─ src/jobs/lineups.ts
│     └─ src/jobs/odds.ts
│
├─ packages/
│  ├─ database/
│  │  ├─ prisma/schema.prisma
│  │  └─ src/client.ts
│  ├─ domain/
│  ├─ football-data/
│  │  ├─ src/providers/football-data-org/    # prod, primary top-5+UCL
│  │  ├─ src/providers/api-football/          # prod, fallback top-5+UCL / primary EL+UECL
│  │  ├─ src/providers/thesportsdb/           # entity-aid: name/logo normalization
│  │  ├─ src/providers/statsbomb-open-data/   # training-only, offline calibration
│  │  ├─ src/providers/fbref/                 # historical-only (no live xG since 2026)
│  │  ├─ src/providers/understat/             # caution, unofficial access
│  │  └─ src/provider.interface.ts
│  ├─ prediction/
│  │  ├─ src/elo/
│  │  ├─ src/poisson/
│  │  ├─ src/features/
│  │  └─ src/markets/
│  ├─ value-betting/
│  ├─ backtesting/
│  ├─ config/
│  └─ ui/
│
├─ infra/
│  ├─ docker-compose.yml
│  └─ postgres/
│
├─ docs/
│  ├─ SPEC.md
│  └─ ARCHITECTURE.md
│
├─ .env.example
├─ package.json
├─ pnpm-workspace.yaml
└─ turbo.json
```

## Main environment variables

```env
DATABASE_URL=
REDIS_URL=
API_FOOTBALL_KEY=
FOOTBALL_DATA_ORG_KEY=
API_FOOTBALL_DAILY_LIMIT=100
THESPORTSDB_KEY=
UNDERSTAT_SCRAPE_ENABLED=false
```

## Recommended npm scripts

```json
{
  "scripts": {
    "dev": "turbo dev",
    "build": "turbo build",
    "lint": "turbo lint",
    "test": "turbo test",
    "db:generate": "pnpm --filter database prisma generate",
    "db:migrate": "pnpm --filter database prisma migrate dev"
  }
}
```
