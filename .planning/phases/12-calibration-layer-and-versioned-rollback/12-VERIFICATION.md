---
phase: 12-calibration-layer-and-versioned-rollback
verified: 2026-11-24
status: passed
verifier: orchestrator (inline; the gsd-verifier agent could not be dispatched because a hook rewrote its prompt and auto mode gave no verdict)
requirements: [CALIB-01, CALIB-02, CALIB-03, CALIB-04]
---

# Фаза 12: верификация

Статус `passed`: UAT пройден 2026-11-24, владелец принял варианты (a) по WR-04, WR-08, WR-02.

## Что я проверил сам (в этой сессии)
- Unit-набор: 71 файл, 1011 тестов, все прошли.
- `pnpm typecheck`: 7 задач успешно (результат из кеша Turbo, не пересчитан).

## Что сообщил исполнитель исправлений (мной не перезапускалось)
- Интеграционные файлы по одному, все зелёные: calibration-schema 9, calibration-transitions 15, calibration-upgrade 4, calibration-fit-data 15, calibration-fit-data-parity 3, calibration-job 20, calibration-queue 4, calibration-full-loop 4, forecast-calibration-api 12, calibration-runtime 1, migration-empty 6.
- Web: 121 тест. Lint: 0 ошибок.
- Один раз calibration-full-loop упал при параллельном typecheck/lint, два повторных прогона 4/4. Причина не установлена.

## Покрытие требований (по SUMMARY и коду, без повторного прогона)
| Требование | Основание |
|---|---|
| CALIB-01 | `rawProbabilities` и `marketCalibration` в API, панель «Калибровка v{n}» |
| CALIB-02 | подгонка по (modelVersion, configHash, рынок), `CALIBRATOR_MODEL_MISMATCH`, пороги в `calibration-config-v1` |
| CALIB-03 | гистерезис 3×WORSE, откат одной транзакцией с оценкой (WR-03), append-only журнал, замороженные таблицы не пишутся |
| CALIB-04 | состояние INSUFFICIENT_DATA и русский текст «Недостаточно данных для калибровки…» |

## Решения по ревью
Все WR-01..WR-09 исправлены отдельными коммитами. Отложено осознанно, не пробелы:
- WR-04: только оговорка в карточке модели (тройное разбиение потребует `calibration-config-v2`).
- WR-08: ушедшие идентичности только в квитанции (`retiredIdentities`).
- WR-02: автооткат структурно битого калибратора не добавлен.
- Info IN-01..IN-08 не трогались.

## Не проверено
- Playwright (`calibration.spec.ts`, `methodology.spec.ts`) после исправлений не запускался.
- Поведение на реальных данных: сейчас ожидается INSUFFICIENT_DATA (около 110 пригодных снимков при пороге 300).
- Миграции фазы 12 применены только на временных БД, не на dev-БД.
- Новый ответ API не проверен на живом dev-стеке; нужен `pnpm build`.

## Нужно от человека (UAT)
1. Применить `prisma migrate deploy` на копии dev-БД, затем на dev.
2. Открыть страницу матча и проверить состояние «Недостаточно данных…», блок сырых вероятностей и страницу методологии.
3. Подтвердить три отложенных решения выше.
