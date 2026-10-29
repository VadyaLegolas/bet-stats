---
status: diagnosed
trigger: "UAT phase 08 test 6: «все недоступно» — операции (backup/drill triggers, overview) недоступны человеку из интерфейса"
created: 2026-10-29T00:00:00.000Z
updated: 2026-10-29T00:00:00.000Z
---

## Current Focus

hypothesis: CONFIRMED (root cause found, diagnose-only mode — no fix in this session)
AND-gate fired: two independent contributing causes must both be true for the symptom, and both were directly observed:
  (1) code — `isProtectedReplayPath` allowlist covers only replay prefixes, so even a running gateway never signs operations paths;
  (2) topology/config — the gateway is not part of the dev launcher/docker-compose at all, so no signing ingress exists for a human even for replay paths.
next_action: return diagnosis to caller (plan-phase --gaps handles the fix)

## Symptoms

expected: Страница операций и её действия доступны по штатному ingress (документированный путь: оператор через шлюз → подписанный web-прокси → OperatorGuard, 08-03-PLAN line 32).
actual: «все недоступно» — все блоки `/internal/operations` показывают «Этот операционный блок недоступен…», обе кнопки триггеров недоступны оператору в обычном браузере.
errors: HTTP 404 `{ message: "Not found" }` от `/internal-api/operations/*` при обращении без HMAC-подписи.
reproduction: Test 6 in UAT (08-UAT.md) — открыть `/internal/operations` в обычном браузере без подписанных заголовков.
started: Discovered during UAT (2026-10-29); гэп существовал с момента реализации 08-03 (2026-10-24).

## Eliminated

- hypothesis: UI/функция бэкапов сломана (кнопки/блок рендерятся неверно).
  evidence: UAT test 1 — тот же блок и кнопки полностью работают через подписанный тест-драйвер (данные рендерятся, trigger POST → 202, бэкап 18.5 МБ, SUCCEEDED). Функция исправна; ломается только ingress.
  timestamp: 2026-10-29
- hypothesis: dev-обход прокси существует, но сломан/недоступен (например, секрет не задан в dev).
  evidence: 02-19-PLAN line 88 требует «Do not accept … a permissive development bypass» — обхода нет by design; в route.ts:30,44 при отсутствии подписи или `OPERATOR_PROXY_SIGNING_SECRET`/`OPERATOR_CREDENTIAL` — единый fail-closed 404. Отсутствие dev-секрета — не причина: причина в отсутствии какого-либо signing-агента для человека.
  timestamp: 2026-10-29
- hypothesis: шлюз запущен в dev и подписывает операции, но подпись невалидна (расхождение канонической строки).
  evidence: scripts/app-lifecycle.ps1 не содержит упоминаний gateway/8080/operator (grep — только docker compose up postgres); infra/docker-compose.yml не содержит сервиса operator-gateway. Шлюза в dev-топологии просто нет; расхождение подписи не проверяемо.
  timestamp: 2026-10-29

## Evidence

- timestamp: 2026-10-29
  checked: apps/web/app/internal-api/operations/[[...path]]/route.ts
  found: verifyIngressOperationsRequest (lines 25-39) требует `x-operator-subject/timestamp/signature` с HMAC-SHA256 от `OPERATOR_PROXY_SIGNING_SECRET`, freshness 5 мин, allowlist `OPERATOR_AUTHORIZED_SUBJECTS`; без валидной подписи proxy() (line 44) возвращает fail-closed 404. dev-обхода нет ни в одном условии.
  implication: единственный источник валидной подписи — внешний signing-ingress; обычный браузер его никогда не предъявит.
- timestamp: 2026-10-29
  checked: infra/operator-gateway/security.mjs
  found: `protectedPrefixes = ["/internal/pipeline/replay", "/internal-api/pipeline/replay"]` (line 3); `isProtectedReplayPath` (lines 6-8) — единственный триггер подписи. Пути `/internal-api/operations*` не покрыты.
  implication: даже работающий шлюз пропустил бы операции БЕЗ подписи → прокси ответил бы 404. Первая (кодовая) половина AND-gate.
