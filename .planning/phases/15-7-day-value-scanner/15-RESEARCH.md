# Phase 15: 7-Day Value Scanner - Research

**Researched:** 2026-11-25
**Domain:** Прямой (forward-looking) читающий запрос по `ValueReceipt` в окне 7 суток, серверная страница без клиентского JS, дословный показ сохранённых строк, честное понижение по свежести, расширение словаря ответственной игры на русский.
**Confidence:** HIGH (схема БД, SQL-запрос, планы, поведение Prisma/adapter-pg и кодовая база прочитаны или запущены в этой сессии); MEDIUM по двум дискреционным решениям (пороги свежести, граница усечения), вынесены в Open Questions.

Язык документа: проза на русском (AGENTS.md и просьба оркестратора), заголовки разделов и идентификаторы английские (их ждёт планировщик). Новых внешних пакетов фаза не требует: Package Legitimacy Gate не применяется.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

Все решения приняты по рекомендации (пользователь велел решать самому, 2026-11-25).

**Что считать кандидатом**
- **D-01:** Кандидат это самая свежая неперекрытая `ValueReceipt` (нет строки с `supersedesValueReceiptId` на неё) для тройки (матч, рынок, выбор) с исходом `VALUE_CANDIDATE`, у которой снимок прогноза выпущен (`ISSUED`, `PRODUCTION`, не `BACKTEST`), а матч запланирован и начинается в окне `[сейчас, сейчас + 7 суток)` по UTC. Окно считается по времени начала матча, а не по времени квитанции.
- **D-02:** Квитанции с исходом не `VALUE_CANDIDATE` (например `INSUFFICIENT_EVIDENCE`, `NO_VALUE`) в список не попадают, но участвуют в счётчиках диагностики пустого состояния (D-10). — **Reversibility:** reversible — чисто запросная логика.
- **D-03:** Новый отдельный эндпоинт чтения `GET /value/scanner` в модуле `apps/api/src/modules/value`, а не расширение `evaluation/value-candidates` (тот модуль относится к рассчитанной истории). Один SQL-запрос с соединениями (матч, команды, снимок коэффициентов, снимок прогноза), без запросов в цикле (N+1). Потолок выдачи 200 строк с явным признаком усечения. — **Reversibility:** costly — публичный контракт эндпоинта, на него опирается страница и фаза 16 (глубокие ссылки).

**Дословность значений**
- **D-04:** Edge, ожидаемое value, коэффициент и вероятности показываются как сохранённые строки (`edge`, `expectedValue` и др. в `ValueReceipt` это `VARCHAR`), без `Number()`, округления и переформатирования значения. Единицу измерения и подпись задаёт интерфейс, само число не трогается. Для АГ показывается эффективная вероятность и определение edge из блока `extended` квитанции так же, как на странице матча. Тест сравнивает отображаемую строку с хранимой побайтово.
- **D-05:** Источник коэффициентов это метка источника из снимка коэффициентов (`source`) и время его фиксации; ссылка ведёт на страницу матча и на исходную квитанцию.

**Свежесть и понижение**
- **D-06:** Свежесть считается от времени фиксации снимка коэффициентов (`ManualOddsSnapshot.submittedAt`) относительно текущего момента. Три уровня: свежие (до 6 часов), стареющие (6–24 часа), устаревшие (больше 24 часов). Пороги это именованные константы версии `scanner-freshness-v1`, значения подтверждаются планировщиком.
- **D-07:** Дополнительный флаг «после квитанции вышел более новый снимок прогноза»: показывается пометкой «прогноз обновлён», строка не скрывается.
- **D-08:** Понижение выражено только оформлением и размещением: устаревшие строки уходят в отдельный сворачиваемый блок «Устаревшие коэффициенты» внизу (элемент `details`, без клиентского JS), стареющие получают приглушённую метку. Edge и EV устаревших строк остаются видимыми и дословными. Скрывать или пересчитывать нельзя. — **Reversibility:** reversible — оформление.

**Порядок и группировка**
- **D-09:** Порядок: по времени начала матча по возрастанию, затем по порядку рынков (1X2, тотал, обе забьют, АГ, точный счёт), затем по выбору. Никакой сортировки или ранжирования по edge, EV или вероятности, ни по умолчанию, ни по кнопке. Строки сгруппированы по матчам (заголовок матча с лигой, временем в Europe/Warsaw и ссылкой). Нет слов «лучшие», «топ», «горячие».

**Состояния страницы**
- **D-10:** Четыре явных состояния, каждое со своим текстом на русском:
  - **AVAILABLE:** есть кандидаты.
  - **EMPTY:** запрос успешен, кандидатов нет; показываются счётчики «проверено квитанций в окне: N» и разбивка по исходам, чтобы пустота была объяснима.
  - **UNAVAILABLE:** ошибка чтения или недоступность API; текст без выдуманных причин и кнопка «Обновить страницу».
  - **POLICY-UNMET (информационная плашка внутри EMPTY):** если все квитанции окна имеют причину `POLICY_CONFIG_MISMATCH`, показывается нейтральная пояснительная плашка со ссылкой на методологию (ограничение версии конфигурации value-политики). Саму политику фаза не меняет.

**Место на сайте**
- **D-11:** Отдельная страница `/scanner` («Сканер value») в `apps/web/app/scanner`, серверный компонент, данные через `internal-api` по образцу `apps/web/app/scorecards`. Пункт в `release-navigation.tsx` рядом с «Матчи» и «Результаты», ссылка с главной страницы. Строки ведут на `/fixtures/{id}`. Клиентский JS новый не добавляется: бюджет `scriptTransferBytes` уже превышен до фазы (5 960 160 при 5 500 000), страница не должна увеличивать клиентский пакет и не импортирует барель `@bet-stats/domain` на клиенте. — **Reversibility:** costly — маршрут и пункт навигации становятся публичным адресом.

**Ответственная игра и тексты**
- **D-12:** Постоянный дисклеймер (`RiskDisclosure` и 18+) и верхняя строка «Кандидаты value — это оценка модели, а не рекомендация и не обещание прибыли». Без призывов к срочности, без слов о гарантиях и уверенности. Словарь запрещённых слов и проверки русских текстов в `tests/unit/responsible-copy.test.ts` расширяются на новую страницу и новые модули. Все пользовательские тексты на русском, идентификаторы на английском.

**Данные и индексы**
- **D-13:** Новых таблиц и столбцов нет, только чтение. Планировщик проверяет планы запросов по существующим индексам `ValueReceipt`, `ForecastSnapshot`, `ManualOddsSnapshot`, `Fixture`; индекс добавляется отдельной прямой миграцией только если замер показывает необходимость. — **Reversibility:** reversible — запросная логика.

### Claude's Discretion

Точные значения порогов свежести внутри предложенных диапазонов, вёрстка карточки строки (таблица против списка на узком экране, с учётом урока 14-09 про сетки на 320 px), точные формулировки русских текстов состояний, формат времени фиксации коэффициентов.

### Deferred Ideas (OUT OF SCOPE)

- Фильтры по лигам, рынкам и порогам свежести на странице сканера: отдельная фаза.
- Уведомления и подписки на новые кандидаты: отдельная фаза.
- Пересмотр привязки value-политики к `forecast-config-v1` (из-за неё кандидатов по dixon-coles нет): отдельное решение владельца политики, вне фазы 15.

None — других идей за рамками фазы не возникало.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SCAN-01 | Сводный список кандидатов value на 7 суток по матчам и рынкам: матч, рынок, выбор, edge, EV, источник коэффициентов | Единый SQL «latest per triple» с DISTINCT ON + NOT EXISTS (раздел Code Examples, план выполнения проверен на 112 тыс. синтетических квитанций: 50-75 мс); DTO эндпоинта `GET /value/scanner`; порядок рынков и выборов параметрами `array_position`; усечение по границе матча |
| SCAN-02 | Дословный показ сохранённых edge без пересчёта; понижение по свежести; явные EMPTY против UNAVAILABLE | Значения читаются из столбцов `VARCHAR(128)`, а не из `jsonb`; в API нет `Number()`; свежесть и флаг «прогноз обновлён» считает API по одному `generatedAt` (инжектируемые часы); fail-closed разбор ответа на странице; счётчики EMPTY и `allPolicyConfigMismatch` приходят из того же запроса |
| SCAN-03 | Ответственный язык (нет срочности и гарантий, постоянные дисклеймеры) и отсутствие N+1 | Расширение `responsible-copy.test.ts` юникодными стемами (флаги `iu`, лукбихайнд `(?<![\p{L}])`, проверено); доказательство отсутствия N+1: инвариантность числа SQL-запросов при 1 и 60 кандидатах через событие `query` Prisma (проверено) |
</phase_requirements>

## Summary

Фаза читающая: ни одной миграции, ни одной новой зависимости. Главный технический объект это один SQL-запрос по `ValueReceipt`, который в одном снимке БД отдаёт и список кандидатов (с соединениями на матч, команды, лигу, снимок коэффициентов, снимок прогноза, выбор коэффициента), и сводку для пустого состояния (число проверенных квитанций, разбивка по исходам, признак «все с `POLICY_CONFIG_MISMATCH`»). Запрос проверен на одноразовом PostgreSQL 18.6 с 12 000 матчей и 112 000 квитанций (3 738 в окне, 373 кандидата): 50-75 мс, все соединения по первичным ключам, существующие индексы достаточны, **индексная миграция не нужна** (решение D-13 подтверждено замером). На dev-БД окно сейчас содержит 0 квитанций (59 запланированных матчей без квитанций), поэтому реальный сценарий dev это EMPTY с `checkedCount = 0`.

Самая важная находка: **ни один путь кода не пишет `supersedesValueReceiptId`** (grep по всему репозиторию: только схема, миграция и комментарий `backup-drill.ts`; в dev-БД 0 из 46 строк). Квитанция однозначно идентифицируется парой (снимок прогноза, снимок коэффициентов, рынок, выбор), и на одну тройку (матч, рынок, выбор) уже сегодня приходится несколько квитанций (24 тройки в dev-БД). Поэтому «самая свежая неперекрытая» (D-01) реализуется как `DISTINCT ON (fixtureId, market, selection) ORDER BY createdAt DESC, id DESC` плюс `NOT EXISTS` по явной связи перекрытия (вперёд-совместимость). Фильтр по исходу `VALUE_CANDIDATE` обязан применяться ПОСЛЕ выбора самой свежей, иначе устаревший кандидат «воскреснет» поверх более свежего `NO_VALUE`.

Остальное: страница `/scanner` это серверный компонент с `export const dynamic = "force-dynamic"` (иначе есть риск запечь снимок на этапе сборки), прямой `fetch` к API по образцу `scorecards/page.tsx` (прокси `internal-api` для этой страницы не нужен), разбор ответа fail-closed вручную (в репозитории нет `zod`), форматирование времени через `Intl.DateTimeFormat.formatToParts` (штатный `ru-RU` даёт «28 ноября в 18:00», а контракт требует «28 ноября, 18:00»), русский словарь запрещённых слов только на новую поверхность (в остальных файлах те же стемы легитимны: «не гарантии», «Рейтинг Эло», «Уверенность»). Тест `tests/e2e/release-accessibility.spec.ts` жёстко фиксирует список пунктов навигации и сломается при добавлении «Сканер value»: его нужно обновить в той же фазе.

