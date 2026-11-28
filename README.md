# Football Prediction & Value Betting Platform

Веб-приложение «Матчдей» для футбольной аналитики: матчи топ-лиг Европы, воспроизводимые вероятностные оценки, сравнение этих оценок с коэффициентами, которые пользователь вводит вручную, и измерение качества прогнозов после завершения матчей.

Главная цель проекта: честные и воспроизводимые оценки вероятностей, качество которых можно проверить по каждому завершённому матчу.

## Чем платформа не является

- **Это не советы по ставкам.** «Кандидат value» означает расхождение между оценкой модели и введённым коэффициентом. Это не рекомендация и не обещание прибыли. Исход любого матча остаётся неопределённым.
- **Автоматических ставок нет.** Приложение не подключается к букмекерам, не размещает ставки и не управляет деньгами.
- **Только 18+** и только там, где это разрешено законом. Ставки связаны с риском потерять деньги.
- Коэффициенты не загружаются у букмекеров: они вводятся вручную.

## Статус

- v1.0 MVP (фазы 1–6) выпущен.
- v1.1: фазы 7–15 завершены (CI, резервные копии, оповещения о деградации, бюджеты производительности, модель Диксона — Коулза, калибровка, CLV, азиатский гандикап и точный счёт, сканер value).
- Фаза 16 (журнал виртуальных сделок) ещё не реализована.

Актуальное состояние: [.planning/ROADMAP.md](.planning/ROADMAP.md) и [.planning/STATE.md](.planning/STATE.md).

## Возможности и страницы

| Страница | Что на ней |
|---|---|
| `/` | Обзор разделов. Матчи, цифры и кривая калибровки на этой странице иллюстративные. |
| `/fixtures` | Предстоящие матчи по дням, фильтры по периоду и соревнованию, ручные кнопки «Обновить матчи» и «Загрузить результаты». |
| `/fixtures/[fixtureId]` | Снимки прогнозов и сравнение ревизий, ручной ввод коэффициентов, квитанции value, азиатский гандикап и точный счёт. |
| `/teams/[teamId]/evidence` | Исторические доказательства по команде на выбранный момент: форма, Эло, отдых, личные встречи. |
| `/scanner` | Сводный список кандидатов value на ближайшие 7 суток по всем рынкам. Значения берутся из сохранённых квитанций, список не ранжируется. |
| `/scorecards` | Brier Score, Log Loss, корзины калибровки, CLV, а также ROI и yield как вторичные описательные показатели. |
| `/methodology` | Входы, исключения, уверенность и ограничения моделей. |
| `/faq` | Пошаговая инструкция пользователя со снимками экрана. |
| `/privacy` | Согласие на хранение истории и его отзыв. |
| `/internal/operations` | Операторский «Центр операций»: готовность, резервные копии, оповещения, поставщики, квоты, неудачные задачи. Вход через шлюз оператора. |
| `/internal/reconciliation` | Очередь проверки неоднозначных сопоставлений (операторская). |
| `/internal/pipeline/replay` | Безопасный повтор обработки данных (операторская). |

Основные правила работы:

- **Модели.** По умолчанию новые прогнозы выпускаются версией `dixon-coles-ensemble-v1`; `poisson-ensemble-v1` можно выбрать через `FORECAST_MODEL_VERSION`.
- **Рынки.** `ONE_X_TWO`, `OVER_UNDER_2_5`, `BTTS`, `ASIAN_HANDICAP` (линии от −2.5 до +2.5 с шагом 0.25), `EXACT_SCORE`.
- **Неизменяемость.** Снимки прогнозов, книги коэффициентов и квитанции не переписываются задним числом.
- **Правило value (`value-policy-v1`)** для трёх основных рынков: уверенность не ниже 0.65, преимущество не ниже 0.03 и ожидаемое value не ниже 0.05, при этом доказательства должны пройти проверки качества. Пороги заданы в коде и не настраиваются через окружение.
- **Соревнования.** Скрипт `scripts/seed-configured-leagues.mjs` заводит Premier League, La Liga, Bundesliga, Serie A, Ligue 1 и UEFA Champions League (провайдер football-data.org). API-Football служит резервным и дополнительным провайдером; его идентификаторы лиг этот скрипт не заполняет, а доступность соревнований зависит от тарифа.

## Стек

