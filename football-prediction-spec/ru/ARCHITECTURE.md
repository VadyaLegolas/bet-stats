# Архитектура проекта

## 1. Общая схема

```text
Free Football APIs
        |
        v
Data Collector
        |
        +--> Redis Cache
        |
        v
PostgreSQL + Prisma
        |
        +--> Feature Engine
        +--> Elo Engine
        +--> Poisson Engine
        +--> Odds Engine
        +--> Value Bet Engine
        +--> Backtest Engine
        |
        v
NestJS REST API
        |
        v
Next.js / React
```

## 2. Компоненты

### apps/web
Пользовательский интерфейс:
- список матчей;
- карточка матча;
- прогнозы;
- value bets;
- статистика моделей;
- backtesting.

### apps/api
Основной backend:
- REST API;
- orchestration;
- auth в будущем;
- конфигурация турниров;
- доступ к БД;
- постановка background jobs.

### workers/data-sync
Фоновые задачи:
- fixtures sync;
- results sync;
- standings sync;
- injuries sync;
- lineups sync;
- odds sync.

### packages/database
- Prisma schema;
- Prisma Client;
- migrations;
- seed.

### packages/domain
Общие доменные типы и enum.

### packages/football-data
Абстракция над внешними источниками данных. Провайдеры разделены по ролям — не все реализуют один и тот же интерфейс, потому что не у всех источников одна и та же ответственность (см. SPEC.md п.3).

```ts
// Прод-источники live-данных (fixtures, standings, lineups)
interface FootballDataProvider {
  getUpcomingFixtures(): Promise<FixtureDto[]>;
  getTeamRecentMatches(teamId: string): Promise<FixtureDto[]>;
  getStandings(leagueId: string): Promise<StandingDto[]>;
  getInjuries(fixtureId: string): Promise<InjuryDto[]>;   // может бросить NotCoveredError
  getLineups(fixtureId: string): Promise<LineupDto[]>;
  getOdds(fixtureId: string): Promise<OddsDto[]>;          // может бросить NotCoveredError
  getCoverage(leagueId: string, season: string): Promise<CoverageFlagsDto>;
}
// Реализации: FootballDataOrgProvider (основной, топ-5+ЧЛ),
// ApiFootballProvider (резерв топ-5+ЧЛ, основной для EL/UECL)

// Entity-aid источник — только для нормализации имён/логотипов,
// не участвует в получении статистики матчей
interface EntityResolutionProvider {
  searchTeamByName(name: string, country?: string): Promise<TeamCandidateDto[]>;
  getTeamLogo(externalId: string): Promise<string | null>;
}
// Реализация: TheSportsDbProvider

// Офлайн/training-only источники — вызываются только батчевыми джобами
// вне пользовательского пути, никогда синхронно при обработке live-матча
interface HistoricalStatsProvider {
  getHistoricalMatchEvents(competitionId: string, season: string): Promise<MatchEventsDto[]>;
}
// Реализации: StatsBombOpenDataProvider (training-only, ограниченный набор турниров/сезонов),
// FBrefProvider (historical-only с января 2026 — текущий сезон xG не обновляется)

// Caution-источник — неофициальный доступ, не обязательная зависимость MVP
interface CautionStatsProvider {
  getXgStats(teamId: string, season: string): Promise<XgStatsDto[]>;
}
// Реализация: UnderstatProvider (unofficial scraping, строгий rate-limit и кэш)
```

### packages/prediction
Содержит:
- Elo;
- Poisson;
- feature builder;
- probability normalization;
- market calculations.

### packages/value-betting
Содержит:
- implied probability;
- overround removal;
- edge;
- EV;
- value-bet filters.

### packages/backtesting
Содержит:
- Brier Score;
- Log Loss;
- calibration;
- ROI/Yield;
- model comparison.

## 3. Потоки данных

### Утренний sync
1. Получить fixtures на сегодня и ближайшие 48 часов.
2. Обновить завершённые матчи.
3. Обновить standings.
4. Вычислить признаки.
5. Создать INITIAL snapshot.

