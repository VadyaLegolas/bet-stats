---
status: testing
phase: 11-dixon-coles-model-version
source: [11-VERIFICATION.md]
started: 2026-11-23T20:45:00Z
updated: 2026-11-23T21:30:00Z
---

## Current Test

number: 2
name: Прогнать реальное сравнение V1 и DC на данных окружения и записать результат
expected: |
  Сохранённая квитанция model-comparison-v2 на реальной когорте не меньше 30 исходов; при ρ = 0 из-за нехватки
  истории вердикт INCONCLUSIVE интерпретируется как «нет доказательства», а не «DC не хуже».
note: Данных для содержательного сравнения пока нет (110 из 300 pre-match снимков для пула), решение по тесту 2 ожидается от владельца.
awaiting: user response

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
result: [pending]

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
issues: 0
pending: 1
skipped: 0
blocked: 0

## Gaps