| Область | Технологии |
|---|---|
| Среда | Node.js 24, pnpm 10.34.5, Turborepo 2, TypeScript 5.9.3 |
| Веб | Next.js 16.3 (App Router), React 19.2 |
| API | NestJS 11 на Express |
| Данные | PostgreSQL 18, Prisma 7.10 с `@prisma/adapter-pg` |
| Очереди | Redis 8, BullMQ 6, Cockatiel |
| Расчёты и валидация | `decimal.js`, Zod 4 |
| Проверки | Vitest 4, Playwright 1.62, ESLint 9, Lighthouse |

## Структура монорепозитория

```text
apps/
  web/            # @bet-stats/web: интерфейс Next.js и прокси /internal-api/*
  api/            # @bet-stats/api: REST API на NestJS
workers/
  data-sync/      # @bet-stats/data-sync: фоновые задачи (синхронизация, прогнозы, расчёты, бэкапы, оповещения, калибровка)
packages/
  domain/         # @bet-stats/domain: чистая доменная логика (модели, рынки, value, оценка качества)
  database/       # @bet-stats/database: схема Prisma, миграции, репозитории
  config/         # @bet-stats/config: чтение и проверка окружения
  football-data/  # @bet-stats/football-data: адаптеры внешних поставщиков данных
infra/            # Docker Compose, Dockerfile и шлюз оператора
scripts/          # запуск, сборка, сид, операторские и проверочные скрипты
tests/            # unit, integration и e2e
docs/             # дополнительные инструкции
.planning/        # артефакты планирования GSD
```

Действующая схема базы: [packages/database/prisma/schema.prisma](packages/database/prisma/schema.prisma). Файл `schema.prisma` в корне — не она.

## Требования

- Node.js `>=24.0.0 <25`
- pnpm `10.34.5` (через Corepack); в `.npmrc` включён `engine-strict`
- Docker с Compose v2
- PowerShell 7 (`pwsh`) для скриптов запуска; сценарий запуска рассчитан на Windows
- Токен football-data.org и ключ API-Football для работы с реальными данными

## Локальный запуск

### 1. Клонирование и зависимости

```powershell
git clone https://github.com/VadyaLegolas/bet-stats.git
```

```powershell
cd bet-stats
```

```powershell
corepack enable
```

```powershell
pnpm install --frozen-lockfile
```

### 2. Файл `.env`

```powershell
Copy-Item .env.example .env
```

Замените все значения-заглушки. Отдельный секрет можно сгенерировать так:

```powershell
[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLowerInvariant()
```

В `.env.example` нет части переменных, без которых локальный стек неполон. Добавьте их в `.env`:

```dotenv
# Тот же пароль, что и в POSTGRES_PASSWORD
DATABASE_URL=postgresql://football_prediction:<POSTGRES_PASSWORD>@127.0.0.1:5432/football_prediction
# Без ключа воркер data-sync не запускает фоновые задачи
API_FOOTBALL_API_KEY=<ваш ключ>
# Доступ к прогнозам, коэффициентам, value, сканеру и ведомостям
ELIGIBILITY_ALLOWED_REGIONS=PL
ELIGIBILITY_REGION=PL
ELIGIBILITY_AGE_ACKNOWLEDGED=true
```

`PL` здесь пример: укажите двухбуквенный код своего региона и подтверждайте возраст только если это правда. Без этих переменных защищённая аналитика закрыта (API отвечает `403`) — так задумано.

Не коммитьте `.env`.

### 3. Первый запуск

На чистом клоне сначала соберите проект: сценарий запуска заполняет каталог лиг раньше своей сборки и использует `packages/database/dist`.

```powershell
pnpm build
```

```powershell
pwsh -File scripts/app-lifecycle.ps1
```

[scripts/app-lifecycle.ps1](scripts/app-lifecycle.ps1) загружает `.env`, поднимает PostgreSQL и Redis из `infra/docker-compose.yml`, применяет миграции, заполняет каталог лиг, собирает проект, запускает web, API и воркер в фоне, затем шлюз оператора и открывает браузер. Режим поставщиков при этом всегда `live`.

| Служба | Адрес |
|---|---|
| Веб-интерфейс | `http://127.0.0.1:3000` |
| API | `http://127.0.0.1:3001` (проверка: `/health/live`) |
| Шлюз оператора | `http://127.0.0.1:8080/internal/operations` |
| PostgreSQL | `127.0.0.1:5432` |
| Redis | `127.0.0.1:6379` |

Логи: `%TEMP%\bet-stats-stack.log` и `%TEMP%\bet-stats-gateway.log`.