**Primary recommendation:** Реализовать `GET /value/scanner` одним `$queryRaw` (шаблон из раздела Code Examples, окно и ранги рынков параметрами, `AT TIME ZONE 'UTC'` для `timestamptz`, `::int` для счётчиков), чистую функцию `loadScanner({ now }, repository)` с инжектируемыми часами и классификацию свежести в `packages/domain`, страницу как серверный компонент без `Number()` над значениями квитанций; доказать «без N+1» тестом на неизменность числа SQL-запросов и «побайтово» тестом с удержанными строками (`0.0432109876543210987654321`, `1.2e-7`).

## Project Constraints (from AGENTS.md)

- Стек зафиксирован: pnpm + Turborepo, Next.js 16 / React 19.2 / Tailwind, NestJS 11, PostgreSQL 18 / Prisma 7, Redis/BullMQ; новых фреймворков не вводить. [VERIFIED: AGENTS.md; apps/web/package.json (`next 16.3.3`, `react 19.2.8`); apps/api/package.json (`@nestjs/common 11.1.29`); packages/database/package.json (`@prisma/client 7.10.0`, `pg 8.23.0`)]
- Целостность данных: неизменяемые снимки и квитанции, никакой ретроспективной мутации. Сканер только читает; триггер `ValueReceipt_append_only` отвергает UPDATE/DELETE на уровне БД. [VERIFIED: packages/database/prisma/migrations/20260905_phase03_forecast_value_snapshots/migration.sql:175 `CREATE TRIGGER "ValueReceipt_append_only" BEFORE UPDATE OR DELETE ON "ValueReceipt" FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();`]
- Ответственная игра: никаких обещаний, уверенности, скрытого риска, срочности; постоянные дисклеймеры. Реализуется `RiskDisclosure` + верхняя строка (D-12).
- Язык: весь текст интерфейса, комментарии в пользовательских компонентах и ответы агента на русском; идентификаторы, код и коммит-сообщения на английском. (Секция Conventions в AGENTS.md.)
- Workflow: правки репозитория только через GSD-процесс (этот файл создаёт gsd-phase-researcher; исполнение через `/gsd-execute-phase`).
- `apps/web/AGENTS.md`: «This is NOT the Next.js you know» — перед кодом читать `apps/web/node_modules/next/dist/docs/`. Прочитано: `01-app/02-guides/caching-without-cache-components.md` (стр. 88-99, 179-180) о `dynamic = "force-dynamic"` и `fetch(..., { cache: "no-store" })`; `cacheComponents` в `apps/web/next.config.ts` не включён (проверено чтением файла), то есть действует классическая модель.
- Не читать `.env`, не писать в dev-БД: соблюдено (все эксперименты на одноразовом контейнере `postgres:18.6-alpine`, удалён; схема снята `pg_dump -s` с dev-БД только на чтение).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Выбор «самой свежей неперекрытой» квитанции по тройке, окно по `kickoffUtc`, фильтры `ISSUED`/`PRODUCTION`/`SCHEDULED` | Database / Storage (SQL) | API / Backend (параметры окна, лимит) | Единый запрос с соединениями исключает N+1; окно и фильтры должны быть в одном снимке БД |
| Классификация свежести (FRESH/AGING/STALE), возраст в секундах, текущий момент `generatedAt` | API / Backend (чистая функция в `packages/domain`, инжектируемые часы) | — | Одна точка вычисления, детерминированные тесты, нет рассинхрона клиентских часов (U-04 UI-SPEC) |
| Флаг «прогноз обновлён» (`forecastNewerAvailable`) | Database (`EXISTS` в том же запросе) | API (проброс булева) | Нужны данные `ForecastSnapshot` по матчу; считать в цикле на API означало бы N+1 |
| Порядок (время матча, рынок, выбор) и усечение до 200 строк по границе матча | Database (`row_number()` + ранги параметрами) | API (константы порядка в домене) | Усечение зависит от порядка: оба должны быть в SQL; страница порядок не меняет |
| Дословная отдача `edge`, `expectedValue`, вероятностей, коэффициента | API (без `Number()`, строки из `VARCHAR`) | Frontend Server (SSR вставляет как текст) | Никакого форматирования между БД и HTML (D-04) |
| Состояния EMPTY / UNAVAILABLE / POLICY-UNMET | API (`state`, `checkedCount`, `outcomeCounts`, `allPolicyConfigMismatch`) | Frontend Server (разбор fail-closed, выбор состояния) | UNAVAILABLE рождается на странице (ошибка/неузнанная форма), остальные три приходят от API |
| Отображение: группировка, чипы, `details` | Frontend Server (SSR, серверные компоненты без `"use client"`) | — | Бюджет клиентского JS исчерпан; `details/summary` нативные |
| Форматирование времени (Europe/Warsaw), возраст «7 ч назад» | Frontend Server (чистые хелперы `time-format.ts`) | — | Только представление целых чисел и ISO от API |
| Копирайт ответственной игры | Frontend + тест-гейт (`responsible-copy.test.ts`) | — | Тест сканирует исходники новой поверхности |
| Навигация и главная | Browser/Client (`release-navigation.tsx` уже клиентский) + Frontend Server (`page.tsx`) | — | Аддитивная запись в массивы; нового клиентского файла нет |

## Standard Stack

### Core

Новых пакетов нет. Используется то, что уже в репозитории.

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Next.js / React | 16.3.3 / 19.2.8 | Серверный компонент `/scanner` | Уже в `apps/web`; `force-dynamic` документирован [CITED: apps/web/node_modules/next/dist/docs/01-app/02-guides/caching-without-cache-components.md:97] |
| NestJS | 11.1.29 | Контроллер `GET /value/scanner`, `EligibilityGuard` | Образец `evaluation.controller.ts`/`value.controller.ts` |
| Prisma + `@prisma/adapter-pg` | 7.10.0 | `$queryRaw` (тегированный шаблон, параметры) | Единственный DB-доступ в репозитории; события `query` и `$extends` проверены на счёт запросов |
| PostgreSQL | 18.6 | `DISTINCT ON`, CTE, `jsonb`, пропускающий скан индекса | Образ `postgres:18.6-alpine` локально есть; план проверен на нём |
| `decimal.js` | 10.6.0 | Не используется сканером (значения не вычисляются) | Нужен лишь тестам для построения квитанций через `decideValue` |

### Supporting (тестовые, уже установлены)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Vitest | 4.1.11 | unit + integration проекты | Все новые тесты кроме e2e |
| `react-dom/server` `renderToStaticMarkup` | 19.2.8 | Тесты разметки без Testing Library | `tests/unit/scanner-ui.test.tsx` (образец `scorecard-ui.test.tsx`: импорт из `apps/web/node_modules/react...`) |
| Playwright + `@axe-core/playwright` | 1.62.1 / 4.13.0 | Визуальные и a11y тыльные проверки | `tests/e2e/value-scanner.spec.ts` |
| Docker (Testcontainers-образец собственный) | postgres:18-alpine | Интеграция на настоящем PostgreSQL | Образец `extended-markets-api.test.ts`: свой контейнер + `prisma migrate deploy`, dev-БД не трогается |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `$queryRaw` (SQL) | Prisma ORM `findMany` + `include` | ORM не выражает `DISTINCT ON` по неключевой тройке с `NOT EXISTS` и `ORDER BY ... DESC`; пришлось бы тянуть все квитанции окна и выбирать в JS (и тянуть большие `receipt` jsonb). Отклонено |
| Одна SQL-инструкция со сводкой (`summary LEFT JOIN page`) | Две инструкции в `$transaction` RepeatableRead | Две инструкции тоже «константное число», но D-03 говорит «один SQL-запрос»; один запрос заодно даёт согласованный снимок. Выбрана одна инструкция |
| Прокси `apps/web/app/internal-api/scanner/route.ts` | Прямой `fetch` из серверного компонента | У `scorecards/page.tsx` именно прямой `fetch` к `API_ORIGIN`; `internal-api/scorecards` нужен клиентскому коду, у сканера клиентского кода нет. Рекомендуется НЕ создавать прокси (меньше публичной поверхности); см. Open Question 3 |
| Ручной разбор ответа | `zod` | `zod` в `apps/*` и `packages/domain` не установлен [VERIFIED: grep по package.json]; не добавлять ради одного разбора |

**Installation:** none (никаких установок).

**Version verification:** версии взяты из `package.json` файлов репозитория (см. Project Constraints); реестровых вызовов не требуется, так как пакеты не добавляются.

## Package Legitimacy Audit

Фаза не устанавливает внешних пакетов. Таблица пуста; `Packages removed due to [SLOP] verdict: none`; `Packages flagged as suspicious [SUS]: none`.

## Architecture Patterns

### System Architecture Diagram

```
Браузер  --GET /scanner-->  Next.js (серверный компонент, force-dynamic)
                              |
                              | fetch(`${API_ORIGIN}/value/scanner`, no-store, заголовки eligibility, таймаут)
                              v
                          NestJS ScannerController  --EligibilityGuard (регион, 18+, свежесть решения)-->
                              |   400 если есть query-параметры
                              v
                          ScannerService.loadScanner({ now: clock() }, repository)
                              |  from = now, to = now + 7 суток (UTC)
                              v
                 Prisma $queryRaw  ==  ОДИН SQL-запрос (один снимок БД)
                 +--------------------------------------------------------------+
                 | latest   : DISTINCT ON (fixtureId, market, selection)         |
                 |            фильтры: Fixture SCHEDULED + kickoff в [from,to),  |
                 |            ForecastSnapshot ISSUED+PRODUCTION,                |
                 |            NOT EXISTS (кто-то перекрыл эту квитанцию)         |
                 | summary  : checked, outcome_counts, all_policy_mismatch       |
                 | page     : только VALUE_CANDIDATE, усечение по границе матча, |
                 |            row_number() по (kickoff, fixture, ранг рынка,     |
                 |            рынок, ранг выбора, выбор, id)                     |
                 | SELECT   : summary LEFT JOIN page + joins (квитанция, матч,   |
                 |            команды, лига, снимок коэффициентов, снимок        |
                 |            прогноза, выбор коэффициента) + EXISTS(новее)      |
                 +--------------------------------------------------------------+
                              |
                              v  строки -> DTO (строки как есть; возраст и свежесть из generatedAt)
                          JSON { state, generatedAt, items[], checkedCount, ... }
                              |
                              v
        page.tsx: разбор fail-closed -> AVAILABLE | EMPTY(+POLICY-UNMET) | UNAVAILABLE
                              |
                              v
        scanner-view.tsx (чистое представление): <ol> матчей -> <ul> строк, блок <details> «Устаревшие»
                              |
                              v
                         HTML без нового клиентского JS
```

