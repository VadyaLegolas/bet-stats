---
status: complete
quick_id: 261128-dkr
---

# Quick 261128-dkr: сводка

- Добавлен `.dockerignore` в корне: `node_modules`, `dist`, `.next`, `.next-*`, `.turbo`, `*.tsbuildinfo`, env-файлы, `coverage`, отчёты тестов, логи, а также `.git`, `.worktrees`, `backups`.
- Коммит: 61d7737.

## Проверка

- `docker compose -f infra/docker-compose.operator.yml --env-file <фиктивный файл> build`: код 0, около 20 минут (из них экспорт образа около 14 минут, `pnpm install` 202 с, `pnpm build` 107 с). `.env` и `infra/.env` не читались.
- `apps`, `packages`, `workers` без исключённых каталогов занимают 11 МБ против примерно 1 ГБ раньше.
- В образе вне `node_modules` нет env-файлов; `scripts/build.mjs`, `packages/database/src/generated` и результаты сборки api, web и worker на месте. Стек не запускался.
- `tests/integration/operator-gateway-deployment.test.ts`: 12 из 12.
- Тестовые образы удалены; общий кэш сборки Docker не очищался.

## Замечания

- Если в `PATH` нет каталога `DockerDesktop\resources\bin`, сборка из Git Bash падает на `docker-credential-desktop`; он добавлялся в `PATH` только для команд проверки.
- Свободное место на C: за время проверки упало с 1,6 ГБ примерно до 124 МБ; `pagefile.sys` (14 ГБ) изменялся во время сборки.

## Отступления

- Агенты планировщика и исполнителя не запускались: правка выполнена оркестратором.
