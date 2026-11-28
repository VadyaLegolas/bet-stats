---
phase: quick
plan: 261128-opc
type: execute
files_modified:
  - infra/docker-compose.operator.yml
  - .env.example
  - README.md
  - tests/integration/operator-gateway-deployment.test.ts
---

# Quick 261128-opc: переменные operator-стека

**Проблема:** `infra/docker-compose.operator.yml` не передаёт `API_FOOTBALL_API_KEY` и `ELIGIBILITY_*`, а образ работает с `NODE_ENV=production`, где `readServerConfig` требует ключ API-Football.

## Задача

- **files:** перечислены выше.
- **action:** передать ключ в `api` и `worker`, `ELIGIBILITY_ALLOWED_REGIONS` в `api`, `ELIGIBILITY_REGION` и `ELIGIBILITY_AGE_ACKNOWLEDGED` в `web` с пустыми (закрытыми) значениями по умолчанию; дописать пять переменных в `.env.example`; обновить README.
- **verify:** `tests/integration/operator-gateway-deployment.test.ts`; сборка и запуск стека на фиктивных значениях в отдельном проекте Compose.
- **done:** тесты зелёные, без ключа стек не поднимается, с ключом без `ELIGIBILITY_*` защищённые маршруты отвечают `403`.