Сценарий чтения по стрелкам: пользователь открывает `/scanner`, сервер Next запрашивает API, API одним запросом читает БД, отдаёт готовые строки, страница выбирает состояние и рисует разметку; ветка ошибки сети/не-2xx/неизвестной формы ведёт в UNAVAILABLE.

### Recommended Project Structure

```
packages/domain/src/value/
├── scanner.ts                 # SCANNER_* константы, classifyOddsFreshness, порядок рынков/выбора, типы DTO (новый; export из index.ts)
apps/api/src/modules/value/
├── scanner.controller.ts      # @Controller("value") @UseGuards(EligibilityGuard) @Get("scanner")
├── scanner.service.ts         # loadScanner(deps, repository), createPrismaScannerRepository(client), ScannerService
├── value.module.ts            # + ScannerController, ScannerService (аддитивно)
apps/web/app/scanner/
├── page.tsx                   # серверный компонент: fetch, разбор, выбор состояния; export const dynamic = "force-dynamic"
├── scanner-view.tsx           # чистое представление (без "use client")
├── scanner-types.ts           # локальные типы + parseScannerResponse (fail-closed, без импорта барелей на рантайме)
├── scanner-labels.ts          # FRESHNESS_LABELS, VALUE_OUTCOME_LABELS, константы текстов
apps/web/components/time-format.ts   # + formatKickoffWarsaw, formatCapturedWarsaw, formatAge (чистые)
apps/web/app/globals.css            # + блок .scanner-* в конце файла
apps/web/components/release-navigation.tsx   # + запись «Сканер value»
apps/web/app/page.tsx               # + запись в CONTENTS
apps/web/app/methodology/page.tsx   # + предложение в #limitations
tests/helpers/scanner-seed.ts       # посев (League/Season/Team/Fixture/Forecast/Odds/Receipt) с контролем kickoff, status, createdAt, supersedes
tests/unit/scanner-domain.test.ts · scanner-service.test.ts · scanner-ui.test.tsx · scanner-guards.test.ts
tests/integration/scanner-api.test.ts
tests/e2e/value-scanner.spec.ts (+ стаб API и playwright.scanner.config.ts для состояний)
```

### Pattern 1: Чистая функция + инжектируемые часы + репозиторий (как `compareValue`)

**What:** `loadScanner({ now }, repository)` принимает момент времени и репозиторий; Nest-сервис лишь передаёт `new Date()` и Prisma-репозиторий. Тесты управляют `now` напрямую.
**When to use:** вся логика, кроме SQL; модуль-образец `value.service.ts` (`compareValue(raw, repository)`, `createPrismaValueRepository(client)`).
**Example:** см. Code Examples, «Сервис».

### Pattern 2: Fail-closed разбор ответа на странице

**What:** `parseScannerResponse(unknown): ScannerView | null`; `null` -> состояние UNAVAILABLE. Проверка точного набора ключей и типов строк (`typeof x === "string"`), никаких приведений `Number()` над значениями квитанции.
**When to use:** единственная точка входа данных API на страницу (UI-SPEC: неузнанная форма не должна давать AVAILABLE/EMPTY).

### Pattern 3: Серверный компонент без клиентского JS

**What:** `scanner-view.tsx` без `"use client"`; `details/summary` нативные; ссылки обычные `<a href>` (прецедент: `apps/web/app/privacy/page.tsx`), а не `next/link`, чтобы Next не запускал префетч сотен ссылок на `/fixtures/{id}` и не тянул клиентскую логику ссылок на 200 строк.

### Anti-Patterns to Avoid

- **Фильтр `outcome = 'VALUE_CANDIDATE'` до выбора самой свежей:** возвращает устаревших кандидатов поверх более свежего `NO_VALUE`.
- **`now()` в SQL для границ окна:** `Fixture.kickoffUtc` это `timestamp without time zone`; сравнение с `now()` зависит от часового пояса сессии (проверено: при `timezone = 'Pacific/Auckland'` выборка 362 вместо 400). Границы окна только параметрами JS `Date`.
- **`SELECT vr.*` или `receipt` целиком:** `receipt` jsonb 3.6-5.4 КБ на строку (измерено `pg_column_size`), 200 строк = ~1 МБ и утечка поля `sources` (хеши источников). Брать только пути `#>>`.
- **Сортировка/ранжирование по edge, EV или вероятности где бы то ни было** (SQL, API, представление, тест-фикстуры без явной пометки).
- **Форматирование значений квитанции** (`percent()`, `formatOdds()`, `Number()`, `toFixed`, `Intl.NumberFormat`).
- **Клиентские компоненты и импорт `@bet-stats/domain` барелем из клиентского кода сканера.**

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| «Последняя запись на группу» | Загрузка всех квитанций и свёртка в JS, или N запросов | `DISTINCT ON (...) ORDER BY ... createdAt DESC, id DESC` | Один проход по индексу, детерминированный тай-брейк по `id` |
| Подсчёты исходов и признак «все POLICY_CONFIG_MISMATCH» | Отдельные запросы или подсчёт на странице | CTE `per_outcome` / `summary` в том же запросе | Согласованный снимок, отсутствие N+1, EMPTY объясним |
| Порядок рынков и выбора | Сортировка на странице; `CASE` с копией списка | Константы в `packages/domain` (`SCANNER_MARKET_ORDER`, `SCANNER_SELECTION_ORDER`) параметрами `array_position(${arr}::text[], ...)` | Один источник правды; проверено: массивы как параметры работают |
| Подписи рынка и выбора | Новые словари | `oddsMarketLabel`, `selectionLabelFor` из `enum-labels.ts` | Уже поддерживают `ASIAN_HANDICAP:<линия>`, `EXACT_SCORE`; неизвестное возвращают сырым кодом без исключения |
| Форматирование времени | Ручная арифметика смещений | `Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Warsaw", hourCycle: "h23" })` + `formatToParts` | Сезонные смещения; проверено на 2026-11-28 и 2026-07-01 |
| Граница слова в русском тексте | `\b` | `(?<![\p{L}])` с флагами `iu` | `\b` не работает на кириллице; регэкс проверен |
| Подсчёт запросов в тесте | Мок репозитория | События `log: [{ emit: "event", level: "query" }]` или `$extends({ query: { $allOperations } })` | Оба проверены на реальном клиенте Prisma 7 + adapter-pg |
| Разбор JSON ответа | `zod` | Небольшая ручная функция с точным набором ключей | `zod` не установлен; в репозитории принят ручной стиль (`parseCohortQuery`, `exactKeys`) |

**Key insight:** вся сложность фазы в точности «что такое кандидат» и в дословности; обе вещи решаются тем, что никакой промежуточный слой не обрабатывает значения: SQL отдаёт строки, API кладёт их в JSON, страница вставляет их текстом.

## Runtime State Inventory

Фаза не переименование и не миграция: раздел опущен по инструкции шаблона. Для полноты: новых таблиц, столбцов и данных нет (D-13), существующие строки не меняются.

## Common Pitfalls

### Pitfall 1: `supersedesValueReceiptId` никогда не записывается
**What goes wrong:** реализация «только `NOT EXISTS (перекрыта)`» вернёт ВСЕ квитанции тройки (каждая пара снимков даёт свою), список задвоится.
**Why it happens:** [VERIFIED: grep `supersedesValueReceipt` по `*.ts/*.sql/*.prisma/*.tsx` вне `node_modules`/worktrees: схема, миграция `20260905_...:94`, сгенерированный клиент, комментарий `workers/data-sync/src/jobs/backup-drill.ts:66`; в `value.service.ts` `insertReceipt` поля нет; в dev-БД `count(supersedesValueReceiptId) = 0` из 46]. Детерминированный id квитанции это sha256 от (прогноз, коэффициенты, рынок, выбор) (`value.service.ts:82-85`), то есть новый прогноз или новые коэффициенты создают НОВУЮ строку, а не перекрывающую.
**How to avoid:** `DISTINCT ON` по тройке с `ORDER BY createdAt DESC, id DESC` как основной механизм + `NOT EXISTS` как вперёд-совместимая защита. Тестировать оба механизма: (а) две квитанции одной тройки без связи, побеждает более поздняя `createdAt`; (б) связь перекрытия с «перекрытой» строкой, у которой `createdAt` ПОЗЖЕ, перекрывающей: перекрытая обязана исчезнуть.
**Warning signs:** одна и та же пара (матч, рынок, выбор) дважды в выдаче.

### Pitfall 2: Фильтр исхода до выбора «самой свежей»
**What goes wrong:** старая `VALUE_CANDIDATE` всплывает, хотя новейшая квитанция по тройке `NO_VALUE`: честно устаревшая оценка выдана за актуальную.
**How to avoid:** `latest` берёт все исходы; `VALUE_CANDIDATE` фильтруется только в `candidates`. Тест: тройка с кандидатом, затем более поздним `NO_VALUE` не должна появиться в списке, но обязана попасть в `checkedCount` (1) и `outcomeCounts.NO_VALUE`.

### Pitfall 3: `now()` и `timestamptz` зависят от часового пояса сессии
**What goes wrong:** (а) `fx."kickoffUtc" >= now()`: колонка `timestamp without time zone` приводится по поясу сессии, окно сдвигается; (б) Prisma 7.10 + adapter-pg неверно читает `timestamptz` при не-UTC сессии: `submittedAt` 2026-11-25T20:30:32.725Z приходит как `2026-11-26T09:30:32.725Z` и в `$queryRaw`, и в ORM (проверено запуском на одноразовой БД с `ALTER DATABASE ... SET timezone='Pacific/Auckland'`).
**How to avoid:** границы окна только параметрами JS `Date` (`${from}`, `${to}`: проверено, не зависит от пояса); для `timestamptz` в списке выбора писать `(o."submittedAt" AT TIME ZONE 'UTC')` (проверено: даёт верное значение в обоих режимах); `kickoffUtc` и так без пояса и читается корректно. Остальной репозиторий неявно предполагает сессию UTC (INFO: дефект общий, вне фазы; dev-БД `TimeZone = UTC`). Интеграционный тест может выставить `ALTER DATABASE ... SET timezone` в своём контейнере и проверить возраст.

### Pitfall 4: `BigInt` из `count(*)`
**What goes wrong:** `count(*)` приходит как `bigint` (BigInt в JS), `JSON.stringify` бросает «Do not know how to serialize a BigInt».
**How to avoid:** `count(*)::int`, `sum(...)::int` (в шаблоне так и сделано; проверено: `typeof checked === "number"`, `JSON.stringify` проходит).

