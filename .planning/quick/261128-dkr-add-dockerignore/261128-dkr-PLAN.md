---
quick_id: 261128-dkr
slug: add-dockerignore
---

# Quick 261128-dkr: `.dockerignore` для operator-образа

## Задача

1. Добавить `.dockerignore` в корень (контекст `infra/Dockerfile.app`): исключить зависимости, результаты сборки и env-файлы; сохранить `scripts/build.mjs` и `packages/database/src/generated`.

## Проверка

- `docker compose -f infra/docker-compose.operator.yml build` с фиктивным env-файлом через `--env-file`.
- `tests/integration/operator-gateway-deployment.test.ts` зелёный.
- В образе нет env-файлов с хоста.
