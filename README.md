# Football Prediction & Value Betting Platform

Прозрачная платформа футбольной аналитики: предстоящие матчи, воспроизводимые вероятности событий и сравнение с введёнными пользователем коэффициентами. Проект не выдаёт гарантированных прогнозов и не выполняет ставки автоматически.

> **Ответственное использование.** Только для совершеннолетних пользователей там, где это разрешено законом. Аналитика не является финансовой рекомендацией и не гарантирует результат. Ставки несут риск потери денег; не ставьте больше, чем можете позволить себе потерять.

## Для пользователей

- Канонические команды и матчи с указанием источника, свежести и ограничений данных.
- Хронологическая история команд и формы без утечки будущих данных.
- Вероятностные прогнозы, ручной ввод коэффициентов и расчёт value только при прохождении всех проверок.
- Прозрачные состояния «данных недостаточно», устаревших или неподдерживаемых данных.

## Статус и ограничения MVP

Завершены фазы 1–2 из 6: надёжное обнаружение матчей и исторический evidence pipeline. Фазы прогнозов/value, settlement, расширения провайдеров и release experience находятся в roadmap. MVP использует бесплатные тарифы и ручные коэффициенты; автоматические ставки, гарантии и скрытое управление риском отсутствуют.

## Технологический стек

Node.js 24, TypeScript 5.9, pnpm 10, Turborepo 2, Next.js 16/React 19, Tailwind CSS, NestJS 11, PostgreSQL 18, Prisma 7, Redis 8, BullMQ 6, Vitest и Playwright.

## Структура monorepo

```text
apps/web/              Next.js веб-приложение
apps/api/              NestJS REST API
workers/data-sync/     фоновые jobs синхронизации
packages/              общие domain, config, database и provider-пакеты
infra/docker-compose.yml  локальные PostgreSQL и Redis
.planning/             roadmap, планы и артефакты GSD
```

## Требования и локальный запуск

Нужны Node.js `>=24 <25`, pnpm `10.34.5` и Docker с Compose.

```bash
pnpm install --frozen-lockfile
Copy-Item .env.example .env
docker compose -f infra/docker-compose.yml up -d
pnpm build
pnpm dev
```

Переменные окружения находятся в `.env.example`. Заполните только значения для своего окружения; секреты не коммитьте. Docker Compose поднимает PostgreSQL и Redis, а веб, API и worker запускаются командами monorepo.

## Команды разработчика

```bash
pnpm build
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:e2e
```

## Roadmap

1. Trustworthy Fixture Discovery — завершено.
2. Historical Evidence Pipeline — завершено.
3. Forecast and Manual Value Workbench — прогнозы и ручные коэффициенты.
4. Settlement and Evidence Scorecard — измерение качества и финансового результата.
5. Provider-Aware Coverage and Enrichment — дополнительные соревнования и evidence.
6. Release Experience and Operations — мобильный UX, методология и операционный контроль.

---

# Football Prediction & Value Betting Platform (English)

A transparent football analytics platform for upcoming fixtures, reproducible event probabilities, and comparison with user-entered bookmaker odds. It does not provide guaranteed tips or place bets automatically.

> **Responsible use.** For adults only and only where lawful. Analytics are not financial advice and do not guarantee outcomes. Betting involves the risk of losing money; never stake more than you can afford to lose.

## For users

- Canonical teams and fixtures with source, freshness, and data limitations.
- Chronological team history and form features without future-data leakage.
- Probabilistic forecasts, manual odds entry, and value calculations only when all gates pass.
- Explicit insufficient, stale, or unsupported-data states.

## Status and MVP limits

Phases 1–2 of 6 are complete: trustworthy fixture discovery and the historical evidence pipeline. Forecast/value, settlement, provider breadth, and release-experience phases remain on the roadmap. The MVP uses free tiers and manual odds; automatic wagering, certainty claims, and hidden risk controls are out of scope.

## Technology stack

Node.js 24, TypeScript 5.9, pnpm 10, Turborepo 2, Next.js 16/React 19, Tailwind CSS, NestJS 11, PostgreSQL 18, Prisma 7, Redis 8, BullMQ 6, Vitest, and Playwright.

## Monorepo structure

```text
apps/web/                 Next.js web application
apps/api/                 NestJS REST API
workers/data-sync/        background synchronization jobs
packages/                 shared domain, config, database, and provider packages
infra/docker-compose.yml  local PostgreSQL and Redis
.planning/                roadmap, plans, and GSD artifacts
```

## Requirements and local setup

You need Node.js `>=24 <25`, pnpm `10.34.5`, and Docker Compose.

```bash
pnpm install --frozen-lockfile
Copy-Item .env.example .env
docker compose -f infra/docker-compose.yml up -d
pnpm build
pnpm dev
```

Environment variables are documented in `.env.example`. Set only values for your environment and never commit secrets. Docker Compose starts PostgreSQL and Redis; the web app, API, and worker run through the monorepo commands.

## Developer commands

```bash
pnpm build
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:e2e
```

## Roadmap

1. Trustworthy Fixture Discovery — complete.
2. Historical Evidence Pipeline — complete.
3. Forecast and Manual Value Workbench — forecasts and manual odds.
4. Settlement and Evidence Scorecard — quality and financial-outcome measurement.
5. Provider-Aware Coverage and Enrichment — broader competitions and evidence.
6. Release Experience and Operations — mobile UX, methodology, and operational controls.

This repository currently has no declared license file. Contributions and usage remain subject to the repository owner’s policies.