### Pitfall 5: «Байт в байт» ломается незаметным форматированием
**What goes wrong:** `Number("0.0432109876543210987654321")` теряет разряды; `percent()`/`formatOdds()`/`toFixed` меняют вид; `Decimal.toString()` в квитанциях даёт экспоненциальную запись (`1e-7`, `1.2e-7`: проверено запуском `decimal.js 10.6.0`; домен `toExpNeg` не меняет), `Number("1e-7")` вернёт `1e-7` же, но `Number("0.1000")` потеряет хвост.
**How to avoid:** значения идут строкой от столбца до `<dd>`; тип полей DTO `string` (не `number`); в тесте разметки подсчитывать вхождения точного `>значение<` (подстрока `0.05` встречается внутри `0.0500...`, поэтому считать по границам элементов). Значение должно быть единственным дочерним текстом `<dd>` (SSR-поток React вставляет `<!-- -->` между соседними текстовыми узлами; `renderToStaticMarkup` не вставляет, поэтому в e2e сравнивать `textContent`, а не сырой HTML). Одно значение не должно рисоваться в строке дважды (например, модель-вероятность в «фактах» и в «подробностях»).
**Sources of truth:** сканер читает столбцы `VARCHAR(128)` `edge`, `expectedValue`, `modelProbability`, `noVigProbability`, `fairOdds` и `ManualOddsSelection.decimalOdds`; ссылка «Квитанция (JSON)» отдаёт `jsonb`-копию. Интеграционный тест паритета «столбец == jsonb» для посеянных строк дёшев и закрывает расхождение.

### Pitfall 6: Размер и состав `receipt` jsonb
**What goes wrong:** 3.6-5.4 КБ на строку (`pg_column_size`: ONE_X_TWO 1256-4904, ASIAN_HANDICAP:0 5413), массив `sources` с хешами и временами наблюдений; полная выборка утекает наружу и раздувает ответ.
**How to avoid:** выбирать только `receipt #>> '{receipt,valuePolicyVersion}'`, `'{receipt,extended,edgeDefinition}'`, `'{receipt,extended,evPolicyVersion}'`. Структура jsonb [VERIFIED на dev-БД]: верхний уровень это DTO квитанции (`id, edge, market, outcome, reasons, receipt, ...`); `reasons` есть и наверху, и внутри; расчётный блок вложен в `receipt` (`decimalOdds`, `valuePolicyVersion`, `extended`, `gates`, `sources`, ...). 4 легаси-строки (рынок `MATCH_RESULT`, id вида `home-15108`) вложенного блока и `reasons` не имеют.

### Pitfall 7: Где живут причины и исходы
**What goes wrong:** поиск `POLICY_CONFIG_MISMATCH` в столбце или в неверном пути jsonb.
**Facts:** `outcome` это столбец `ValueReceipt.outcome TEXT`; значения `VALUE_CANDIDATE | NO_VALUE | INSUFFICIENT_EVIDENCE` (`ValueDecisionOutcome`). `POLICY_CONFIG_MISMATCH` лежит ТОЛЬКО в jsonb: `receipt -> 'reasons'` (массив строк). При несоответствии политики гейт `POLICY` проваливается среди первых пяти, поэтому исход всегда `INSUFFICIENT_EVIDENCE` (в dev-БД: 2 квитанции `INSUFFICIENT_EVIDENCE` с причиной, 6 без). Признак: `COALESCE(receipt -> 'reasons', '[]'::jsonb) @> '["POLICY_CONFIG_MISMATCH"]'::jsonb` (оператор `@>`, а не `?`, чтобы не конфликтовать с плейсхолдерами); у легаси-строк `reasons` нет, они считаются «без причины».

### Pitfall 8: Рынки вне реестра и неизвестные исходы
**What goes wrong:** в dev-БД есть рынок `MATCH_RESULT` (легаси) и `ASIAN_HANDICAP:0`; индекс рынков в `array_position` для неизвестного даёт NULL, а NULL сортируется в конец (по умолчанию для ASC) — это нужное поведение, но ярлык не должен падать.
**How to avoid:** неизвестный рынок/выбор показывать сырым кодом (контракт `oddsMarketLabel`/`selectionLabelFor`), не скрывать. Неизвестные коды исхода в EMPTY выводить сырым кодом (UI-SPEC), порядок плиток: `INSUFFICIENT_EVIDENCE`, `NO_VALUE`, затем неизвестные по алфавиту.

### Pitfall 9: Усечение посреди матча
**What goes wrong:** `LIMIT 200` режет последнюю группу, а утверждённый текст говорит «Более поздние матчи в список не вошли»: утверждение неточно, когда у последнего показанного матча тоже отрезаны строки.
**How to avoid:** усечение по границе матча (CTE `kept`: накопленная сумма строк по матчам в порядке времени, оставляем матчи с `running <= 200`; первый матч оставляем всегда). Проверено запуском (лимит 100 -> 98 строк, 42 матча целиком). У одного матча не более ~66 кандидатов (3+2+2+21×2+17), то есть первый матч всегда влезает. `truncated = totalCandidates > items.length`, где `totalCandidates = outcomeCounts.VALUE_CANDIDATE ?? 0`.

### Pitfall 10: Статическая пререндер-страница с замороженными данными
**What goes wrong:** у `/scanner` нет `searchParams` и других запросных API; без явной динамики Next может попытаться отрисовать страницу при `next build`, и снимок «на 25.11.2026, 14:05» навсегда запечётся в HTML.
**How to avoid:** `export const dynamic = "force-dynamic";` в `page.tsx` (+ `cache: "no-store"` в `fetch`) и статический охранный тест на наличие обеих строк. [CITED: next docs caching-without-cache-components.md:97-99 — `force-dynamic` эквивалентно `cache: 'no-store'` для всех fetch маршрута]

### Pitfall 11: Навигация зафиксирована в e2e
**What goes wrong:** `tests/e2e/release-accessibility.spec.ts:7` содержит `const destinationNames = ["Матчи", "Анализ", "Результаты", "Методология", "FAQ", "Операции"] as const;`, и строки 14 и 23 сверяют `toHaveText(destinationNames)`; добавление «Сканер value» ломает `verify:release` (этот файл входит в скрипт `verify:release`).
**How to avoid:** в той же фазе обновить массив: `["Матчи", "Анализ", "Сканер value", "Результаты", "Методология", "FAQ", "Операции"]` и добавить проверку `aria-current` на `/scanner`. Резерв из UI-SPEC U-09 (сократить подпись до «Сканер») применять только после замера на 768-1023 px.

### Pitfall 12: Русский словарь запрещённых слов и существующий текст
**What goes wrong:** (а) глобальный русский скан по `apps/web/app` и `apps/web/components` даёт десятки ложных срабатываний: «гарант» в `risk-disclosure.tsx`, `faq`, `methodology`, `calibration-copy.ts`; «уверенн» в `enum-labels.ts`/`methodology` («Уверенность модели» — легальная метрика); «рейтинг» в `enum-labels.ts` («рейтинг Эло») и `teams/.../evidence/page.tsx`; «топ» в `app/page.tsx` и `faq/page.tsx` («топ-лиг»); «прибыл» в `scorecard-dashboard.tsx`, `methodology`, `forecast-workbench.tsx`; «ставьте» в `methodology/page.tsx` (измерено ripgrep по `apps/web/app` и `apps/web/components`, без тестов и CSS: десятки совпадений в 14+ файлах). (б) Метки новой поверхности нельзя класть в `enum-labels.ts` — он уже содержит «рейтинг» и «уверенн». (в) Существующий английский скан работает по ВСЕМУ исходнику без исключения комментариев: слова `sure`, `lock`, `guaranteed`, `risk-free`, `act now`, `stake size`, `stake 1` в комментариях и строках новых файлов сканера дадут красный тест `keeps fixture discovery neutral...`.
**How to avoid:** русский словарь применять только к файлам новой поверхности (`apps/web/app/scanner/**`, новые записи навигации/главной, новое предложение методологии) как отдельный тест; метки сканера держать в `apps/web/app/scanner/scanner-labels.ts`; английские комментарии в новых файлах писать без перечисленных слов. Единственные разрешённые вхождения в новом русском корпусе: верхняя строка (содержит «прибыли») и текст `PERSISTENT_RISK_DISCLOSURE` (содержит «гарантии»); оба убирать из сканируемого текста точным `replaceAll`, как уже сделано с `DISCLOSURE`. Проверено: на 158 русских строках раздела копирайта UI-SPEC находятся только эти два предложения и цитата «Сделать ставку» из запрета (проза, не интерфейс).
**Regex facts [VERIFIED запуском Node 24.22]:** `new RegExp("(?<![\\p{L}])лучш", "iu")` не срабатывает на «улучшение», срабатывает на «Лучшие»; без флага `i` заглавная «Лучшие» НЕ ловится, поэтому `iu` обязательны. «Топ value», «Горячие кандидаты», «Гарантированный value», «Ставьте сейчас», «Успей поставить», «Рейтинг Эло» ловятся; «кандидат», «оценка модели», «преимущество», «ожидаемое value», «источник коэффициентов» чисты.

### Pitfall 13: Время в «ru-RU» и «в»
**What goes wrong:** `Intl.DateTimeFormat("ru-RU", { weekday:"short", day:"numeric", month:"long", hour:"2-digit", minute:"2-digit" })` даёт «сб, 28 ноября в 18:00» (с «в»); контракт UI-SPEC требует «сб, 28 ноября, 18:00». Без `hourCycle:"h23"` полночь может отрисоваться как «24:00».
**How to avoid:** собирать строку из `formatToParts`: `` `${weekday}, ${day} ${month}, ${hour}:${minute}` ``; для момента фиксации `{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}` даёт «25.11.2026, 14:05» (проверено). Сутки определяются в Warsaw: `2026-11-28T23:30:00Z` даёт «вс, 29 ноября, 00:30». Невалидная зона или не ISO вход: вернуть исходную строку (контракт `formatInstant`).

### Pitfall 14: `enum-labels.ts` тянет барель домена
**What goes wrong:** `apps/web/components/enum-labels.ts` строка 1 импортирует значения из `@bet-stats/domain` (`AH_LINES_V1, parseAhLineToken, parseExactScoreSelection, parseMarketId`). Статический охранный тест «нет импорта бареля в представлении» может ошибочно сработать или, наоборот, создать ложное чувство защиты.
**How to avoid:** страница и представление серверные, транзитивный импорт через `enum-labels.ts` на сервере безвреден (клиентский пакет определяется клиентскими компонентами). Охранный тест проверяет (а) отсутствие `"use client"` в `apps/web/app/scanner/**`; (б) отсутствие ПРЯМОГО `from "@bet-stats/domain"` (кроме `import type`) в файлах сканера; (в) что ни один клиентский файл (`"use client"`) не импортирует модули сканера. Бюджет `scriptTransferBytes` проверять `node scripts/perf-audit.mjs` как справку: цель «не хуже 5 960 160».

### Pitfall 15: Блок CSS и существующий тест токенов
**What goes wrong:** `design-tokens.test.ts` вырезает «блок расширенных рынков» от `css.indexOf(".market-head")` до КОНЦА файла и проверяет в нём: нет hex-цветов, нет новых custom properties, нет `transition|animation|@keyframes`. Добавленный в конец `.scanner-*` блок попадёт под эти проверки (контракт UI-SPEC им совместим). `@media (forced-colors: active)` находится на строке 1623, до `.market-*` блока: правила сканера можно добавить отдельным `@media (forced-colors: active)` в конце файла, не правя средний блок.
**How to avoid:** добавить второй тест `describe("design tokens: scanner block")` от `css.indexOf(".scanner-groups")` (hex, `transition|animation`, размеры шрифта только 14/16/20/24px).

