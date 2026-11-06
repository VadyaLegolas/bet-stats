---
phase: 9
slug: degradation-alerting
status: draft
shadcn_initialized: false
preset: none
created: "2026-11-06"
---

# Phase 9 — UI Design Contract

> Visual and interaction source of truth for the «Алерты» Block on `/internal/operations`. Decisions D-01, D-03…D-07 from `09-CONTEXT.md` are binding. All user-facing copy is Russian (AGENTS.md convention, 2026-10-15); technical identifiers (signal codes, scopes, correlation IDs) stay English.

---

## Design System

| Property | Value |
|----------|-------|
| Tool | none — no `components.json` exists anywhere outside `node_modules` (verified 2026-11-06); the project uses a hand-authored token layer |
| Preset | Not applicable |
| Component library | None installed. Native HTML (`section`, `ul`/`li`, `dl`, `time`, `button`, `nav`, `details`) plus existing project components |
| Icon library | None. Text labels are mandatory; a symbol must never carry severity or state alone |
| Font | Body `--font-sans` = self-hosted IBM Plex Sans (variable 400–700, `apps/web/app/fonts.ts`); headings `--font-serif` = self-hosted Source Serif 4. No font CDN |
| Styling | Tailwind 4 CSS-first is available but this page is built from CSS custom properties in `apps/web/app/globals.css` (matchdata-theme). New alert UI uses only existing tokens (`--color-*`, `--space-*`, `--radius-*`) and the token-driven `color-mix` badge pattern from `data-state-notice.tsx` — no one-off inline hex values, so the dark theme (`:root[data-theme="dark"]`) works automatically |

**Component reuse (existing code — do not re-implement):**

Enumerated by `Get-ChildItem apps/web/components/*.tsx` — 17 components — `@bet-stats/web@0.0.0` (private workspace package, version unresolved: never published) — 2026-11-06. Non-exhaustive list of known-good components, never a closed allowlist.

| Component / asset | Import path | Use in this phase |
|-------------------|-------------|-------------------|
| `Block` (page-local) | `apps/web/app/internal/operations/page.tsx` | Wraps the new «Алерты» section: `aria-labelledby`, `aria-busy`, loading `role="status"`, error `role="alert"` + «Повторить попытку», empty state |
| `CopyCorrelation` (page-local) | `apps/web/app/internal/operations/page.tsx` | Renders each correlation ID as a copy button with polite announcement |
| `BackupStatusBlock` | `apps/web/app/internal/operations/backup-status-block.tsx` | Closest visual analog: co-located `card`/`button` constants, honest non-green states, SSR `renderToStaticMarkup` test style — mirror this structure |
| `enum-labels.ts` | `apps/web/components/enum-labels.ts` | Add `alertSeverityLabel`, `alertStatusLabel`, `alertSignalLabel` maps here; unknown codes must degrade to the raw code (existing `?? value` convention) |
| `formatInstant` | `apps/web/components/time-format.ts` | All timestamps: localized string + `<time dateTime={iso}>` |
| Badge pattern | `apps/web/components/data-state-notice.tsx` (lines 16–49) | Severity/status chips: `color-mix(in srgb, var(--color-*) N%, transparent)` background, token text/border, 6px dot, `borderRadius: 9999px`, `fontSize: 0.75rem`, `fontWeight: 600` |

Page constants are mirrored (not imported) inside sibling blocks to avoid cycles — `backup-status-block.tsx` documents this. The new block follows the same rule: co-locate `card` and `button` constants verbatim from `page.tsx`.

---

## Spacing Scale

Tokens are the existing `--space-*` values from `globals.css`. All are multiples of 4.

| Token | Value | Usage in this phase |
|-------|-------|---------------------|
| `space-1` | 4px | Chip dot gap, focus offset |
| `space-2` | 8px | Row internal gap, chip padding, inline metadata |
| `space-3` | 12px | Row `dl` gaps (matches table cell padding) |
| `space-4` | 16px | Gap between alert rows, block inner spacing |
| `space-6` | 24px | Page grid gap (`page.tsx` grid), block padding |
| `space-8` | 32px | Separation between active and resolved groups |
| `space-12` | 48px | Major section break (unused inside the block) |
| `space-16` | 64px | Page-level only (inherited, not set by this block) |