Состояние стека:

```powershell
pwsh -File scripts/app-lifecycle.ps1 -Action Status
```

Остановка:

```powershell
pwsh -File scripts/app-lifecycle.ps1 -Action Stop
```

Ключ `-NoBrowser` отключает открытие браузера. Для запуска двойным щелчком есть `scripts/start-app.bat` и `scripts/stop-app.bat`.

> **Внимание.** Сценарий принудительно завершает процессы, занявшие порты 3000 и 3001, если стек на них не отвечает. `-Action Stop` завершает процессы на портах 3000, 3001 и порту шлюза, а также процессы `turbo run dev`. Контейнеры Docker при этом продолжают работать.

Остановить контейнеры:

```powershell
docker compose -f infra/docker-compose.yml --env-file .env down
```

### Запуск по шагам

Приложения не читают корневой `.env` сами: переменные должны быть в окружении процесса. После того как они заданы в текущем терминале:

```powershell
docker compose -f infra/docker-compose.yml --env-file .env up -d
```

```powershell
pnpm --filter @bet-stats/database exec prisma migrate deploy
```

```powershell
pnpm build
```

```powershell
node scripts/seed-configured-leagues.mjs
```

```powershell
pnpm exec turbo run dev --env-mode=loose
```

Для реальных данных нужно `DATA_PROVIDER_MODE=live` (по умолчанию `deterministic`) и `REDIS_URL=redis://127.0.0.1:6379`. Горячая перезагрузка есть только у web; API и воркер запускаются из `dist`, после их изменения нужна повторная сборка.

## Переменные окружения

Шаблон с комментариями: [.env.example](.env.example).

| Переменные | Назначение |
|---|---|
| `POSTGRES_PASSWORD` | Пароль PostgreSQL в Docker Compose. `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PORT`, `REDIS_PORT` необязательны |
| `DATABASE_URL`, `REDIS_URL` | Подключения приложений (сценарий запуска подставляет `REDIS_URL`, если он не задан) |
| `FOOTBALL_DATA_API_TOKEN`, `API_FOOTBALL_API_KEY` | Доступ к поставщикам данных |
| `DATA_PROVIDER_MODE` | `live` или `deterministic` |
| `FORECAST_MODEL_VERSION` | `dixon-coles-ensemble-v1` (по умолчанию) или `poisson-ensemble-v1` |
| `ELIGIBILITY_ALLOWED_REGIONS`, `ELIGIBILITY_REGION`, `ELIGIBILITY_AGE_ACKNOWLEDGED` | Проверка региона и возраста |
| `DISPLAY_TIME_ZONE` | Часовой пояс интерфейса; сценарий запуска по умолчанию берёт `Europe/Warsaw`, без него часть страниц использует `UTC` |
| `API_HOST`, `API_PORT`, `API_ORIGIN` | Адрес API; по умолчанию `127.0.0.1:3001` |
| `GATEWAY_PORT`, `WEB_ORIGIN` | Порт шлюза оператора и адрес web за ним |
| `OPERATOR_BASIC_USERNAME`, `OPERATOR_BASIC_PASSWORD`, `OPERATOR_SUBJECT`, `OPERATOR_PROXY_SIGNING_SECRET`, `OPERATOR_AUTHORIZED_SUBJECTS` | Вход оператора через шлюз и подпись запросов (секрет не короче 32 символов) |
| `OPERATOR_CREDENTIAL` | Заголовок `x-operator-credential` для операторских маршрутов API |
| `AUTH_SESSION_SIGNING_SECRET`, `PRIVACY_*`, `DEV_TRUSTED_SESSION_ISSUER` | Раздел конфиденциальности; для локальной демонстрации см. комментарии в `.env.example` |
| `POSTGRES_READY`, `REDIS_READY` | Значение `true` помечает зависимость готовой в `/health/ready` и в Центре операций |
| `ALERTS_ENABLED`, `ALERT_WEBHOOK_URL`, `ALERTS_TICK_MS`, `ALERTS_WEBHOOK_TIMEOUT_MS` | Оповещения о деградации (по умолчанию выключены) |
| `BACKUP_ENABLED`, `BACKUP_DIR` | Включение резервных копий; каталог задаётся абсолютным путём |
| `BACKUP_OFFSITE_DIR`, `BACKUP_RETENTION_COUNT`, `BACKUP_DRILL_INTERVAL_HOURS` | Копия вне сервера (через `robocopy`), число хранимых дампов (по умолчанию 14), период проверки восстановления (по умолчанию 168 часов) |
| `PG_BIN`, `BACKUP_PG_CONTAINER`, `BACKUP_PG_USER`, `BACKUP_PG_DB` | Где и как запускать `pg_dump` |