### Pitfall 16: e2e пишет в БД, на которую указывает `DATABASE_URL`
**What goes wrong:** существующие спеки (`extended-markets.spec.ts`) сеют строки с run-уникальными id и без очистки (квитанции и снимки неизменяемы); именно отсюда «Live Workbench League» в dev-БД. Сканерный e2e в окне 7 суток попадёт в одну выдачу со строками других спеков, а состояния EMPTY и UNAVAILABLE через живой API неотличимо не воспроизвести: серверный `fetch` страницы нельзя перехватить `page.route`.
**How to avoid:** (а) живой тест AVAILABLE сеет свои run-уникальные записи и ищет их по `#receipt-{id}`, не опираясь на глобальные счётчики; (б) состояния и визуальную матрицу (EMPTY, EMPTY+плашка, UNAVAILABLE, all-stale, строки 40 разрядов и 80-символьный источник) гонять против детерминированного стаба API: отдельный `playwright.scanner.config.ts` с двумя `webServer` (стаб на свободном порту и `next dev` с `API_ORIGIN` на стаб, свой `NEXT_DIST_DIR`), сценарий переключается `POST /__scenario` (воркер один, гонок нет). dev-БД стаб-сценарии не трогают.

### Pitfall 17: Ссылки и префетч
**What goes wrong:** `next/link` для 200 строк × 2 ссылок запускает префетчи при видимости ссылок.
**How to avoid:** обычные `<a href>` (см. Pattern 3); ссылка «Квитанция (JSON)` с `target="_blank" rel="noopener noreferrer"`.

### Pitfall 18: Свежесть от `submittedAt` и honest-age
**What goes wrong:** `submittedAt` это серверное время вставки; пользовательское `capturedAt` может быть на 30 суток раньше (`ODDS_CAPTURE_WINDOW_DAYS = 30`, домен `contract.ts:22,65-70`: окно `[kickoff − 30 суток, kickoff)` и не позже `serverNow + 5 минут`). Цена, наблюдавшаяся 3 суток назад и введённая сейчас, будет «свежей» по D-06.
**How to avoid:** D-06 зафиксировано, следовать ему; дополнительно отдавать `oddsCapturedAt` (из `ManualOddsSnapshot.receipt ->> 'capturedAt'`) в DTO как справочное поле для будущих решений, не используя в расчёте. См. Open Question 1.

## Code Examples

### SQL запроса сканера (проверен на PostgreSQL 18.6, 112 000 квитанций)

```ts
// packages/database не меняется; репозиторий живёт в apps/api/src/modules/value/scanner.service.ts
// Источник проверки: одноразовый postgres:18.6-alpine со схемой dev-БД (pg_dump -s), 12 000 матчей, 112 000 квитанций.
// Окно: параметры JS Date (не now()); порядок рынков и выбора: массивы из packages/domain (параметры).
const rows = await client.$queryRaw<ScannerRow[]>`
WITH latest AS (
  SELECT DISTINCT ON (vr."fixtureId", vr.market, vr.selection)
         vr.id, vr."fixtureId", vr.market, vr.selection, vr.outcome,
         (COALESCE(vr.receipt -> 'reasons', '[]'::jsonb) @> '["POLICY_CONFIG_MISMATCH"]'::jsonb) AS policy_mismatch
  FROM "ValueReceipt" vr
  JOIN "Fixture" fx ON fx.id = vr."fixtureId"
  JOIN "ForecastSnapshot" fs ON fs.id = vr."forecastSnapshotId"
  WHERE fx.status = 'SCHEDULED'
    AND fx."kickoffUtc" >= ${from} AND fx."kickoffUtc" < ${to}
    AND fs.state = 'ISSUED' AND fs.origin = 'PRODUCTION'
    AND NOT EXISTS (SELECT 1 FROM "ValueReceipt" sup WHERE sup."supersedesValueReceiptId" = vr.id)
  ORDER BY vr."fixtureId", vr.market, vr.selection, vr."createdAt" DESC, vr.id DESC
),
per_outcome AS (
  SELECT outcome, count(*)::int AS n, count(*) FILTER (WHERE policy_mismatch)::int AS mismatched
  FROM latest GROUP BY outcome
),
summary AS (
  SELECT COALESCE(sum(n), 0)::int AS checked,
         COALESCE(jsonb_object_agg(outcome, n), '{}'::jsonb) AS outcome_counts,
         (COALESCE(sum(n), 0) > 0 AND sum(mismatched) = sum(n)) AS all_policy_mismatch
  FROM per_outcome
),
candidates AS (
  SELECT l.id, l."fixtureId", l.market, l.selection, fx."kickoffUtc" AS kickoff
  FROM latest l JOIN "Fixture" fx ON fx.id = l."fixtureId"
  WHERE l.outcome = 'VALUE_CANDIDATE'                      -- ТОЛЬКО ЗДЕСЬ, после выбора самой свежей
),
kept AS (                                                  -- усечение по границе матча
  SELECT "fixtureId" FROM (
    SELECT "fixtureId", count(*) AS n, sum(count(*)) OVER (ORDER BY min(kickoff), "fixtureId") AS running
    FROM candidates GROUP BY "fixtureId"
  ) g
  WHERE running <= ${limit} OR running = n
),
page AS (
  SELECT c.id,
         row_number() OVER (
           ORDER BY c.kickoff, c."fixtureId",
                    array_position(${marketOrder}::text[], split_part(c.market, ':', 1)),
                    c.market,
                    array_position(${selectionOrder}::text[], c.selection),
                    c.selection, c.id
         ) AS ord
  FROM candidates c JOIN kept k ON k."fixtureId" = c."fixtureId"
)
SELECT s.checked, s.outcome_counts AS "outcomeCounts", s.all_policy_mismatch AS "allPolicyMismatch", p.ord,
       vr.id AS "receiptId", vr."fixtureId", vr."forecastSnapshotId", vr."oddsSnapshotId", vr.market, vr.selection,
       vr.edge, vr."expectedValue", vr."modelProbability", vr."noVigProbability", vr."fairOdds",
       sel."decimalOdds",
       vr.receipt #>> '{receipt,valuePolicyVersion}' AS "valuePolicyVersion",
       vr.receipt #>> '{receipt,extended,edgeDefinition}' AS "edgeDefinition",
       vr.receipt #>> '{receipt,extended,evPolicyVersion}' AS "evPolicyVersion",
       fx."kickoffUtc" AS "kickoffAt", ht.name AS "homeTeam", at.name AS "awayTeam", lg.name AS competition,
       o.source AS "oddsSource", (o."submittedAt" AT TIME ZONE 'UTC') AS "oddsSubmittedAt",
       EXISTS (SELECT 1 FROM "ForecastSnapshot" newer
               WHERE newer."fixtureId" = vr."fixtureId" AND newer.state = 'ISSUED' AND newer.origin = 'PRODUCTION'
                 AND newer."issuedAt" > fs."issuedAt") AS "forecastNewerAvailable"
FROM summary s
LEFT JOIN page p ON true                                   -- пустая страница даёт ровно одну строку сводки (id IS NULL)
LEFT JOIN "ValueReceipt" vr ON vr.id = p.id
LEFT JOIN "ForecastSnapshot" fs ON fs.id = vr."forecastSnapshotId"
LEFT JOIN "Fixture" fx ON fx.id = vr."fixtureId"
LEFT JOIN "Team" ht ON ht.id = fx."homeTeamId"
LEFT JOIN "Team" at ON at.id = fx."awayTeamId"
LEFT JOIN "League" lg ON lg.id = fx."leagueId"
LEFT JOIN "ManualOddsSnapshot" o ON o.id = vr."oddsSnapshotId"
LEFT JOIN "ManualOddsSelection" sel ON sel."oddsSnapshotId" = vr."oddsSnapshotId" AND sel.selection = vr.selection
ORDER BY p.ord`;
// Результат: если rows[0].receiptId === null, то кандидатов нет, а сводка в rows[0].* заполнена (EMPTY);
// иначе каждая строка несёт сводку (3 числа/объекта, дублирование безвредно).
```

Фактические измерения на синтетике (12 000 матчей, 112 000 квитанций, 3 738 квитанций / 1 869 троек / 373 кандидата в окне): выполнение 50-75 мс, `Index Scan` по `ValueReceipt_fixtureId_market_createdAt_idx` (400 циклов), `ValueReceipt_supersedesValueReceiptId_key` index-only anti-join (0 heap fetches), все остальные соединения по первичным ключам; `Fixture_leagueId_kickoffUtc_idx` обслуживает диапазон по `kickoffUtc` через пропускающий скан PostgreSQL 18 (`Index Searches: 3`). Пустое окно: одна строка сводки `checked=0, outcomeCounts={}, allPolicyMismatch=false, receiptId=NULL`. Вывод по D-13: индекс не нужен. Единственная оговорка: для PostgreSQL < 18 индекс с ведущим `leagueId` не обслужит диапазон по времени без равенства по лиге, но проект закреплён на PG 18.x (AGENTS.md), а при 12 000 матчей даже последовательный скан `Fixture` это миллисекунды. Условие пересмотра: измеренное время > 200 мс на реальном объёме, тогда отдельная прямая миграция `Fixture(kickoffUtc)`.

### Контракт DTO ответа `GET /value/scanner`

```ts
// Типы живут в packages/domain/src/value/scanner.ts; страница импортирует их ТОЛЬКО через `import type`.
export const SCANNER_FRESHNESS_V1 = Object.freeze({ version: "scanner-freshness-v1", freshMaxHours: 6, agingMaxHours: 24 } as const);
export const SCANNER_WINDOW_DAYS = 7;
export const SCANNER_LIMIT = 200;
export const SCANNER_MARKET_ORDER = Object.freeze(["ONE_X_TWO", "OVER_UNDER_2_5", "BTTS", "ASIAN_HANDICAP", "EXACT_SCORE"] as const); // порядок D-09, НЕ порядок ALL_MARKET_IDS
export const SCANNER_SELECTION_ORDER = Object.freeze(["HOME", "DRAW", "AWAY", "OVER_2_5", "UNDER_2_5", "YES", "NO"] as const);

export type OddsFreshness = "FRESH" | "AGING" | "STALE";

export interface ScannerItem {
  readonly receiptId: string; readonly fixtureId: string; readonly forecastSnapshotId: string; readonly oddsSnapshotId: string;
  readonly market: string; readonly selection: string;
  readonly kickoffAt: string;                 // ISO UTC
  readonly homeTeam: string; readonly awayTeam: string; readonly competition: string; // League.name
  readonly oddsSource: string | null; readonly oddsSubmittedAt: string; // ISO UTC
  readonly oddsAgeSeconds: number; readonly freshness: OddsFreshness; readonly forecastNewerAvailable: boolean;
  // Строки как в БД, без преобразований; null допустим для nullable-столбцов и отсутствующего выбора коэффициента:
  readonly edge: string | null; readonly expectedValue: string | null; readonly modelProbability: string | null;
  readonly noVigProbability: string | null; readonly fairOdds: string | null; readonly decimalOdds: string | null;
  readonly valuePolicyVersion: string | null;
  readonly edgeDefinition: string | null;     // только АГ: extended.edgeDefinition
  readonly evPolicyVersion: string | null;    // только АГ (extended.evPolicyVersion); у EXACT_SCORE блока такого поля нет
}