Exceptions: `44px` is the minimum control height (`button` const in `page.tsx`), not a spacing value. Radius: `--radius-control` 3px / `--radius-panel` 4px (the block card uses `borderRadius: 4`); chips use `--radius-full` 9999px. Borders are 1px.

---

## Typography

Exactly four sizes and two weights. Inherited page typography (`h1`/`h2` from `globals.css`) is not restyled.

| Role | Size | Weight | Line Height |
|------|------|--------|-------------|
| Severity chip / status chip | 12px (`0.75rem`) | 600 | 1.3 |
| Metadata: timestamps, counts, scopes, correlation IDs, pagination, channel line | 14px (`0.875rem`) | 400 (600 for emphasis) | 1.4 |
| Body: row text, `dl` values, buttons, empty/error copy | 16px | 400 (600 for row title `<strong>`) | 1.5 |
| Block heading (`h2`, inherited) | 1.4rem ≈ 22.4px | 600 | 1.2 (browser default margin preserved) |

Rules: button text 16px and never below; long IDs/scope strings use `overflow-wrap: anywhere` (already set on the `card` constant) and keep their full accessible name; no uppercase paragraphs — machine codes render beside their Russian label; `font-variant-numeric: tabular-nums` on counts and pagination. Row titles are `<strong>` at 16/600, **not** an `h3`, so the heading hierarchy stays `h1 → h2` (Block) with no skipped levels.

---

## Color

All values are existing tokens; every chip/background must be built with `color-mix` on tokens (the `data-state-notice.tsx` pattern) so light and dark themes both pass WCAG AA (4.5:1 text, 3:1 boundaries). State meaning always includes text — color is supplemental.

| Role | Light | Dark | Usage |
|------|-------|------|-------|
| Dominant (60%) `--color-page` | `#f1f3f0` | `#0e1512` | Page background (inherited) |
| Secondary (30%) `--color-surface` | `#ffffff` | `#17211d` | Block card, alert row cards, `details` groups |
| Accent (10%) `--color-accent` | `#14503b` | `#5aab8a` | Links (pagination), focus ring, primary button fill (`--color-accent-fill`) |
| CRITICAL chip | `--color-danger` `#a32b2b` | `#e08b8b` | bg `color-mix(danger 10%, transparent)`, border 35%, 6px dot |
| WARNING chip | text `--color-warning` `#7a5600`, dot `--color-signal` `#d99a0b` | `#d9b45c` / `#d99a0b` | bg `color-mix(signal 18%, transparent)`, border 50% |
| RESOLVED chip | `--color-text-secondary` `#46544c` | `#b9c3bd` | bg `color-mix(text-secondary 9%, transparent)`, border 35% — neutral, never green |
| Acknowledged marker / info | `--color-info` `#2c5d82` | `#7fb1d3` | bg 10%, border 35% |
| Channel OK | `--color-success` `#14503b` | `#5db28d` | «настроен» state only |
| Channel not configured / delivery failed | warning tokens / danger tokens | same | Non-green honesty per D-01 |
| Destructive | `--color-danger` | `#e08b8b` | **No destructive actions exist in this phase** — danger is used only as CRITICAL severity semantics, never as a button fill |

Accent reserved for: pagination links, visible focus rings, and the existing page-level primary buttons («Обновить операционные данные», «Повторить попытку»). Accent is **not** used for severity, for alert rows, or for the acknowledge action (that uses the default bordered button style). Severity is never color-only: the chip always contains its Russian text label.

---

## Block Placement and Anatomy

**Scope lock (D-06):** exactly one new block on the existing `/internal/operations` page. No new routes, no nav destinations, no dedicated alerts sub-page (deferred), no threshold-configuration UI (deferred).

### Placement

«Алерты» is the **first block after the page header**, before «Готовность системы». *Default (agent decision):* D-06 fixes the block's existence, not its position; proactive degradation signals are the reason the operator opens this page, so severity-sorted active alerts get top billing. Existing blocks keep their current order.

### Block structure

