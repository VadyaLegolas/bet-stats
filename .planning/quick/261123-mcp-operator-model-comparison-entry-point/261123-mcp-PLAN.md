# Quick 261123-mcp: операторская точка входа сравнения V1 и Dixon-Coles

Цель: закрыть UAT-пункт 2 фазы 11 — подать пару rolling-origin планов (poisson-ensemble-v1 и dixon-coles-ensemble-v1) на одних окнах, дождаться воркера, получить квитанцию model-comparison-v2.

Задачи:
1. `workers/data-sync/src/jobs/model-comparison.ts` и `model-comparison-cli.ts`: генератор окон, пара планов, идемпотентная подача, ожидание, квитанция.
2. `scripts/model-comparison.mjs` и `pnpm model:compare`.
3. Тесты: unit и integration (Postgres + Redis).
4. Документация `11-OPERATOR-COMPARISON.md`, инструкция в `11-UAT.md`, актуальный curl в `11-03-SUMMARY.md`.