### Перед матчем
1. Проверить injuries.
2. Проверить odds.
3. Пересчитать PRE_MATCH snapshot.
4. Ближе к kickoff проверить lineups.
5. При наличии официального состава создать LINEUP_CONFIRMED snapshot.

### После матча
1. Сохранить результат.
2. Обновить Elo.
3. Рассчитать backtest metrics.
4. Зафиксировать результат BetCandidate.

## 4. Защита от превышения лимитов

DailyApiBudget ведётся отдельно по каждой комбинации provider + date + endpointType (см. schema.prisma), а не одной общей цифрой — иначе приоритет ниже нечем enforce'ить программно: воркер обязан проверять остаток бюджета именно для нужного типа эндпоинта перед вызовом.

Приоритет:
- CRITICAL (1): fixtures/results;
- HIGH (2): lineups;
- MEDIUM (3): injuries/odds — **только если coverage-флаг провайдера подтверждает доступность на free-тарифе**, иначе эндпоинт не вызывается вообще и данные считаются недоступными (см. SPEC.md п.3);
- LOW (4): второстепенная статистика.

Перед первым вызовом любого эндпоинта для лиги/сезона воркер должен прочитать `coverage`-объект провайдера (если он есть в API) и закэшировать результат — это экономит дневной бюджет запросов, не тратя его на заведомо недоступные данные.

## 4.1 Entity Matching и Fixture Reconciliation

Проблема: у API-Football и football-data.org разные внешние ID для одной и той же команды/игрока/матча. Если хранить provider+externalId прямо на Team/Fixture, переключение на fallback-источник создаёт дубли вместо продолжения истории той же сущности.

Решение — слой канонических сущностей (см. schema.prisma):
- `Team` / `Player` / `League` — канонические, без привязки к провайдеру;
- `TeamExternalRef` / `PlayerExternalRef` / `LeagueExternalRef` — связь конкретного provider+externalId с канонической сущностью, с полем `matchedBy` (exact_id / fuzzy_name / manual_admin) для аудита;
- `FixtureExternalRef` — то же самое для матчей; реконсиляция матча выполняется по паре (canonical homeTeamId, canonical awayTeamId) + kickoff в окне ±36 часов, а не по прямому совпадению внешнего ID.

Пайплайн синхронизации при получении данных от нового провайдера:
1. Найти существующий `TeamExternalRef` по (provider, externalId) — если есть, дальше работать с привязанным каноническим Team.
2. Если нет — искать каноническую Team по имени (нормализованному) + стране. При совпадении — создать новый `TeamExternalRef`, привязав к найденной Team.
3. При неоднозначном совпадении (несколько кандидатов или низкая уверенность fuzzy-match) — не создавать автоматически, а класть запись в очередь ручной проверки в админке.
4. Аналогично для Fixture: сначала поиск по `FixtureExternalRef`, затем по паре канонических команд + окну по дате.

Все автоматические сопоставления логируются с `matchedBy` и timestamp, чтобы можно было выборочно проверить и откатить ошибочные fuzzy-match решения.

## 5. Кэширование

Redis TTL:
- fixtures: 6 часов;
- standings: 12 часов;
- injuries: 3 часа;
- odds: 30–60 минут;
- lineups: 10 минут перед матчем;
- исторические результаты: бессрочно в PostgreSQL.

## 6. Надёжность

- idempotent jobs;
- unique constraints на внешние IDs (через *ExternalRef таблицы, см. 4.1);
- retry с exponential backoff;
- логирование provider errors в `DataQualityLog` (используется для sourceReliabilityScore в Confidence Score, см. SPEC.md п.10.1);
- circuit breaker для нестабильных API;
- snapshots не обновляются после создания;
- **Europa League / Conference League**: у этих турниров нет резервного источника вообще — их покрывает только API-Football (football-data.org free-тариф их не включает). Поэтому circuit breaker при деградации API-Football не может переключиться на football-data.org для этих турниров; вместо бесконечных ретраев статус данных должен помечаться как "ограничен" в UI (см. SPEC.md п.3.5).

## 7. Масштабирование

MVP может работать как один backend + один worker.

Позже можно разделить:
- ingestion service;
- prediction service;
- ML service;
- backtest service.
