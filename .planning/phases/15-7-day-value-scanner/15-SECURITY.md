---
phase: "15"
slug: 7-day-value-scanner
status: verified
threats_open: 0
asvs_level: 1
created: "2026-11-28"
---

# Phase 15 — Security

> Контракт безопасности фазы: реестр угроз из планов 15-01..15-06, принятые риски и журнал аудита.
> Проверка уровня L1: наличие защит в коде и тестах. Тесты прошли в `pnpm verify:release` на `d98de32` и в `value-scanner-live.spec.ts` (3 из 3).

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| браузер → сервер Next | публичный запрос без параметров | HTML |
| сервер Next → NestJS API | заголовки допуска задаёт сервер из своего окружения | заголовки допуска, DTO |
| NestJS API → PostgreSQL | параметризованный raw SQL | метки источников и сохранённые строки |
| пакет домена → клиентский пакет | barrel импортируют клиентские файлы | код модулей |
| тесты и гейты → машина пользователя | контейнеры, сборки, временные worktree | синтетические данные |

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation (evidence) | Status |
|-----------|----------|-----------|----------|-------------|-----------------------|--------|
| T-15-01 | Tampering | raw SQL сканера | high | mitigate | tagged `$queryRaw` (`scanner.service.ts:57`); любой query-ключ даёт 400 (`scanner.controller.ts:16`) | closed |
| T-15-02 | Information disclosure | DTO из JSON квитанции | high | mitigate | выбираются только отдельные пути JSON (`scanner.service.ts:61-113`); точные ключи DTO в `scanner-service.test.ts` | closed |
| T-15-03 | Elevation of privilege | доступ к `GET /value/scanner` | high | mitigate | `EligibilityGuard` (`scanner.controller.ts:9`); 403 в `scanner-api.test.ts:534` | closed |
| T-15-04 | Denial of service | оконный запрос | medium | mitigate | константы окна и `SCANNER_LIMIT`; ограничение частоты принято (R-15-01) | closed |
| T-15-05 | Information disclosure | текст ошибки API | medium | mitigate | клиенту только `DATABASE_UNAVAILABLE` и `SCANNER_READ_FAILED` (`scanner.service.ts:179-184`); см. примечание N-1 | closed |
| T-15-06 | Tampering | часовые пояса | medium | mitigate | `AT TIME ZONE 'UTC'` (`scanner.service.ts:112`) | closed |
| T-15-07 | Repudiation | устаревший снимок как текущий | medium | mitigate | `force-dynamic` и `no-store` | closed |
| T-15-08 | Information disclosure | отображение ошибок | high | mitigate | тест на утечку строки подключения (`scanner-service.test.ts:275-286`) | closed |
| T-15-09 | Tampering | поправки UI-SPEC | medium | mitigate | раздел Amendments, подтверждён пользователем | closed |
| T-15-10 | Repudiation | несколько часов | medium | mitigate | тест единого `generatedAt` | closed |
| T-15-11 | Tampering (XSS) | метки источника, названия | high | mitigate | нет `dangerouslySetInnerHTML`; тесты разметки и охранный тест | closed |
| T-15-12 | Tampering | ссылка в новой вкладке | medium | mitigate | `rel="noopener noreferrer"` (`scanner-rows.tsx:123`) | closed |
| T-15-13 | Repudiation | неверный ответ как данные | high | mitigate | fail-closed `parseScannerResponse` | closed |
| T-15-14 | Information disclosure | состояния ошибок | medium | mitigate | `catch` без вывода тела ответа, фиксированный текст | closed |
| T-15-15 | Repudiation | статический снимок | medium | mitigate | `force-dynamic`, `no-store`, охранный тест (4) | closed |
| T-15-16 | Tampering | форматирование значений | high | mitigate | нет числовых преобразований; охранный тест (5), live-спек | closed |
| T-15-17 | Repudiation | запрещённые формулировки | high | mitigate | русский словарь в `responsible-copy.test.ts` | closed |
| T-15-18 | Tampering | код сканера в клиенте | medium | mitigate | охранные тесты (1)-(3) | closed |
| T-15-19 | Tampering | ранжирование по edge | high | mitigate | охранные тесты (6), (10) | closed |
| T-15-20 | Information disclosure | публичный прокси | low | mitigate | охранный тест (9); маршрута `internal-api/scanner` нет | closed |
| T-15-21 | Tampering | live-спек и dev-база | medium | mitigate | обязательный `DATABASE_URL`, только вставки в `scanner-seed.ts` | closed |
| T-15-22 | Tampering (XSS) | метка-скрипт | high | mitigate | `value-scanner.spec.ts:408-415` | closed |
| T-15-23 | Information disclosure | заглушка API | low | mitigate | только 127.0.0.1, синтетические данные | closed |
| T-15-24 | Repudiation | сбой как «пусто» | high | mitigate | разные состояния в `value-scanner.spec.ts` | closed |
| T-15-25 | Information disclosure | константы в клиентском чанке | low | mitigate | проверка чанков и охранный тест (11) | closed |
| T-15-26 | Tampering | dev-база при прогонах | high | mitigate | одноразовые контейнеры (отчёт исполнителя); подтверждено пользователем (UAT 5) | closed |
| T-15-27 | Denial of service | сборка поверх dev-сервера | medium | mitigate | изолированный worktree (отчёт исполнителя) | closed |
| T-15-28 | Repudiation | красный этап как успех | high | mitigate | таблица этапов и замеры в 15-06-SUMMARY.md; независимая повторная верификация; бюджеты и `scripts/` не менялись | closed |
| T-15-29 | Tampering | удаление каталога perf-audit | medium | mitigate | флаг не передавался; дефект в `deferred-items.md` п. 17 | closed |
| T-15-30 | Information disclosure | секреты в логах | medium | mitigate | `.env` не читались (отчёт исполнителя); подтверждено пользователем (UAT 5) | closed |
| T-15-SC | Tampering | установка пакетов | high | mitigate | с начала фазы lockfile не менялся, в корневом `package.json` только скрипты | closed |

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| R-15-01 | T-15-04 | Ограничение частоты запросов вне ASVS уровня 1 | принято в плане 15-01 | 2026-11-28 |

## Примечания

- **N-1:** операторский лог `ScannerService` пишет исходный текст ошибки (`scanner.service.ts:183`). Это предусмотрено планом, но текст драйвера теоретически может содержать строку подключения. Пользователь этот остаточный риск отдельно не принимал.
- T-15-26, T-15-27 и T-15-30 описывают ход исполнения; машинно задним числом они не доказываются.

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-11-28 | 31 | 31 | 0 | Claude (оркестратор, L1, поиск по коду) |

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-11-28
