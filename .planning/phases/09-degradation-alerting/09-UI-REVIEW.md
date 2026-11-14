# Phase 9 — UI Review

**Audited:** 2026-11-14
**Baseline:** `09-UI-SPEC.md` (approved, 2026-11-06) + locked decisions `09-CONTEXT.md` D-01…D-07
**Screenshots:** captured (dev server on localhost:3000; static captures: loading, loaded desktop 1440/900, mobile 375/812, narrow 320/900, dark theme, zoom-200% @ 320px, full page)
**Interaction captures:** off (workflow.ui_interaction_capture = false); динамика оценивалась по коду и SSR-тестам

**Метод:** код-аудит + живые Playwright-замеры на работающем dev-стеке (`getBoundingClientRect`, `getComputedStyle`), скриншоты light/dark/320px/zoom-200%. Замеры: ширина карточки алертов 729.6px внутри блока 1072px; `dd` margin-inline-start = 40px (браузерное значение по умолчанию); chip 12px/600/radius 9999px; zoom-200% @ 320px scrollWidth−clientWidth = 0px.

---

## Pillar Scores

| Pillar | Score | Key Finding |
|--------|-------|-------------|
| 1. Copywriting | 2/4 | Точный контрактный текст в целом соблюдён, но два системных «протекающих» машинных кода: статус `ACKNOWLEDGED` и сигналы `SYNC_FAILURES`/`DEAD_LETTER` рендерятся сырым английским |
| 2. Visuals | 2/4 | Карточка «Алерты» сжата до 729.6px чужим редакционным правилом `.release-main article { max-width: 76ch }` — ~300px мёртвой зоны справа |
| 3. Color | 2/4 | Чипы — точное воспроизведение token `color-mix` паттерна, dark-тема работает; но 14 кнопок «Подтвердить» рендерятся акцентной заливкой, что прямо запрещено спекой |
| 4. Typography | 3/4 | Все четыре размера и tabular-nums по контракту; третий вес (500) на кнопках — унаследованное глобальное правило |
| 5. Spacing | 2/4 | Токенные отступы в блоке соблюдены, но `dd` внутри `dl` несёт дефолтные 40px браузерного margin — значения «висят» справа от меток |
| 6. Experience Design | 3/4 | Полная матрица состояний (loading/error/empty/channel/redaction/ack + focus-менеджмент) подтверждена кодом, SSR-тестами и живой страницей; мелкие хвосты в пагинации |

**Overall: 14/24**

---

## Top 3 Priority Fixes

1. **Статус `ACKNOWLEDGED` рендерится сырым английским кодом** — оператор видит «ACKNOWLEDGED» в русскоязычном интерфейсе (подтверждено скриншотом и живым DOM); спека требует: строка остаётся «Активен» + маркер «Подтверждён · {время}» (D-04). Фикс: в `apps/web/components/enum-labels.ts` дополнить `ALERT_STATUS_LABELS` (`ACKNOWLEDGED: "Активен"` — статус остаётся активным по D-04) или маппить в `alerts-block.tsx:141`; добавить SSR-тест с `status: "ACKNOWLEDGED"` (сейчас этот путь не покрыт — тесты используют `OPEN` + `acknowledgedAt`).
2. **Словарь сигналов разошёлся с воркером** — воркер эмитит `SYNC_FAILURES` и `DEAD_LETTER` (`workers/data-sync/src/jobs/alerts.ts:179,214`), а карта `ALERT_SIGNAL_LABELS` содержит никогда не возникающие `SYNC_RUN`/`WORKER_JOBS` (`enum-labels.ts:35`) — два из шести реальных сигналов навсегда рендерятся сырым кодом («Сбой синхронизации» и «Групповые сбои задач и мёртвые письма» недостижимы). Фикс: переименовать ключи в `enum-labels.ts` под реальные коды воркера (или добавить алиасы) и синхронизировать таблицу Copywriting в `09-UI-SPEC.md`; обновить SSR-тесты, которые кодифицируют устаревший набор.
3. **Карточка «Алерты» сжата чужим правилом** — `.release-main article { max-width: 76ch }` (`globals.css:828`, editorial-страницы методологии/приватности) попадает и на `<article>` алертового блока: замер 729.6px внутри 1032px контентного бокса. Фикс: заменить селектор на класс (например `.editorial-article`) либо добавить на operations-странице явное `max-width: none` для `article[data-testid="alerts-block"]`. Тот же дефект затрагивает и `BackupStatusBlock` (тоже `<article>`).