Дампы базы содержат те же данные, что и сама база, включая персональные, пока не будут удалены ротацией. Ограничьте доступ к каталогам резервных копий.

## Стек с шлюзом оператора в контейнерах

[infra/docker-compose.operator.yml](infra/docker-compose.operator.yml) описывает отдельное окружение, в котором наружу опубликован только шлюз на порту `8080`:

```powershell
docker compose -f infra/docker-compose.operator.yml --env-file .env up -d --build
```

Ограничение: этот файл не передаёт контейнерам `API_FOOTBALL_API_KEY` и переменные `ELIGIBILITY_*`, а образ работает с `NODE_ENV=production`, где ключ API-Football обязателен для проверки конфигурации. Перед использованием дополните файл; для обычной разработки пользуйтесь `scripts/app-lifecycle.ps1`.

## Операторские команды

Командам нужны собранный проект и переменные окружения.

- Закрывающие коэффициенты для CLV (`DATABASE_URL`): `node scripts/closing-odds.mjs record ...`, подробности в [docs/closing-odds-operator.md](docs/closing-odds-operator.md).
- Сравнение двух версий модели на бэктестах (`DATABASE_URL`, `REDIS_URL`, запущенный воркер):

```powershell
pnpm model:compare run --from 2026-08-01T00:00:00Z --to 2026-11-01T00:00:00Z
```

## Проверки

| Команда | Что делает |
|---|---|
| `pnpm typecheck` | Проверка типов во всех пакетах |
| `pnpm lint` | ESLint через Turbo |
| `pnpm test` | Unit-тесты Vitest и тесты веб-приложения |
| `pnpm test:integration:docker` | Интеграционные тесты с временными контейнерами PostgreSQL и Redis, которые создаются и удаляются автоматически |
| `pnpm test:integration` | Те же тесты без подготовки окружения: базу и Redis нужно обеспечить самостоятельно |
| `pnpm test:e2e` | Playwright с `playwright.config.ts`; сам запускает API и web на портах 3001 и 3000, поэтому они должны быть свободны. Часть спецификаций рассчитана на другие конфигурации `playwright.*.config.ts` |
| `pnpm verify:scanner` | E2E сканера value на заглушке API (порты 3251 и 3252), без базы данных |
| `pnpm verify:release` | Полный выпускной прогон: Node 24 и Docker, установка по lockfile, проверка схемы Prisma, типы, unit- и интеграционные тесты, сборка, набор выпускных E2E и `verify:scanner` |
| `pnpm build` | Сборка всех пакетов. Если работает dev-сервер web, сборка уходит в `.next-gate` |

Перед `pnpm test` и интеграционными тестами на чистом клоне соберите пакеты (`pnpm build`). Для E2E один раз установите браузер:

```powershell
pnpm exec playwright install chromium
```

CI ([.github/workflows/ci.yml](.github/workflows/ci.yml)) на каждый push в `main` и pull request запускает задания `quality`, `integration`, `e2e-portable` и `performance-budget`. Команда `pnpm lint` входит в CI, но не в `verify:release`.

## Документация

| Документ | Содержание |
|---|---|
| [docs/closing-odds-operator.md](docs/closing-odds-operator.md) | Запись коэффициентов закрытия |
| [SPEC.md](SPEC.md) | Исходная спецификация (на английском) |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Исходная архитектурная схема |
| [MONOREPO_STRUCTURE.md](MONOREPO_STRUCTURE.md) | Рекомендованная на старте структура; фактическая описана выше |
| [football-prediction-spec/ru/](football-prediction-spec/ru/) | Русская версия исходной спецификации |
| [.planning/PROJECT.md](.planning/PROJECT.md) | Цели, ограничения и принятые решения |
| [.planning/REQUIREMENTS.md](.planning/REQUIREMENTS.md) | Требования текущего этапа |
| [.planning/ROADMAP.md](.planning/ROADMAP.md) | Дорожная карта |
| [AGENTS.md](AGENTS.md), [CONVENTIONS.md](CONVENTIONS.md) | Правила работы с репозиторием: интерфейс на русском, идентификаторы и коммиты на английском |
