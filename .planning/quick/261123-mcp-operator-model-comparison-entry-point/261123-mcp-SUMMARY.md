---
status: complete
---
# Quick 261123-mcp: итог

**Форма — CLI-скрипт** `scripts/model-comparison.mjs` (`run | submit | status | compare`), а не эндпоинт: подача планов — запись плюс очередь, оператору нужен контроль диапазона без расширения HTTP-поверхности и без eligibility-заголовков; образец — `scripts/seed-configured-leagues.mjs`. Логика в `workers/data-sync/src/jobs/model-comparison*.ts` (тестируема), `.mjs` только подключает зависимости. Квитанция строится тем же кодом, что `GET /evaluation/model-comparison` (`compareBacktestPlans` + `toModelComparisonResult`); эндпоинт остаётся рабочим.

- Окна: FINISHED-матчи диапазона с известным результатом к `evaluationAsOf`; прогноз за 1 ч до матча, `trainingEndsAt` (там фитится ρ) на 24 ч раньше, результат известен через 48 ч. Строгое возрастание cutoff (тай одновременных матчей разводится на 1 мс).
- Идемпотентность: id планов выводятся из параметров и набора окон; `createPlan` и jobId очереди детерминированы.
- Лимиты `BACKTEST_LIMITS` соблюдаются (окна ≤ 500, concurrency ≤ 4, диапазон ≤ 365 суток).
- Вердикт не менялся: INCONCLUSIVE при выборке < 30, WORSE публикуется как есть; автоповышения модели нет, дефолт DC не тронут.

Проверки: unit 672/672 (13 новых), integration `backtest-model-comparison.test.ts` на реальных Postgres 18 и Redis 8 — 1/1, `pnpm typecheck` 7/7, lint data-sync чистый.
Документация: `.planning/phases/11-dixon-coles-model-version/11-OPERATOR-COMPARISON.md`; инструкция в `11-UAT.md`; curl в `11-03-SUMMARY.md` обновлён (`x-operator-credential`).
Не выполнено: сам прогон на живых данных (UAT-пункт 2 остаётся pending у оператора).