---

## Detailed Findings

### Pillar 1: Copywriting (2/4)

Соблюдено (проверено кодом и живым DOM):
- Блочный заголовок `Алерты` (h2), канал доставки, пустые состояния, копирование success/failure, loading «Загрузка: алерты…», error «Этот операционный блок недоступен…» + «Повторить попытку», пагинация «Показано {start}–{end} из {total}», nav `Страницы алертов` — байт-в-байт по контракту (`alerts-block.tsx:83-85,163-183`, `page.tsx:29-34,68`).
- Русский plural-хелпер корректен на всех классах (1 алерт / 2–4 алерта / 5+ алертов; 12→«алертов», 111→«алертов») — `alerts-block.tsx:68-74`; на живой странице «Активные · 17 алертов».
- Русская метка рядом с английским кодом сигнала работает там, где код есть в карте: «Исчерпание квоты провайдера · PROVIDER_QUOTA» (живой DOM).

Дефекты:
- **[BLOCKER] `ACKNOWLEDGED` — сырой машинный статус.** API переводит статус в `ACKNOWLEDGED` (`operations.service.ts:402`), но `ALERT_STATUS_LABELS` содержит только `OPEN`/`RESOLVED` (`enum-labels.ts:34`) → fallback `?? status` рендерит «ACKNOWLEDGED» (`alerts-block.tsx:141`). Живой DOM первой строки: статус-текст «ACKNOWLEDGED» + рядом дубль-маркер «Подтверждён · 13 ноября 2026 г. в 07:50». По спеке и D-04 подтверждение не меняет жизненный цикл: строка должна оставаться «Активен» с маркером. SSR-тест путь `status="ACKNOWLEDGED"` не покрывает (тест на ack использует `OPEN` + локальный ack, `alerts-block.test.ts:193-196`).
- **[BLOCKER] Дрейф кодов сигналов.** Реальные коды воркера: `PROVIDER_QUOTA`, `PROVIDER_CIRCUIT`, `SYNC_FAILURES`, `DEAD_LETTER`, `HTTP_5XX`, `BACKUP_STALENESS`, `DELIVERY_HEALTH` (`workers/data-sync/src/jobs/alerts.ts:112,137,179,214,256,292`). Карта (`enum-labels.ts:35`) спекифицирована как `SYNC_RUN`/`WORKER_JOBS` — эти ключи в проде никогда не встретятся; `SYNC_FAILURES` и `DEAD_LETTER` рендерятся сырыми кодами (живой DOM: голый «SYNC_FAILURES» в 6 строках). SSR-тесты (`alerts-block.test.ts:113-114`) кодифицируют устаревший набор, а не реальность.
- Примечание к dev-данным: сырые `SYNC_STALE`/`PROVIDER_5XX`/`WEBHOOK_FAILED` в живом скриншоте — это сиды integration-тестов в dev-БД (`tests/integration/alerts.test.ts:47,67,116`), не прод-коды; но «неизвестный код → сырой код» для них отработал ровно как задумано, никогда не пусто.
- Канал доставки: «не настроен — алерты сохраняются в базе, в вебхук не отправляются» — точно, не-зелёный (живой DOM, `data-state="unconfigured"`).

### Pillar 2: Visuals (2/4)

