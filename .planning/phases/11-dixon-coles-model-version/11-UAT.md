---
status: testing
phase: 11-dixon-coles-model-version
source: [11-VERIFICATION.md]
started: 2026-11-23T20:45:00Z
updated: 2026-11-23T20:45:00Z
---

## Current Test

number: 2
name: Прогнать реальное сравнение V1 и DC на данных окружения и записать результат
expected: |
  Сохранённая квитанция model-comparison-v2 на реальной когорте не меньше 30 исходов; при ρ = 0 из-за нехватки
  истории вердикт INCONCLUSIVE интерпретируется как «нет доказательства», а не «DC не хуже».
awaiting: user response

## Tests

### 1. Принять или отклонить отклонение по порядку (дефолт DC раньше сравнения)
expected: Явное решение владельца: принять отклонение (D-01, D-13) либо вернуть дефолт на poisson-ensemble-v1 до первого сравнения; при принятии добавить override в 11-VERIFICATION.md
result: passed — принято владельцем (2026-11-23T19:56:16.000Z); дефолт остаётся dixon-coles-ensemble-v1, override добавлен в 11-VERIFICATION.md

### 2. Прогнать реальное сравнение V1 и DC на данных окружения и записать результат
expected: Сохранённая квитанция model-comparison-v2 на реальной когорте не меньше 30 исходов; при ρ = 0 из-за нехватки истории вердикт INCONCLUSIVE интерпретируется как «нет доказательства», а не «DC не хуже»
result: [pending]

### 3. Проверить в рабочей БД, какой метод ρ реально выпускается
expected: Видна доля mle-low-score-v1 / pooled-fallback-v1 / insufficient-sample-zero / out-of-band-zero. SQL: SELECT receipt->'receipt'->'dixonColes'->>'method', count(*) FROM "ForecastSnapshot" WHERE "modelVersion"='dixon-coles-ensemble-v1' GROUP BY 1
result: [pending]

## Summary

total: 3
passed: 1
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps
