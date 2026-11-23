---
status: complete
phase: 11-dixon-coles-model-version
source: [11-VERIFICATION.md]
started: 2026-11-23T20:45:00Z
updated: 2026-11-23T22:10:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Принять или отклонить отклонение по порядку (дефолт DC раньше сравнения)
expected: Явное решение владельца: принять отклонение (D-01, D-13) либо вернуть дефолт на poisson-ensemble-v1 до первого сравнения; при принятии добавить override в 11-VERIFICATION.md
result: passed — принято владельцем (2026-11-23T19:56:16.000Z); дефолт остаётся dixon-coles-ensemble-v1, override добавлен в 11-VERIFICATION.md

### 2. Прогнать реальное сравнение V1 и DC на данных окружения и записать результат
expected: Сохранённая квитанция model-comparison-v2 на реальной когорте не меньше 30 исходов; при ρ = 0 из-за нехватки истории вердикт INCONCLUSIVE интерпретируется как «нет доказательства», а не «DC не хуже»
how_to: |
  Подробно — 11-OPERATOR-COMPARISON.md. Кратко (воркер data-sync запущен, DATABASE_URL и REDIS_URL заданы, проект собран):
    node scripts/model-comparison.mjs run --from <ISO UTC> --to <ISO UTC> [--league league-pl,...]
  Команда подаёт пару планов V1/DC на одних окнах, ждёт воркер и печатает квитанцию model-comparison-v2.
  Сохраните вывод (--json) в артефакт и впишите в result размер выборки, дельты и вердикт.
  Выборка меньше 30 даёт INCONCLUSIVE — это «нет доказательства», а не «DC не хуже»; расширьте диапазон.
result: issue
reported: |
  Реальный прогон на копии dev-данных (одноразовые Postgres/Redis, воркер в deterministic, 2026-11-23) не дал квитанции.
  V1-план прошёл целиком: 57/57 окон. DC-план упал на первом окне: Postgres RAISE "settlement revision must link predecessor".
severity: blocker

### 3. Проверить в рабочей БД, какой метод ρ реально выпускается
expected: Видна доля mle-low-score-v1 / pooled-fallback-v1 / insufficient-sample-zero / out-of-band-zero. SQL: SELECT receipt->'receipt'->'dixonColes'->>'method', count(*) FROM "ForecastSnapshot" WHERE "modelVersion"='dixon-coles-ensemble-v1' GROUP BY 1
result: pass
observed: |
  Dev-БД football_prediction, 2026-11-23. Методы ρ у снимков dixon-coles-ensemble-v1: insufficient-sample-zero = 3 из 3
  (mle-low-score-v1, pooled-fallback-v1, out-of-band-zero = 0). Снимков poisson-ensemble-v1: 627.
  Завершённых матчей: 463 (kickoff 2026-08-15..2026-11-22). Pre-match V1 снимков на завершённых матчах с cutoff < kickoff
  и issuedAt <= kickoff: 110. Порог пула 300, лиги 150, значит ρ = 0 везде, дефолтная модель численно совпадает с Poisson.
  BacktestPlan в БД: 0.

## Summary

total: 3
passed: 2
issues: 1
pending: 0
skipped: 0
blocked: 0

## Gaps

- truth: "Оператор может подать V1 и DC на одни окна и получить квитанцию сравнения (MODEL-03)"
  status: failed
  reason: "Settlement не поддерживает два прогноза на один матч: DC-план падает на первом окне после V1"
  severity: blocker
  test: 2
  root_cause: "persist_settlement_receipt (migrations/20260908_phase04_settlement_receipts) считает revision = MAX(revision по fixtureId)+1, а триггер guard_settlement_receipt требует для revision > 1 ссылку на предшественника с тем же forecastSnapshotId. Второй прогноз (DC) на том же матче получает revision 2 без предшественника."
  artifacts:
    - path: "packages/database/prisma/migrations/20260908_phase04_settlement_receipts/migration.sql"
      issue: "revision считается по матчу, а цепочка ревизий привязана к прогнозу"
    - path: "packages/database/src/evaluation/settlement-pipeline.ts"
      issue: "processRevision вызывает persist_settlement_receipt для каждого snapshot; priorSettlement ищется только по supersedesResultVersionId"
  missing:
    - "Ревизии settlement считать по паре (fixtureId, forecastSnapshotId), новая миграция + тест на два прогноза одного матча"
    - "CLI model-comparison: строить окна только для матчей с билдами доказательств на точное время отсечки (иначе EVIDENCE/REQUIRED_EVIDENCE_UNAVAILABLE роняет весь план)"
    - "CLI model-comparison: матчи с одинаковым временем начала получают отсечку +1 мс, билда на неё нет (EVIDENCE_CUTOFF_MISMATCH); брать одну отсечку на матч или не сдвигать"
    - "Подавать планы последовательно или сериализовать settlement по матчу (воркер backtest работает с concurrency 2)"
  debug_session: ""