- **[BLOCKER-класс] Карточка блока сжата до 76ch.** Замер на живой странице: `article[data-testid="alerts-block"]` = 729.6px при родительском Block-секции 1072px. Причина — глобальное правило editorial-страниц `.release-main article { max-width: 76ch }` (`globals.css:828`); 76ch @ 16px ≈ 730px — совпадение точное. Правая ~300px колонка блока пустует; иерархия «один блок = одна карточка на всю ширину» у всех соседних блоков (Готовность системы, Квоты) — нарушена. Дефект системный: `<article>` из `backup-status-block.tsx:46` сжат тем же правилом.
- Анатомия строки соответствует спеке по составу и порядку: severity-chip → статус-текст (+ маркер) → `<strong>`-заголовок (не h3, иерархия h1→h2 без пропусков — проверено списком заголовков живого DOM) → dl-метаданные → корреляционные ID → действие (`alerts-block.tsx:138-159`).
- Вложенность коробок: Block-секция (карточка) > article (карточка) > li (карточка) — три уровня рамок; это унаследованный паттерн (`backup-status-block.tsx` устроен так же), но на 17 строках смотрится тяжело.
- Чипы с текстовой меткой + 6px точка, radius 9999px — читаемы в light и dark (обе темы сняты).
- Пустая группа «Решённые за 7 дней» с точной копией — живой DOM.

### Pillar 3: Color (2/4)

- Чипы: `CHIP_STYLES`/`RESOLVED_CHIP`/`ACK_CHIP` (`alerts-block.tsx:40-45`) — точная калька `color-mix` паттерна `data-state-notice.tsx:16-22`, значения совпадают со спецификацией (danger 10%/35%, signal 18%/50%, text-secondary 9%/35%, info 10%/35%). Dark-тема проверена скриншотом — читаемо, граница чипа сохранена (forced-colors не ломается).
- RESOLVED-чип нейтральный, не зелёный — по контракту.
- Канал: warning/success/danger токены по состоянию, absence не выглядит зелёным — живой DOM (`data-state="unconfigured"`, цвет `--color-warning`).
- **[WARNING] Акцентная заливка на действии строки.** Глобальный стиль `button { background: var(--color-accent-fill) }` (`globals.css:158-165`) окрашивает «Подтвердить» в фирменный зелёный — на живой странице их **14** подряд. Спека явно: «Accent is **not** used… for the acknowledge action (that uses the default bordered button style)». Кнопки копирования корреляционных ID — тоже акцентные, но это унаследованный `CopyCorrelation` (спека предписывает переиспользовать as-is, поэтому мягче). Итог: акцентная доля на экране кратно превышает заявленные «пагинация + фокус + первичные кнопки страницы».
- Хардкодных hex/rgb в новых файлах нет — только токены и `color-mix`.

### Pillar 4: Typography (3/4)

- Четыре размера по контракту: chip 12px/600 (замер живого DOM: fontSize 12px, fontWeight 600), метаданные 14px, body 16px (унаследовано), h2 1.4rem/600 (унаследовано, не рестайлится).
- `font-variant-numeric: tabular-nums` на «Повторений» и на пагинации — в коде (`alerts-block.tsx:149,183`).
- `overflow-wrap: anywhere` на карточке — длинные ID/области переносятся, не эллипсируются (`card`, `alerts-block.tsx:35`).
- Единственное отклонение: третий вес 500 на кнопках — глобальное правило `globals.css:160`, унаследовано страницей, блоком не введено; спека декларирует два веса (400/600). Заголовки строк — `<strong>` 16/600, не h3 — по контракту.

### Pillar 5: Spacing (2/4)

- Токенные значения внутри блока: внутренний gap строки 8, между строками 16, группа от блока 24, между группами 32 (`alerts-block.tsx:170,176,138`) — соответствует шкале space-2/4/6/8. Паддинг строки 16, карточки 20 (зеркало `page.tsx:22`). Чип-паттерн 2px/10px + gap 4 — как в `data-state-notice.tsx`.
- **[WARNING] Дефолтные 40px у `dd`.** `dl` в строке стилизован (`display:grid; gap:4`), но `dt`/`dd` не ресетнуты: замер живого DOM — `dd { margin-inline-start: 40px }`, display block. Каждая пара «метка → значение» рендерится в две строки с 40px висячим отступом (видно на всех скриншотах). Спека ожидает компактные 14px-метаданные; в проекте уже есть правильный образец — `.evidence-card dd { margin: 0; overflow-wrap: anywhere }` (`globals.css:477`), строки алертов его не получили. Именно это вместе с 17 строками делает блок непропорционально высоким.
- Медиа-правило 480px (`globals.css:356`) покрывает `dl` через `overflow-wrap/min-width` — рефлоу работает, но margin не трогает.
- 320px и zoom-200% @ 320px: замер scrollWidth−clientWidth = 0px, скриншоты без горизонтального скролла — фикс 09-07 подтверждён на живом стеке.