export interface ScannerResponse {
  readonly state: "AVAILABLE" | "EMPTY";      // UNAVAILABLE рождается на странице
  readonly generatedAt: string;               // ISO, единый момент для всех возрастов
  readonly window: { readonly from: string; readonly to: string };
  readonly limit: number; readonly truncated: boolean;
  readonly freshnessPolicy: typeof SCANNER_FRESHNESS_V1;
  readonly checkedCount: number;
  readonly outcomeCounts: Readonly<Record<string, number>>;   // включает VALUE_CANDIDATE
  readonly totalCandidates: number;           // outcomeCounts.VALUE_CANDIDATE ?? 0, до усечения
  readonly allPolicyConfigMismatch: boolean;
  readonly items: readonly ScannerItem[];     // уже в порядке D-09; страница не сортирует
}
```

Ключи DTO содержат `receiptId` и `fixtureId` (требование глубоких ссылок фазы 16, D-интеграция).

### Свежесть (чистая функция, границы проверяются тестом)

```ts
export function classifyOddsFreshness(ageSeconds: number): OddsFreshness {
  const age = Math.max(0, Math.floor(ageSeconds));                     // отрицательный возраст (часы вперёд) считается 0
  if (age < SCANNER_FRESHNESS_V1.freshMaxHours * 3600) return "FRESH"; // < 6 ч
  if (age <= SCANNER_FRESHNESS_V1.agingMaxHours * 3600) return "AGING"; // 6 ч .. 24 ч включительно
  return "STALE";                                                       // > 24 ч
}
// Граничные тесты: 21599 -> FRESH, 21600 -> AGING, 86400 -> AGING, 86401 -> STALE, -5 -> FRESH.
```

### Сервис (инжектируемые часы и репозиторий, как `compareValue`)

```ts
export interface ScannerRepository { loadWindow(input: { from: Date; to: Date; limit: number }): Promise<ScannerRows>; }

export async function loadScanner(deps: { now: Date }, repository: ScannerRepository): Promise<ScannerResponse> {
  const from = deps.now;
  const to = new Date(from.getTime() + SCANNER_WINDOW_DAYS * 86_400_000);
  const rows = await repository.loadWindow({ from, to, limit: SCANNER_LIMIT });
  // ...строки в DTO: значения строк копируются как есть; возраст = floor((now - oddsSubmittedAt) / 1000); freshness = classifyOddsFreshness(age)
}

@Controller("value")
@UseGuards(EligibilityGuard)
export class ScannerController {
  @Get("scanner")
  @Header("Cache-Control", "private, no-store, max-age=0")
  get(@Query() query: Record<string, unknown>): Promise<ScannerResponse> {
    if (Object.keys(query).length > 0) throw new BadRequestException("INVALID_SCANNER_QUERY");   // эндпоинт без параметров
    return this.scanner.get();                                                                   // new Date() внутри сервиса
  }
}
```

Конфликта маршрутов нет: существующий контроллер имеет префикс `value-receipts` (`value.controller.ts:8`). `ValueModule` получает контроллер и сервис аддитивно. Недоступность БД: тот же приём, что у `ValueService.db()` (`ServiceUnavailableException({ code: "DATABASE_UNAVAILABLE" })`).

### Доказательство «без N+1» (интеграционный тест на реальном PostgreSQL)

```ts
// Свой контейнер как в extended-markets-api.test.ts; клиент считает запросы событием query (проверено на Prisma 7.10 + adapter-pg).
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../packages/database/src/generated/prisma/client.js";
const statements: string[] = [];
const client = new PrismaClient({ adapter: new PrismaPg({ connectionString }), log: [{ emit: "event", level: "query" }] });
client.$on("query", (event) => statements.push(event.query));