```
<section> Block "Алерты"                      ← page.tsx <Block> wrapper
  ├─ Channel line (14px): «Канал доставки: …»   ← D-01 honesty, see Copywriting
  ├─ «Активные» group
  │    └─ <ul> of <li> alert rows              ← severity desc (CRITICAL > WARNING), then lastSeen desc
  ├─ «Решённые за 7 дней» group                ← heading via <strong>/p, 32px gap above
  │    └─ <ul> of <li> rows                    ← lastSeen desc; window = last 7 days
  └─ <nav aria-label="Страницы алертов">        ← only when pages > 1; failures pattern
```

### Alert row anatomy (D-06 field list is exhaustive)

Each `<li>` renders, in order:

1. **Severity chip** — 12px/600 pill with 6px dot; `Критично` / `Предупреждение`.
2. **Status text** — `Активен` or `Решён` (14px, not color-only), plus `Подтверждён · {localized time}` info marker when acknowledged.
3. **Row title** — `<strong>` 16/600: Russian signal label · English signal code (e.g. `Исчерпание квоты провайдера · PROVIDER_QUOTA`). Unknown code → render raw code only (never a blank).
4. **`dl` metadata** (14px): Область (scope, English technical identifier, `Нет` when absent) · Появился (`firstSeen`) · Последний раз (`lastSeen`) · Повторений (`count`, tabular) · Решён (`resolvedAt`, resolved rows only).
5. **Correlation IDs** — each via `CopyCorrelation`; empty list renders `Нет`. IDs wrap, never ellipsize.
6. **Action** — `Подтвердить` button on OPEN rows only (resolved rows show no action); already-acknowledged rows show the marker instead of the button.

Rows are single-column (the page grid is one column at every width); no tables, no charts. Transition history is **not** rendered in this phase (data exists per ALRT-02, but D-06 fixes the row list; it ships with the deferred history sub-page).

### Interactions