### Pillar 6: Experience Design (3/4)

- Матрица состояний закрыта: loading (`aria-busy` на секции + `role="status"` «Загрузка: алерты…» — снято на скриншоте), block error + «Повторить попытку» (код `page.tsx:33,68`), пустые состояния обеих групп (живой DOM), populated, дедуп один ряд на fingerprint (17 живых строк без дублей), channel-честность трёх состояний (живой DOM: unconfigured), redaction — typed-field рендеринг + canary-тест (`alerts-block.test.ts:170-180`, SSR 39/39, integration canary 25/25 по SUMMARY 09-03).
- Acknowledge-машина: `Подтвердить` → disabled `Подтверждение…` → success (маркер + `role="status"` + перенос фокуса на маркер `tabIndex={-1}` через rAF) / failure (`role="alert"`, кнопка возвращается, состояние не меняется) — `alerts-block.tsx:95-106,156-158`. Resolved-строки без действия, acked-строки — маркер без кнопки (живой DOM: 14 кнопок на 17 строк, у acked строк кнопки нет).
- Клавиатура: глобальный focus-visible ring 2px accent (`globals.css:209-212`), кнопки/ссылки ≥44px (`button` const + globals.css:149).
- Пагинация: собственный `alertPage`, сохраняет прочие параметры (`alerts-block.tsx:187-189`); 17 ≤ 25 — ссылок нет, по контракту.
- Мелкие хвосты: (а) `disabled={pendingId !== null}` блокирует кнопки **всех** строк на время одного подтверждения, а не только своей (`alerts-block.tsx:156`) — при 14 строках это ощущается как заморозка списка; (б) навигация отказов (`page.tsx:106`) собирает query заново и **сбрасывает** `alertPage` — взаимная независимость пагинаций односторонняя (проявится только при >25 алертов); (в) focus при неудачном ack остаётся на re-enable-кнопке без явного возврата (спека не требует, отмечено как наблюдение); (г) путь `status="ACKNOWLEDGED"` от сервера не покрыт SSR-тестом (см. Pillar 1).
- Zoom-200% @ 320px: e2e-кейс 09-07 + мой живой замер (diff = 0px) — рефлоу честный.

---

## Registry Safety

`components.json` отсутствует в репозитории (проверено: корень и `apps/web`) — shadcn не инициализирован, сторонние реестры спекой запрещены. Аудит реестра: пропущен (применён порог `NO_SHADCN`).

---

## Files Audited

- `apps/web/app/internal/operations/alerts-block.tsx` (194 строки, полностью)
- `apps/web/app/internal/operations/page.tsx` (115 строк, полностью)
- `apps/web/app/internal/operations/backup-status-block.tsx` (точечно: card/article/dl)
- `apps/web/components/enum-labels.ts` (108 строк, полностью)
- `apps/web/components/data-state-notice.tsx` (эталонный chip-паттерн, строки 1-55)
- `apps/web/app/globals.css` (токены, button/a/summary, media-правила, `.release-main article`, `.evidence-card dd`, quota-counter/theme-toggle)
- `apps/web/app/internal/operations/alerts-block.test.ts` (точечно: ack-кейсы, лейблы, canary)
- `workers/data-sync/src/jobs/alerts.ts` (точечно: реальные коды сигналов, fingerprint)
- `apps/api/src/modules/operations/operations.service.ts` (точечно: `acknowledgeAlert`, select алертов)
- Захваты: `.planning/ui-reviews/09-20261114-065815/` (ops-desktop-loaded, ops-desktop-full, ops-mobile-loaded, ops-narrow320-loaded, ops-desktop-dark, ops-320-zoom200, ops-desktop/home-base) — в git не попадают (`.planning/ui-reviews/.gitignore`)

---

*Phase: 09-degradation-alerting*
*Review: 09-UI-REVIEW*