async function countFor(candidates: number): Promise<number> {
  await seedCandidates(client, candidates);              // N матчей/рынков/выборов
  statements.length = 0;
  await loadScanner({ now: FIXED_NOW }, createPrismaScannerRepository(client));
  return statements.length;
}
// Инвариантность: countFor(1) === countFor(60) и оба === 1. Проверенная альтернатива без новых клиентов:
// base.$extends({ query: { $allOperations({ operation, args, query }) { ops.push(operation); return query(args); } } }) считает операции.
```

### Разбор ответа fail-closed

```ts
// apps/web/app/scanner/scanner-types.ts (чистая, без рантайм-импортов домена)
export function parseScannerResponse(input: unknown): ScannerView | null {
  if (!isRecord(input) || !hasExactKeys(input, SCANNER_KEYS)) return null;
  if (input.state !== "AVAILABLE" && input.state !== "EMPTY") return null;
  if (!Array.isArray(input.items) || !input.items.every(isScannerItem)) return null;   // typeof string для значений квитанций, без Number()
  if (input.state === "AVAILABLE" && input.items.length === 0) return null;            // противоречивая форма -> UNAVAILABLE
  if (input.state === "EMPTY" && input.items.length !== 0) return null;
  return input as unknown as ScannerView;
}
```

### Время (формат контракта)

```ts
const WARSAW = "Europe/Warsaw";
export function formatKickoffWarsaw(iso: string, timeZone = WARSAW): string {
  const date = new Date(iso);
  if (!ISO_LIKE.test(iso.trim()) || Number.isNaN(date.getTime())) return iso;
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("ru-RU", { weekday: "short", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).formatToParts(date).map((p) => [p.type, p.value]));
    return `${parts.weekday}, ${parts.day} ${parts.month}, ${parts.hour}:${parts.minute}`;   // «сб, 28 ноября, 18:00» (проверено)
  } catch { return iso; }
}
// formatCapturedWarsaw: {day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit",hourCycle:"h23"} -> «25.11.2026, 14:05» (проверено)
// formatAge(seconds): <3600 -> «N мин назад»; <172800 -> «N ч назад» (floor); иначе «N сут назад» (floor); неконечное/отрицательное -> «только что»
```

### Русский словарь запрещённых слов (расширение `responsible-copy.test.ts`)

```ts
// ВАЖНО: флаги "iu" обязательны; границы слова юникодные. Файл создавать инструментом Write: в heredoc обратный слэш `\p` теряется.
const RU = (body: string) => new RegExp(`(?<![\\p{L}])(?:${body})`, "iu");
export const PROHIBITED_RU = {
  ranking: [RU("лучш|топ|горяч|рейтинг|самы[ейх]\\s+выгодн|рекомендуем(?![\\p{L}])|выбор\\s+дня|фаворит")],
  certainty: [RU("гарант|уверенн|верняк|точно\\s+выиграет|безрисков|беспроигрыш|надёжн(?:ая|ый|ые)\\s+ставк")],
  urgency: [RU("срочно|успей|только\\s+сегодня|последний\\s+шанс|не\\s+упусти|пока\\s+не\\s+поздно")],
  advice: [RU("ставьте|ставь(?![\\p{L}])|сделайте\\s+ставку|сделать\\s+ставку|советуем|рекомендуем\\s+поставить")],
  profit: [RU("прибыл")],
} as const;
const APPROVED_RU = ["Кандидаты value — это оценка модели, а не рекомендация и не обещание прибыли.", "Вероятности — это оценки, а не гарантии. Вы можете потерять деньги при ставках."];
// scanRu(source) = стереть APPROVED_RU точным replaceAll, затем вернуть категории сработавших регэкспов.
// Сканируемые файлы: apps/web/app/scanner/** (.ts/.tsx без .test), новые записи навигации/главной/методологии, не весь apps/web.
```

Негативные фикстуры (должны ловиться): «Лучшие ставки дня», «Топ value», «Горячие кандидаты», «Гарантированный value», «Ставьте сейчас», «Успей поставить». Позитивные (не ловятся): «кандидат», «оценка модели», «преимущество», «ожидаемое value», «источник коэффициентов» + весь текст раздела Copywriting Contract UI-SPEC (измерено: только два утверждённых предложения).

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Индекс с ведущим `leagueId` бесполезен для диапазона по времени | Пропускающий скан индекса (skip scan) в PostgreSQL 18 | PG 18 | `Fixture_leagueId_kickoffUtc_idx` обслуживает окно сканера (`Index Searches: 3`), новый индекс не нужен |
| `fetch` по умолчанию кэшируется в Next 14 | Без `cacheComponents` в Next 16 сохраняется классическое поведение: `no-store` или `force-dynamic` включает динамику | Next 15/16 | Явно писать `force-dynamic` + `no-store` |

**Deprecated/outdated:** `next lint` удалён в Next 16 (проект запускает ESLint напрямую); не относится к фазе, но не добавлять `next lint` в команды проверки.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Пороги свежести 6 ч / 24 ч подходят (D-06 поручает подтвердить планировщику; границы: FRESH `<6 ч`, AGING `≤24 ч`, STALE `>24 ч`) | Code Examples (Свежесть) | Дискреционно: иные пороги меняют только константы и копирайт, структура не меняется |
| A2 | «Более новый прогноз» = существует другой снимок `ISSUED`/`PRODUCTION` того же матча с `issuedAt` позже `issuedAt` прогноза квитанции (любой вид: INITIAL → PRE_MATCH → LINEUP_CONFIRMED, плюс ревизии). В dev-БД у 270 матчей по два выпущенных прогноза (`INITIAL` и `PRE_MATCH`), то есть флаг у таких строк будет часто «вкл» | Code Examples (SQL) | Если владелец понимает «новее» только как ревизия того же вида, флаг нужно сузить до `kind` и `revision`; это правка одного условия |
| A3 | В промышленной БД сессионный пояс UTC (весь репозиторий неявно на это опирается); защита `AT TIME ZONE 'UTC'` и параметры окна работают при любом поясе, но остальные модули при не-UTC уже читают `timestamptz` неверно | Pitfall 3 | Только для чтения: общий дефект вне фазы, сканер защищён |
| A4 | Реальный объём окна на порядки меньше синтетики (топ-5 лиг + UEFA ≈ десятки-сотни матчей за 7 суток × ≤ 7 core-выборов + AH + точный счёт) | Code Examples (измерения) | При объёме в десятки раз выше пересмотреть индекс `Fixture(kickoffUtc)` (условие в разделе измерений) |
| A5 | Хэш-навигация внутрь закрытого `details` блока «Устаревшие» работает не во всех браузерах (UI-SPEC помечает как нерешённое); планировщик принимает это допущением для фазы 16 | Пробел UI-SPEC | Глубокая ссылка на устаревшую строку может не раскрыть блок; решение за фазой 16 (например `?open=stale`) |
| A6 | Playwright-браузеры установлены локально (в сессии не запускались) | Environment Availability | Визуальная матрица не запустится до `playwright install chromium` |
| A7 | В не-легаси квитанциях ключ `reasons` на верхнем уровне `receipt` присутствует всегда (в dev-БД 42 из 46, остальные 4 это легаси `MATCH_RESULT`) | Pitfall 7 | Легаси-строки считаются «без причины» (корректно для их нулевой доли в окне) |

## Open Questions

1. **Свежесть от `submittedAt` или от пользовательского `capturedAt`?**
   - What we know: D-06 закрепляет `submittedAt`. `capturedAt` вводит пользователь (до 30 суток до начала матча, `contract.ts:22,65-70`); цена трёхдневной давности, введённая только что, окажется «свежей».
   - What's unclear: считает ли владелец «временем фиксации» момент ввода (как в D-06) или момент наблюдения цены.
   - Recommendation: исполнять D-06 как есть; в DTO добавить справочное `oddsCapturedAt` (из `ManualOddsSnapshot.receipt ->> 'capturedAt'`) без влияния на расчёт, чтобы пересмотр был дешёвым. Для разбора на discuss-фазе фиксировать как A-риск.

2. **Показывать ли «коэффициенты заменены новой версией» (`ManualOddsSnapshot.replacesOddsId`)?**
   - What we know: в dev-БД 7 из 94 снимков коэффициентов заменены; квитанция по старому снимку будет стоять в списке с возрастом, но без пометки, что книга уже заменена. UI-SPEC такой пометки не содержит.
   - Recommendation: вне фазы 15 (нет в UI-SPEC и в D-01..D-13); занести в отложенные идеи (аддитивное булево поле + чип); `Pitfall 18` покрывает честность возраста.

3. **Нужен ли прокси `internal-api/scanner`?**
   - What we know: `scorecards/page.tsx` ходит прямо на `API_ORIGIN`; `internal-api/scorecards/route.ts` обслуживает клиентский код. У сканера клиентского кода нет; D-11 говорит «через internal-api по образцу scorecards», UI-SPEC уточняет «internal-api/API pattern».
   - Recommendation: не создавать прокси (прямой `fetch` из серверного компонента с теми же заголовками eligibility, `cache: "no-store"`, таймаутом `AbortSignal.timeout(10_000)` и `redirect: "manual"`; ветка `permanentRedirect` на 308 не нужна: API сканера не редиректит, любой не-2xx = UNAVAILABLE). Если владелец настаивает, прокси копирует `internal-api/scorecards/route.ts` и тестируется в стиле `internal-api-route.test.ts`.

4. **Усечение по границе матча против литерального `LIMIT 200`.**
   - Recommendation: граница матча (CTE `kept`), потому что утверждённый текст («Более поздние матчи в список не вошли») иначе местами неточен. Если планировщик выберет простой `LIMIT 200`, формулировку нужно сменить на «Часть кандидатов не вошла в список».

5. **Одна SQL-инструкция против двух.** Recommendation: одна (`summary LEFT JOIN page`), см. Code Examples; пустая выдача возвращает ровно одну строку сводки.

6. **Легаси-строки и рынки вне реестра в окне (`MATCH_RESULT`).** Recommendation: не скрывать и не считать ошибкой: показывать сырым кодом рынка (метки уже так работают), в конец порядка (`array_position` даёт NULL), с `decimalOdds` из выбора коэффициента либо «Не записано».

7. **Расхождения UI-SPEC с кодом, которые планировщик должен привести в порядок:**
   - «Правила квитанции (`policyVersion`)»: в данных поле называется `receipt.valuePolicyVersion` (`value-policy-v1`); `push-aware-ev-v1` это `extended.evPolicyVersion` и бывает только у АГ, у `EXACT_SCORE` блока такого поля нет (`extended-decision.ts:65-87`).
   - «Конкурс/competition»: отдельной таблицы нет, это `League.name` (`schema.prisma:96-110`).
   - Формат «сб, 28 ноября, 18:00» достижим только через `formatToParts` (Pitfall 13).
   - `Сделать ставку`/`Открыть` в UI-SPEC упомянуты только как запрещённые.
   - «Competition» в поручении исследования соответствует `League`.

8. **e2e-стратегия и загрязнение dev-БД.** Recommendation: Pitfall 16 (стаб API для состояний, живой тест AVAILABLE с run-уникальными id, отдельный конфиг), без чистки dev-БД (триггеры append-only это исключают).

9. **(INFO) Неявное предположение сессии UTC во всём репозитории.** Вне фазы; зафиксировать в `deferred-items.md` фазы 15 как наблюдение.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Docker | интеграционные тесты (свой контейнер), e2e-стек | ✓ | сервер отвечает; контейнеры dev-PG и Redis подняты, образы `postgres:18-alpine`, `postgres:18.6-alpine`, `redis:8-alpine` есть | — |
| PostgreSQL 18.6 (dev) | Чтение схемы, планы | ✓ | 18.6 (alpine), `TimeZone = UTC` | Только чтение; запись запрещена |
| Node.js | всё | ✓ | v24.22.0 (требование `>=24 <25`) | — |
| pnpm | сборка/тесты | ✓ | pin `10.34.5` (`packageManager`) | — |
| Vitest unit-проект | быстрые тесты | ✓ | 4.1.11; базовый прогон `responsible-copy` + `home-page-ui`: 19 passed | — |
| Playwright + браузеры | e2e/a11y/визуальная матрица | не проверено | 1.62.1 | `playwright install chromium`; без него остаются markup-тесты |
| Redis | не нужен сканеру | ✓ (не используется) | 8-alpine | — |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** браузеры Playwright (A6).

Известные ограничения базового состояния (из `deferred-items.md` фазы 14, не относятся к фазе 15): `pnpm typecheck` для `@bet-stats/web` может падать из-за повреждённого `apps/web/.next/dev/types/routes.d.ts` (удалить/пересоздать `.next` перед проверкой); интеграционные файлы требуют `DATABASE_URL`/`REDIS_URL`/`OPERATOR_PROXY_SIGNING_SECRET` либо запуска через `node scripts/verify-release-integration.mjs`; `calibration-full-loop.test.ts` превышает 5 с на этой машине; `methodology.spec.ts` второй тест запускается только с `playwright.phase06.config.ts`; бюджет `scriptTransferBytes` 5 960 160 > 5 500 000 существовал до фазы.

## Validation Architecture

> `workflow.nyquist_validation: true` в `.planning/config.json`.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.11 (проекты `unit`, `integration`), Playwright 1.62.1 |
| Config file | `vitest.config.ts` (корень: `unit` = `packages/**/*.test.ts` + `tests/unit/**/*.test.{ts,tsx}`; `integration` = `tests/integration/**/*.test.ts`, без параллелизма файлов), `apps/web/vitest.config.ts` (`app/**/*.test.ts`, `components/**/*.test.ts`), `playwright.config.ts`, `playwright.phase06.config.ts` |
| Quick run command | `pnpm exec vitest run --project unit tests/unit/scanner-domain.test.ts tests/unit/scanner-service.test.ts tests/unit/scanner-ui.test.tsx tests/unit/scanner-guards.test.ts tests/unit/responsible-copy.test.ts` |
| Full suite command | `pnpm test` (unit + web) затем `pnpm test:integration:docker`; перед закрытием фазы `pnpm typecheck`, `pnpm lint`, `pnpm build` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SCAN-01 | Кандидат = самая свежая неперекрытая квитанция тройки; фильтры `SCHEDULED`/`ISSUED`/`PRODUCTION`; окно `[now, now+7d)` по `kickoffUtc` (границы включительно/исключительно); `NO_VALUE` после кандидата прячет кандидата; перекрытая строка с более поздним `createdAt` исчезает | integration (реальный PG) | `pnpm exec vitest run --project integration tests/integration/scanner-api.test.ts` | ❌ Wave 0 |
| SCAN-01 | Порядок: kickoff ↑, рынок (1X2, тотал, BTTS, АГ по линии, точный счёт), выбор (HOME, DRAW, AWAY...); порядок не зависит от edge (фикстура, где edge убывает по порядку и где возрастает) | unit + integration | `pnpm exec vitest run --project unit tests/unit/scanner-service.test.ts` | ❌ Wave 0 |
| SCAN-01 | Усечение по границе матча: 201+ кандидатов -> items ≤ 200, матчи целиком, `truncated=true`, `totalCandidates` истинное число | integration | `pnpm exec vitest run --project integration tests/integration/scanner-api.test.ts -t truncation` | ❌ Wave 0 |
| SCAN-01 | DTO содержит матч, рынок, выбор, edge, EV, источник, `receiptId`, `fixtureId`; лига из `League.name` | integration (HTTP на Nest) | то же | ❌ Wave 0 |
| SCAN-02 | Дословность: строки `0.0432109876543210987654321`, `1.2e-7`, 40-разрядные, ведущие/хвостовые нули проходят БД -> API JSON -> страница неизменными; в API/странице нет `Number(`, `percent(`, `formatOdds(` над значениями квитанции | integration + unit (разметка) + статический grep-тест | `pnpm exec vitest run --project unit tests/unit/scanner-ui.test.tsx tests/unit/scanner-guards.test.ts` | ❌ Wave 0 |
| SCAN-02 | Паритет: столбцы `edge/expectedValue` == jsonb-копия квитанции для посеянных строк | integration | `.../scanner-api.test.ts -t parity` | ❌ Wave 0 |
| SCAN-02 | Свежесть: границы 21599/21600/86400/86401 с; возраст от одного `generatedAt` (инжектируемые часы); отрицательный возраст = FRESH; `forecastNewerAvailable` (INITIAL -> PRE_MATCH; другой матч, `BUILDING`/`BACKTEST` новее не считаются) | unit + integration | `pnpm exec vitest run --project unit tests/unit/scanner-domain.test.ts` | ❌ Wave 0 |
| SCAN-02 | EMPTY против UNAVAILABLE: разные `h2`, чипы, `role="alert"` только у UNAVAILABLE, счётчики только у EMPTY (включая 0); неузнанная форма JSON -> UNAVAILABLE; `allPolicyConfigMismatch` только при `checked>0` и всех причинах; плашка только при флаге | unit (разметка + parseScannerResponse) | `pnpm exec vitest run --project unit tests/unit/scanner-ui.test.tsx` | ❌ Wave 0 |
| SCAN-02 | Устаревшие строки только внутри `details.scanner-stale`; `open` только когда основной список пуст; нет `<table>`, `<th>`, `aria-sort`, элементов сортировки/фильтра | unit (разметка) | то же | ❌ Wave 0 |
| SCAN-03 | Русский словарь запрещённых слов на `apps/web/app/scanner/**` и новые записи; негативные фикстуры ловятся; утверждённые две фразы допущены; английский скан репозитория остаётся зелёным (в новых файлах нет `sure`, `lock`, `guaranteed`...) | unit | `pnpm exec vitest run --project unit tests/unit/responsible-copy.test.ts` | ✅ расширить |
| SCAN-03 | `RiskDisclosure` и верхняя строка во всех трёх состояниях; навигация и главная содержат «Сканер value» (`current` для `/scanner`); `methodology` содержит новое предложение в `#limitations` | unit (разметка + чтение исходника) | `pnpm exec vitest run --project unit tests/unit/scanner-ui.test.tsx tests/unit/home-page-ui.test.tsx` | ✅ home-page-ui расширить |
| SCAN-03 | Нет N+1: число SQL-инструкций при 1 и при 60 кандидатах одинаково и равно 1 | integration | `.../scanner-api.test.ts -t "no N+1"` | ❌ Wave 0 |
| SCAN-03 | Нет клиентского JS: нет `"use client"` в `apps/web/app/scanner/**`; `export const dynamic = "force-dynamic"`; нет прямого импорта бареля домена (кроме `import type`); ни один клиентский файл не импортирует модули сканера | unit (статический) | `pnpm exec vitest run --project unit tests/unit/scanner-guards.test.ts` | ❌ Wave 0 |
| SCAN-03 | CSS-блок `.scanner-*`: нет hex, нет `transition/animation`, шрифты только 14/16/20/24px | web unit | `pnpm --filter @bet-stats/web exec vitest run -c vitest.config.ts components/design-tokens.test.ts` | ✅ расширить |
| SCAN-01/02 | Хелперы времени: «сб, 28 ноября, 18:00», «25.11.2026, 14:05», переход суток в Warsaw, невалидная зона/вход -> исходная строка; `formatAge` | web unit | `pnpm --filter @bet-stats/web exec vitest run -c vitest.config.ts components/time-format.test.ts` | ✅ расширить |
| SCAN-01/02/03 | Визуальная и a11y-матрица (320/375/768/1440 × light/dark/forced-colors, axe, длинные строки, навигация на 768 с 7 пунктами, ссылки ≥ 44 px, порядок Tab) + живой AVAILABLE через настоящий API/БД | e2e | `pnpm exec playwright test -c playwright.scanner.config.ts tests/e2e/value-scanner.spec.ts` (+ обновлённый `tests/e2e/release-accessibility.spec.ts` под `playwright.phase06.config.ts`) | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** быстрая команда выше (unit, секунды), плюс `components/time-format.test.ts`/`design-tokens.test.ts` при правках соответствующих файлов.
- **Per wave merge:** `pnpm test` + интеграционный `scanner-api.test.ts` (свой контейнер).
- **Phase gate:** полный `pnpm test`, `pnpm test:integration:docker`, `pnpm typecheck`, `pnpm lint`, `pnpm build`, e2e сканера и `release-accessibility.spec.ts` зелёные до `/gsd-verify-work`.

### Wave 0 Gaps

- [ ] `packages/domain/src/value/scanner.ts` + экспорт в `packages/domain/src/index.ts` (константы, `classifyOddsFreshness`, типы DTO)
- [ ] `tests/helpers/scanner-seed.ts`: посев с контролем `kickoffUtc`, `status`, `createdAt`, `supersedesValueReceiptId`, `submittedAt`, нескольких прогнозов на матч. Базовый `seedExtendedMarketsFixture` жёстко задаёт `FINISHED` и kickoff `2026-09-10T18:00:00Z`, а `insertValueReceipt` не принимает `createdAt`/`supersedesValueReceiptId`; расширить аддитивно (необязательные опции) или написать отдельный помощник, переиспользуя `seedOddsBook`, `buildCoreValueReceipt`, `buildExtendedValueReceipt`. Квитанции нельзя «состарить» UPDATE (триггер append-only): `createdAt` задавать при INSERT
- [ ] `tests/unit/scanner-domain.test.ts`, `scanner-service.test.ts`, `scanner-ui.test.tsx`, `scanner-guards.test.ts`
- [ ] `tests/integration/scanner-api.test.ts` (свой контейнер, `prisma migrate deploy`, как `extended-markets-api.test.ts`)
- [ ] `tests/e2e/value-scanner.spec.ts` + стаб API + `playwright.scanner.config.ts`
- [ ] Обновить `tests/e2e/release-accessibility.spec.ts:7` (список пунктов навигации)
- [ ] Расширить `tests/unit/responsible-copy.test.ts`, `tests/unit/home-page-ui.test.tsx`, `apps/web/components/time-format.test.ts`, `apps/web/components/design-tokens.test.ts`
- Фреймворки ставить не нужно.

## Security Domain

> `security_enforcement: true`, `security_asvs_level: 1`, `security_block_on: high` (`.planning/config.json`).

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Публичная аналитическая страница, как `scorecards`; операторского контура у сканера нет |
| V3 Session Management | no | Сессий нет; решение eligibility приходит заголовками от сервера Next |
| V4 Access Control | yes | `@UseGuards(EligibilityGuard)` на контроллере (регион, возраст, давность решения ≤ 1 ч); заголовок `Cache-Control: private, no-store, max-age=0`; пути сканера не выдают `OperatorGuard`-данные |
| V5 Input Validation | yes | Эндпоинт без параметров: любой query-ключ -> `BadRequestException("INVALID_SCANNER_QUERY")`; SQL только тегированным шаблоном `$queryRaw` с параметрами (никакой конкатенации); ручной fail-closed разбор ответа на странице (`zod` не установлен) |
| V6 Cryptography | no | Не применяется (хешей/секретов сканер не создаёт) |
| V7 Error Handling/Logging | yes | Клиент видит только типизированный код (`DATABASE_UNAVAILABLE`); внутренние причины в лог оператора (как `unavailable()` в `value.service.ts`); страница не выдумывает причин сбоя (UNAVAILABLE без деталей) |
| V8 Data Protection | yes | Не отдавать `receipt` jsonb целиком (поле `sources` с хешами наблюдений, `payloadBytes`): только три пути `#>>`; `no-store` на ответе API и на запросе страницы |
| V14 Configuration | yes | Не читать `.env`; `API_ORIGIN` и eligibility только из окружения сервера Next, как в `scorecards/page.tsx` |

### Known Threat Patterns for этого стека

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Внедрение через `source` (пользовательская метка коэффициентов, произвольная строка без ограничения длины, проверяется только непустота: `contract.ts:38`) | Tampering / XSS | React экранирует текст; рендерить только как текст (никаких `dangerouslySetInnerHTML`); `overflow-wrap: anywhere`; тест с `<script>`-подобной меткой в фикстуре и проверкой экранирования в разметке |
| Утечка внутренних данных квитанции | Information disclosure | Явный список выбираемых полей; DTO не содержит `receipt`, `sources`, `assumptions`, `gates` |
| Дорогой публичный запрос (DoS) | Denial of service | Запрос ограничен окном 7 суток и потолком 200 строк; план 50-75 мс; не добавлять параметров; при росте объёма пересмотреть индекс (условие в Code Examples); rate limiting в проекте отсутствует (ASVS L1 не требует) |
| Обход eligibility | Elevation / spoofing | Заголовки выставляет только сервер Next (`ELIGIBILITY_*`); `EligibilityGuard` уже проверяет давность решения |
| Кэширование приватных данных промежуточным звеном | Information disclosure | `Cache-Control: private, no-store, max-age=0` на API, `cache: "no-store"` и `force-dynamic` на странице |
| Рендер устаревшего снимка как актуального | Repudiation / integrity | `generatedAt` в ответе и в шапке, `force-dynamic`, пометка устаревания по возрасту, расчёт возраста на сервере по одному моменту |
| Ссылка `target="_blank"` без `rel` | Tampering (tabnabbing) | `rel="noopener noreferrer"` на «Квитанция (JSON)» |

## Sources

### Primary (HIGH confidence)
- Прочитано в этой сессии: `.planning/phases/15-7-day-value-scanner/15-CONTEXT.md`, `15-UI-SPEC.md`; `.planning/REQUIREMENTS.md` (SCAN-01..03); `.planning/ROADMAP.md` (Phase 15); `.planning/phases/14-.../14-VERIFICATION.md`, `deferred-items.md`; `AGENTS.md`; `apps/web/AGENTS.md`.
- Схема и миграции: `packages/database/prisma/schema.prisma` (модели `League` 96-110, `Fixture` 189-220, `ForecastSnapshot` 617-654, `ManualOddsSnapshot` 668-687, `ManualOddsSelection` 815-825, `ValueReceipt` 828-853, enum 71-86); `migrations/20260905_phase03_forecast_value_snapshots/migration.sql` (триггеры 169, 175, `guard_value_pair` 157-168).
- dev-БД (только `SELECT`/`\d`/`pg_dump -s`): колонки и индексы `ValueReceipt`, `ForecastSnapshot`, типы `Fixture.kickoffUtc` (`timestamp without time zone`), распределения исходов, причин, размеров jsonb, версий конфигурации, числа заменённых коэффициентов.
- Одноразовый PostgreSQL 18.6 (`postgres:18.6-alpine`, удалён): EXPLAIN ANALYZE, поведение Prisma 7.10.0 + adapter-pg (`$queryRaw`, параметры `text[]`, события `query`, `$extends`, часовые пояса), проверка усечения по границе матча.
- Код: `apps/api/src/modules/value/{value.controller,value.service,value.module}.ts`, `evaluation/{evaluation.controller,evaluation.service}.ts`, `eligibility/eligibility.guard.ts`, `app.module.ts`, `main.ts`; `packages/domain/src/value/{decision,extended-decision,contract}.ts`, `markets/registry.ts`, `odds/contract.ts`; `packages/football-data/src/provider.interface.ts:10`; `apps/web/app/{page,layout}.tsx`, `scorecards/page.tsx`, `internal-api/{scorecards,value/[receiptId]}/route.ts`, `methodology/page.tsx`, `components/{release-navigation,risk-disclosure,enum-labels,time-format,design-tokens.test}.ts(x)`; тесты `tests/unit/{responsible-copy,home-page-ui,scorecard-ui,internal-api-route}.test.*`, `tests/integration/{value-api,value-receipt,extended-markets-api}.test.ts`, `tests/helpers/extended-markets-seed.ts`, `tests/e2e/{extended-markets,release-accessibility}.spec.ts`, `playwright*.config.ts`, `scripts/verify-release-integration.mjs`.
- Документация Next.js в репозитории: `apps/web/node_modules/next/dist/docs/01-app/02-guides/caching-without-cache-components.md`.

### Secondary (MEDIUM confidence)
- Запуск Node 24.22: `Intl.DateTimeFormat("ru-RU", ...)` (формат даты, `formatToParts`, `hourCycle`), `decimal.js 10.6.0` (`toString()` экспонента).

### Tertiary (LOW confidence)
- Нет (внешних веб-источников не использовалось: все вопросы решаются кодом, схемой и запусками; `research-plan` seam не вызывался, так как библиотечных/веб-вопросов не было).

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — новых пакетов нет, версии прочитаны из `package.json`.
- Architecture: HIGH — SQL, планы и поведение клиента проверены запуском; DTO следует UI-SPEC и коду.
- Pitfalls: HIGH — каждый воспроизведён или подтверждён чтением/запуском; два дискреционных вопроса (пороги, граница усечения) отмечены MEDIUM.

**Research date:** 2026-11-25
**Valid until:** 2026-12-25 (стабильный стек; пересмотреть при смене PostgreSQL < 18, включении `cacheComponents` или добавлении писателя `supersedesValueReceiptId`)
