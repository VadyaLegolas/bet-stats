---
status: complete
quick_id: 261128-opc
---

# Quick 261128-opc: сводка

- `infra/docker-compose.operator.yml`: `API_FOOTBALL_API_KEY` передаётся в `api` и `worker`, `ELIGIBILITY_ALLOWED_REGIONS` — в `api`, `ELIGIBILITY_REGION` и `ELIGIBILITY_AGE_ACKNOWLEDGED` — в `web`. Значения по умолчанию пустые (`false` для возраста).
- `infra/Dockerfile.app`: образ не собирался (`Cannot find module '/app/scripts/build.mjs'`), добавлено копирование этого файла.
- `.env.example`: пять переменных; `API_FOOTBALL_API_KEY` закомментирован, так как пустая строка отклоняется проверкой конфигурации в любом режиме.
- `README.md`: разделы «Файл `.env`» и «Контейнерное окружение со шлюзом оператора».

## Проверка

- `tests/integration/operator-gateway-deployment.test.ts`: 11 из 11.
- Отдельный проект Compose с фиктивными значениями, порт 18080: образ собрался; без ключа `api` и `worker` не стартуют; с ключом все службы healthy; без `ELIGIBILITY_*` маршрут `/internal-api/scorecards` отвечает 403, с ними — 400 (проверка доступа пройдена, не хватает параметров запроса). Тестовый стек, образы и кэш сборки удалены.

## Не исправлено

- Из `worker` не разрешается `api.football-data.org` (`EAI_AGAIN`): сеть `internal: true` не даёт выхода к поставщикам.
- Нет `.dockerignore`: в образ копируются локальные `node_modules`, `.next` и `dist` (контекст около 1 ГБ).

## Отступления

- Агенты планировщика и исполнителя не запускались: правка выполнена оркестратором.
