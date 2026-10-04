# Отчёт: двуязычный README

## Изменения

- Добавлен корневой `README.md` с русским разделом и зеркальным английским разделом.
- Описаны назначение продукта, пользовательские возможности, ограничения MVP и ответственное использование betting-аналитики.
- Добавлены фактический стек, структура monorepo, требования, Docker/pnpm setup, `.env.example`, команды проверки и roadmap из `.planning/ROADMAP.md`.
- Лицензия не заявлялась: в репозитории не найден файл лицензии.

## Проверки

- `git diff --check` — без ошибок.
- Проверены команды и пути по `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `infra/docker-compose.yml`, `apps/web/package.json` и `workers/data-sync/package.json`.
- README просмотрен на секретоподобные значения; credentials и токены не добавлялись.

## Публикация

- Commit: будет указан после коммита README.
- Branch: `codex/bilingual-readme`.
- Pull Request в `main`: будет указан после публикации.
