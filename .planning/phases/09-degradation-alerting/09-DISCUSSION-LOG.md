# Phase 9: Degradation Alerting - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-11-06
**Phase:** 9-degradation-alerting
**Areas discussed:** Канал доставки, Севьорити и затихание, Вид в центре операций, Пороги и анти-фатигу

---

## Канал доставки (delivery channel)

| Option | Description | Selected |
|--------|-------------|----------|
| Generic JSON webhook only | Единственный необязательный `ALERT_WEBHOOK_URL`, POST через нативный `fetch`, ноль новых зависимостей | ✓ |
| Webhook + SMTP | Дополнительно nodemailer; рейт-лимиты free-tier не проверены, лишняя поверхность секретов | |
| Отдельный Telegram-формат | Специализированный формат канала, привязка к одному провайдеру | |

**User's choice:** delegated to agent («реши все сам»)
**Notes:** Агент выбрал webhook-only (D-01/D-02): SMTP отложен как второй dispatcher за тем же интерфейсом; несовершённый канал никогда не теряет и не глушит алерт — детекция живёт в PostgreSQL.

---

## Севьорити и затихание (severity tiers, lifecycle, quieting)

| Option | Description | Selected |
|--------|-------------|----------|
| Two tiers (WARNING/CRITICAL) + автозакрытие | OPEN→RESOLVED автоматически, acknowledge без удаления, append-only transition-строки | ✓ |
| Single severity + ручной закрытие | Проще, но оператор вынужден закрывать вручную | |
| Три+ уровня с шумными оповещениями | Блокируют alert fatigue (успех-критерий 4) | |

**User's choice:** delegated to agent («реши все сам»)
**Notes:** Решение D-03..D-05: два тира, эскалация на месте с записью transition, один OPEN-ряд на dedup fingerprint, повторное уведомление только на эскалации, WARNING требует 2 последовательных тика (flap damping), по-задачные фейлы не алертятся — только группы по root cause.

---

## Вид в центре операций (operations-center view)

| Option | Description | Selected |
|--------|-------------|----------|
| Отдельный Block «Алерты» на /internal/operations | Block-конвенции фаз 6/8, русские лейблы, loading/error/empty, без новых nav-пунктов | ✓ |
| Отдельная подстраница алертов | Больше места для истории, но лишний маршрут сейчас | |
| Вкладка/модал поверх существующих блоков | Сложнее выдержать конвенции | |

**User's choice:** delegated to agent («реши все сам»)
**Notes:** Решение D-06/D-07: активные сверху (severity desc, lastSeen desc), резолвнутые за 7 дней, DTO только из типизированных безопасных полей + planted-secret тест; отдельная подстраница отложена, пока блок вмещает историю.

---

## Пороги и анти-фатигу (thresholds and evaluation)

| Option | Description | Selected |
|--------|-------------|----------|
| Evaluator-tick в workers/data-sync (5 мин), заданные пороги | Один scheduler-тик читает PostgreSQL+Redis, упсертит алерты, затем dispatch | ✓ |
| Пороги per-signal настраиваемые через UI | Операторская настройка — отложена, пороги в env/config | |
| Реактивные алерты по событию (без тика) | Тики дают дедуп-окно и flap damping; реактивность теряется | |

**User's choice:** delegated to agent («реши все сам»)
**Notes:** Решение D-08..D-13: 5xx ≥10% при ≥10 запросах за 5 мин (Redis-бакеты через exception filter); quota ≥80%→WARNING, ≥100% или criticalReservations→CRITICAL; sync ≥5 FAILED/10min→WARNING, BLOCKING→CRITICAL; backup STALE(25h)→WARNING, FAILED/48h→CRITICAL, NOT_CONFIGURED не алертит; недельный synthetic delivery-health алерт (сбой доставки сам себя алертит).

---

## the agent's Discretion

- Все четыре области форума — оператор делегировал полным текстом «реши все сам».
- Дополнительно отдано агенту: имена env-переменных, точная раскладка колонок OpsAlert/transition/delivery, форма webhook-envelope, точка подключения alerts-чтения в `operations.service.ts`, тюнинг порогов планировщиком, схема ключей Redis-бакетов, полная тестовая матрица.

## Deferred Ideas

- SMTP/email dispatch (`nodemailer`) — «optionally» из роадмапа, позже вторым dispatcher'ом.
- Пользовательские нотификации (Telegram/email) — вне v1.1.
- Paid alerting SaaS (Sentry/PagerDuty/Healthchecks.io) — вне скоупа.
- Отдельная подстраница истории алертов — когда 7-дневный блок перестанет вмещаться.
- Операторский UI настройки порогов — пока env/config.