- **Refresh:** inherited — the block loads with the page's single overview fetch and refreshes only via «Обновить операционные данные». No polling, no live announcements of unchanged state.
- **Acknowledge:** non-destructive (D-04). `POST` to the internal operations API behind the existing `OperatorGuard` + gateway/HMAC chain (exact path is the planner's; it must live under `/internal-api/operations/*` so `isProtectedPath` covers it — zero new auth surface). Client disables the button while pending (`Подтверждение…`), sends once, and the server converges idempotently. On success the button is replaced by the `Подтверждён · {time}` marker, focus moves to that marker (`tabIndex={-1}`) so keyboard focus is never dropped to `<body>`, and one polite `role="status"` announcement fires. On failure the row keeps its button (re-enabled), shows `role="alert"` copy, and no state changed. Acknowledge never closes, deletes, resolves, or re-sorts the alert and never resets `count`/`lastSeen`.
- **Pagination:** the failures pattern verbatim — `<nav aria-label="Страницы алертов">` of links plus «Показано {start}–{end} из {total}», 25 items per page. *Default (agent decision):* alerts use their own `alertPage` URL parameter instead of the shared `page`, because `page` is already owned by the failures block in the same query string; both blocks must paginate independently without clobbering each other.
- **Copy correlation:** existing `CopyCorrelation` behavior — clipboard write, polite `Корреляционный ID скопирован` status span.

---

## Copywriting Contract

All copy is Russian and exact. No certainty/urgency language; no betting vocabulary.

| Element | Exact copy |
|---------|------------|
| Block title | `Алерты` |
| Primary CTA (row action) | `Подтвердить` — accessible name `Подтвердить алерт {signal label}` |
| Acknowledge pending | `Подтверждение…` (button disabled) |
| Acknowledge success (role=status) | `Алерт подтверждён. Запись остаётся активной; повторные уведомления подавлены.` |
| Acknowledge failure (role=alert) | `Не удалось подтвердить алерт: операции недоступны. Запись не изменилась, попробуйте позже.` |
| Empty state (active, block-level) | Heading-ish line: `Активных алертов нет`; body: `Сигналы деградации не обнаружены за последние 7 дней. Проверка выполняется автоматически.` |
| Empty state (resolved group) | `Решённых алертов за последние 7 дней нет.` |
| Error state (block load, inherited) | `Этот операционный блок недоступен. Ранее показанные безопасные сведения остаются без изменений.` + button `Повторить попытку` |
| Loading (inherited from `Block`) | `Загрузка: алерты…` with `aria-busy` on the section |
| Pagination | `Показано {start}–{end} из {total}`; nav label `Страницы алертов` |
| Channel line — unconfigured | `Канал доставки: не настроен — алерты сохраняются в базе, в вебхук не отправляются.` (warning tokens, non-green) |
| Channel line — configured | `Канал доставки: вебхук настроен.` (success tokens) |
| Channel line — delivery failing | `Канал доставки: вебхук настроен, последняя доставка не удалась ({HTTP status или ограниченный код ошибки}).` (danger tokens) |
| Severity labels | `CRITICAL` → `Критично`; `WARNING` → `Предупреждение` |
| Lifecycle labels | `OPEN` → `Активен`; `RESOLVED` → `Решён`; acknowledged → `Подтверждён` |
| Signal labels (closed set; unknown code renders raw) | `PROVIDER_QUOTA` → `Исчерпание квоты провайдера`; `PROVIDER_CIRCUIT` → `Предохранитель провайдера`; `SYNC_RUN` → `Сбой синхронизации`; `WORKER_JOBS` → `Групповые сбои задач и мёртвые письма`; `HTTP_5XX` → `Всплеск ошибок 5xx`; `BACKUP_STALENESS` → `Устаревание резервных копий`; `DELIVERY_HEALTH` → `Сбой доставки алертов` |
| Count / pluralization | Russian plural helper: `1 алерт`, `2–4 алерта`, `5+ алертов` for any count copy; numeric fields use tabular numerals |
| Destructive confirmation | **None.** This phase has no destructive actions — `Подтвердить` never closes or deletes a record (D-04), so no confirmation dialog exists. Any future delete/resolve action must return here first. |

---

## Accessibility and Interaction Contract

- Inherit the Phase 6/8 contract: landmarks and one `h1`; Block renders `h2`; no skipped heading levels; all controls keyboard-operable; focus follows DOM order.
- `role="alert"` appears only on (a) the block load error and (b) an acknowledge failure. Success and refresh feedback use `role="status"` (polite). Never announce unchanged polling state.
- `aria-busy="true"` on the section while loading; heading and card geometry stay stable (no layout jump).
- Severity, lifecycle, and channel state are text-first; chips carry visible labels; color is supplemental.
- Minimum touch target 44×44px (`button` const); no hover-only affordances; `prefers-reduced-motion` respected (no essential meaning in animation); forced-colors not broken (chips keep a visible border).
- At 320px width and 200% zoom: rows reflow, IDs/scope wrap via `overflow-wrap: anywhere`, no page-level horizontal scroll.
- Redaction (D-07): the DOM carries only typed safe fields — codes, scopes, counts, instants, correlation IDs. No secrets, raw payloads, connection strings, headers, stacks, or logs, ever.

---

## UI Considerations

Applicable state considerations resolved: **8 covered, 3 backstop, 0 unresolved**.

| Category | Element(s) | Status | Resolution / Reason |
|----------|------------|--------|---------------------|
| Empty | Alerts collection, resolved group | ✅ covered | Block renders the exact empty copy above (custom copy inside `children`, `empty` prop stays `false` — same approach as `BackupStatusBlock`); both active-empty and resolved-empty are specified |
| Loading | Alerts block, acknowledge action | ✅ covered | `Block` loading state: stable heading, `aria-busy`, `Загрузка: алерты…`; acknowledge pending disables only its own button with `Подтверждение…` |
| Error | Alerts block load, acknowledge submit | ✅ covered | Block-local error keeps sibling blocks and prior content unchanged with `Повторить попытку`; acknowledge failure is row-local `role="alert"` and changes no state |
| Populated | Active + resolved alert lists | ✅ covered | Active first (severity desc, `lastSeen` desc) then resolved (7-day, `lastSeen` desc); row anatomy and channel line as specified above |
| Partial | Rows with missing correlation IDs, scope, `resolvedAt` | ✅ covered | Absent values render `Нет` explicitly (`resolvedAt` row omitted on active alerts); no field is invented, defaulted to zero, or hidden |
| Overflow | Long signal codes, scopes, correlation IDs, pagination | ✅ covered | `card` sets `overflowWrap: anywhere`; IDs wrap (never ellipsize); nav links wrap; page itself never scrolls horizontally |
| Zero / one / many | Alert rows, pages | ✅ covered | 0 → empty copy; counts use the Russian plural helper; pagination after 25 items with `Показано …` |
| Long text | Signal label + code, channel line, error copy | ✅ covered | Prose wraps; codes render beside labels; no essential content truncated |
| Secret absence | Alert DTO → JSON → DOM | 🧪 backstop | Planted-secret test: seed canary secrets/raw payloads, fetch the overview, recursively assert they never appear in JSON or rendered DOM (D-07, mirrors Phase-8 T-08-13) |
| Acknowledge semantics | Row action lifecycle | 🧪 backstop | UI test: after `Подтвердить` the row still exists, status stays `Активен`, `count`/`lastSeen` unchanged, marker shows — proof it never closes/deletes (D-04) |
| Ordering and dedup | List rendering | 🧪 backstop | Test asserts CRITICAL-before-WARNING, `lastSeen` desc within severity, resolved strictly after active, and one row per dedup fingerprint (D-05/D-06) |

---

## Testable UI State Matrix

| Surface | Required states and assertions |
|---------|--------------------------------|
| Алерты block | Loading; active-empty; resolved-empty; both-empty; populated with mixed severities; block error + retry; sibling blocks unchanged on error |
| Acknowledge | Button → pending (`Подтверждение…`, disabled) → success (marker + `role="status"`, focus on marker) → failure (`role="alert"`, button restored); idempotent repeat; already-acknowledged row renders marker without button |
| Severity/status rendering | `CRITICAL`/`WARNING` chips with text labels in both themes; `OPEN`/`RESOLVED`; acknowledged marker; unknown signal code renders raw code, never blank |
| Channel line | Not configured (non-green), configured (green), delivery failed with bounded status (red) — absence never looks green |
| Pagination | >25 alerts paginate via `alertPage` links without disturbing the failures `page` parameter; `Показано …` copy; nav accessible name |
| Redaction | Canary secret test (backstop above); correlation IDs copyable with polite announcement |
| Responsive/a11y | 320px reflow, 200% zoom, keyboard-only acknowledge, focus restore, `aria-busy`, contrast of every chip in light and dark |

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| shadcn official | None | Not applicable — shadcn is not initialized (`components.json` absent repo-wide) |
| Third-party registries | None | No registry code permitted by this contract; no vetting required |

---

## Source Traceability

| Source | Decisions used |
|--------|----------------|
| `09-CONTEXT.md` | D-01 (webhook channel honesty in UI), D-03 (two severity tiers), D-04 (acknowledge is non-closing), D-05 (one row per fingerprint), D-06 (one Block, row anatomy, ordering, failures pagination), D-07 (redacted DTOs) — **from CONTEXT.md** |
| `REQUIREMENTS.md` §ALRT-01…04 | Degradation signals, durable records, operations-center view with correlation context, webhook delivery — **from REQUIREMENTS.md** |
| `ROADMAP.md` §Phase 9 | Success criteria 2 (view active + recent with correlation, redacted) and 4 (no alert fatigue) — **from ROADMAP.md** |
| `page.tsx` / `backup-status-block.tsx` / `data-state-notice.tsx` | `Block` states, card/button constants, `CopyCorrelation`, badge `color-mix` pattern, SSR test style — **existing code** |
| `globals.css` | Actual palette, `--space-*`, `--radius-*`, 16px body, h2 1.4rem — **existing code** |

Defaults selected under the delegated «реши все сам» authority (each marked): block position (first after header) — **default**; `alertPage` URL parameter — **default**; severity/status/signal label vocabulary — **default**; acknowledge and empty-state copy — **default**; channel-line states — **default** (rooted in D-01); 25-item page size — **default** (matches failures); typography 12/14/16/22.4px with weights 400/600 — **default** (derived from existing rendered sizes); token-derived chip colors — **default** (derived from `data-state-notice.tsx`). No question was left unanswered; no user interaction was required.

## Checker Sign-Off

- [ ] Dimension 1 Copywriting: PASS
- [ ] Dimension 2 Visuals: PASS
- [ ] Dimension 3 Color: PASS
- [ ] Dimension 4 Typography: PASS
- [ ] Dimension 5 Spacing: PASS
- [ ] Dimension 6 Registry Safety: PASS
- [ ] Dimension 7 Inventory Provenance: PASS

**Approval:** pending