- timestamp: 2026-10-29
  checked: infra/operator-gateway/server.mjs
  found: строки 114-125: `signedOperatorHeaders` применяется только при `protectedPath === true`; иначе запрос форвардится как есть (после stripOperatorHeaders). Basic auth требуется только для protected-путей (line 115).
  implication: подтверждает, что операции через шлюз остаются unsigned по конструкции.
- timestamp: 2026-10-29
  checked: scripts/app-lifecycle.ps1, infra/docker-compose.yml
  found: grep по scripts/ — ни одного упоминания gateway/8080; app-lifecycle.ps1:126 запускает только postgres через docker compose; docker-compose.yml не содержит operator-gateway.
  implication: вторая (топологическая) половина AND-gate: signing-ingress в dev-стеке не существует в принципе. Разработчик/оператор, запускающий стек штатным лаунчером, не имеет ни одного пути получить подпись.
- timestamp: 2026-10-29
  checked: docs/superpowers/specs/2026-08-31-docker-basic-auth-operator-gateway-design.md
  found: Scope (lines 9-14): «The gateway protects only these path families: /internal/pipeline/replay*, /internal-api/pipeline/replay*. All other Next.js routes remain public.»
  implication: replay-only-скоуп — исходное дизайн-решение фазы 02; при добавлении операций (фаза 08) шлюз не расширяли — требование-реализация не были сведены.
- timestamp: 2026-10-29
  checked: .planning/phases/08-backups-and-restore-verification/08-03-PLAN.md (lines 32, 43, 131)
  found: UAT-критерий плана: «An operator can trigger Backup now and Drill now through the gateway → signed web proxy → OperatorGuard chain».
  implication: план предполагал шлюз как ingress для операций, но не включил расширение gateway-скоупа в задачи — гэп требований: критерий недостижим при реализованном шлюзе.
- timestamp: 2026-10-29
  checked: apps/web/app/internal/operations/page.tsx (lines 40-56), scripts/capture-faq-screenshots.mjs, tests/e2e/operator-overview.spec.ts (per UAT artifacts)
  found: страница — клиентский компонент, сам делает `fetch('/internal-api/operations/overview…')` (line 51) без подписанных заголовков; подписанный доступ существует только у программных драйверов, синтезирующих HMAC in-process (capture-faq-screenshots.mjs:48-56, e2e setExtraHTTPHeaders).
  implication: единственные «клиенты», обходящие гэп, — автоматизация и UAT-драйвер; человек не входит в это множество. Симптом воспроизводится детерминированно (Bohrbug).

## Resolution

root_cause: >
  Ingress-гэп обвязки (AND-gate, две contributing causes):
  (1) [code] Инфра-шлюз подписывает только replay-пути: infra/operator-gateway/security.mjs:3,6-8 — isProtectedReplayPath покрывает исключительно /internal(pipeline/replay|/-api/pipeline/replay)*, поэтому /internal-api/operations* проходит через шлюз unsigned (server.mjs:114-125 подпись только при protectedPath) и попадает в fail-closed 404 прокси apps/web/app/internal-api/operations/[[...path]]/route.ts:44.
  (2) [topology/config] Штатный dev-лаунчер (scripts/app-lifecycle.ps1) и infra/docker-compose.yml вообще не запускают operator-gateway, а dev-обход в прокси запрещён решением 02-19-PLAN («Do not accept … a permissive development bypass») — так что у человека нет ни одного источника HMAC-подписи в документированной топологии.
  Обе причины одновременно необходимы: расширение скоупа шлюза без запуска шлюза в dev ничего не даёт, и наоборот. Требование 08-03-PLAN («operator … through the gateway → signed web proxy → OperatorGuard») было недостижимо при реализованном шлюзе — требование-реализация не сведены. Функция бэкапов/дриллов при этом исправна (UAT test 1 через подписанный драйвер — pass).
fix: (not applied — diagnose-only mode)
verification: (n/a)
files_changed: []
