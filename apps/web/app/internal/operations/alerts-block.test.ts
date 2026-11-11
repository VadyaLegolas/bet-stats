import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vitest";

import { alertPlural, AlertsBlock } from "./alerts-block";
import type { AlertRow, AlertsBlockFact } from "./alerts-block";

const row = (overrides: Partial<AlertRow> = {}): AlertRow => ({
  id: "alert-1",
  signal: "PROVIDER_QUOTA",
  scope: "api-football:fixtures",
  severity: "CRITICAL",
  status: "OPEN",
  count: 3,
  firstSeen: "2026-11-11T05:00:00.000Z",
  lastSeen: "2026-11-11T06:30:00.000Z",
  acknowledgedAt: null,
  resolvedAt: null,
  correlationIds: ["corr-abc"],
  ...overrides,
});

const fact = (overrides: Partial<AlertsBlockFact> = {}): AlertsBlockFact => ({
  alerts: [row()],
  channel: { configured: false, lastDeliveryStatus: null, lastDeliveryAt: null },
  ...overrides,
});

function render(fact: AlertsBlockFact, page = 1): string {
  return renderToStaticMarkup(createElement(AlertsBlock, { fact, page }));
}

describe("AlertsBlock empty states", () => {
  it("renders both empty messages when there are no alerts at all", () => {
    const markup = render(fact({ alerts: [] }));
    expect(markup).toContain("Активных алертов нет");
    expect(markup).toContain("Сигналы деградации не обнаружены за последние 7 дней. Проверка выполняется автоматически.");
    expect(markup).toContain("Решённых алертов за последние 7 дней нет.");
  });

  it("renders the resolved-empty copy while active alerts are shown", () => {
    const markup = render(fact());
    expect(markup).toContain("Активные");
    expect(markup).toContain("Решённых алертов за последние 7 дней нет.");
    expect(markup).not.toContain("Активных алертов нет");
  });

  it("marks the block state active vs clear via data-state", () => {
    expect(render(fact())).toContain('data-state="active"');
    expect(render(fact({ alerts: [] }))).toMatch(/data-testid="alerts-block" data-state="clear"/);
  });
});

describe("AlertsBlock ordering and dedup", () => {
  it("renders CRITICAL before WARNING even when the WARNING row was seen last", () => {
    const markup = render(fact({ alerts: [
      row({ id: "w", signal: "SYNC_RUN", scope: "warning-scope", severity: "WARNING", lastSeen: "2026-11-11T07:00:00.000Z" }),
      row({ id: "c", signal: "HTTP_5XX", scope: "critical-scope", severity: "CRITICAL", lastSeen: "2026-11-11T06:00:00.000Z" }),
    ] }));
    expect(markup.indexOf("critical-scope")).toBeGreaterThan(-1);
    expect(markup.indexOf("warning-scope")).toBeGreaterThan(-1);
    expect(markup.indexOf("Критично")).toBeLessThan(markup.indexOf("Предупреждение"));
    expect(markup.indexOf("critical-scope")).toBeLessThan(markup.indexOf("warning-scope"));
  });

  it("renders resolved rows strictly after active rows", () => {
    const markup = render(fact({ alerts: [
      row({ id: "r", signal: "SYNC_RUN", scope: "resolved-scope", status: "RESOLVED", resolvedAt: "2026-11-11T04:00:00.000Z", lastSeen: "2026-11-11T04:00:00.000Z" }),
      row({ id: "a", signal: "HTTP_5XX", scope: "active-scope", severity: "WARNING" }),
    ] }));
    expect(markup.indexOf("Активные")).toBeLessThan(markup.indexOf("Решённые за 7 дней"));
    expect(markup.indexOf("active-scope")).toBeLessThan(markup.indexOf("resolved-scope"));
  });

  it("renders one row per dedup fingerprint (signal + scope)", () => {
    const markup = render(fact({ alerts: [
      row({ id: "first" }),
      row({ id: "second", lastSeen: "2026-11-11T07:00:00.000Z" }),
    ] }));
    expect(markup.split('data-testid="alert-row"').length - 1).toBe(1);
    // The duplicate's scope would render a second Область dd — exactly one row's worth of content.
    expect(markup.split("api-football:fixtures").length - 1).toBe(1);
  });

  it("orders resolved rows by lastSeen descending within the resolved group", () => {
    const markup = render(fact({ alerts: [
      row({ id: "old", signal: "SYNC_RUN", scope: "resolved-old", status: "RESOLVED", resolvedAt: "2026-11-10T04:00:00.000Z", lastSeen: "2026-11-10T04:00:00.000Z" }),
      row({ id: "new", signal: "HTTP_5XX", scope: "resolved-new", status: "RESOLVED", resolvedAt: "2026-11-11T04:00:00.000Z", lastSeen: "2026-11-11T04:00:00.000Z" }),
    ] }));
    expect(markup.indexOf("resolved-new")).toBeLessThan(markup.indexOf("resolved-old"));
  });
});

describe("AlertsBlock Russian labels", () => {
  it.each([
    ["CRITICAL", "Критично"],
    ["WARNING", "Предупреждение"],
  ] as const)("renders the Russian severity label for %s", (severity, label) => {
    expect(render(fact({ alerts: [row({ severity })] }))).toContain(label);
  });

  it.each([
    ["OPEN", "Активен"],
    ["RESOLVED", "Решён"],
  ] as const)("renders the Russian lifecycle label for %s", (status, label) => {
    expect(render(fact({ alerts: [row({ status })] }))).toContain(label);
  });

  it.each([
    ["PROVIDER_QUOTA", "Исчерпание квоты провайдера"],
    ["PROVIDER_CIRCUIT", "Предохранитель провайдера"],
    ["SYNC_RUN", "Сбой синхронизации"],
    ["WORKER_JOBS", "Групповые сбои задач и мёртвые письма"],
    ["HTTP_5XX", "Всплеск ошибок 5xx"],
    ["BACKUP_STALENESS", "Устаревание резервных копий"],
    ["DELIVERY_HEALTH", "Сбой доставки алертов"],
  ] as const)("renders the Russian signal label for %s beside the English code", (signal, label) => {
    const markup = render(fact({ alerts: [row({ signal })] }));
    expect(markup).toContain(label);
    expect(markup).toContain(signal);
  });

  it("renders an unknown signal code as the raw code, never blank", () => {
    const markup = render(fact({ alerts: [row({ signal: "MYSTERY_SIGNAL" })] }));
    expect(markup).toContain("MYSTERY_SIGNAL");
    expect(markup).toContain("<strong>MYSTERY_SIGNAL</strong>");
  });
});

describe("AlertsBlock partial data", () => {
  it("renders «Нет» for missing correlation IDs and missing scope", () => {
    const markup = render(fact({ alerts: [row({ correlationIds: [], scope: "" })] }));
    expect(markup).toContain("Корреляционные ID:");
    expect(markup).toContain("Нет");
  });

  it("omits the Решён metadata row on active alerts and renders it on resolved ones", () => {
    expect(render(fact())).not.toContain("<dt>Решён</dt>");
    expect(render(fact({ alerts: [row({ status: "RESOLVED", resolvedAt: "2026-11-11T04:00:00.000Z" })] }))).toContain("<dt>Решён</dt>");
  });
});

describe("AlertsBlock channel honesty", () => {
  it("renders the unconfigured channel as non-green warning copy", () => {
    const markup = render(fact({ channel: { configured: false, lastDeliveryStatus: null, lastDeliveryAt: null } }));
    expect(markup).toContain("Канал доставки: не настроен — алерты сохраняются в базе, в вебхук не отправляются.");
    expect(markup).toContain("var(--color-warning)");
    expect(markup).not.toContain("var(--color-success)");
    expect(markup).toMatch(/data-state="unconfigured"/);
  });

  it("renders the configured channel with success tokens", () => {
    const markup = render(fact({ channel: { configured: true, lastDeliveryStatus: 204, lastDeliveryAt: "2026-11-11T06:00:00.000Z" } }));
    expect(markup).toContain("Канал доставки: вебхук настроен.");
    expect(markup).toContain("var(--color-success)");
    expect(markup).toMatch(/data-state="ok"/);
  });

  it("renders a failed last delivery with the bounded HTTP status in danger tokens", () => {
    const markup = render(fact({ channel: { configured: true, lastDeliveryStatus: 503, lastDeliveryAt: "2026-11-11T06:00:00.000Z" } }));
    expect(markup).toContain("Канал доставки: вебхук настроен, последняя доставка не удалась (503).");
    expect(markup).toContain("var(--color-danger)");
    expect(markup).not.toContain("var(--color-success)");
    expect(markup).toMatch(/data-state="failed"/);
  });
});

describe("AlertsBlock redaction canary", () => {
  it("never renders secrets, raw payloads or stacks even if upstream attaches unsanitized extra fields", () => {
    const leaky = {
      ...row(),
      payload: "raw-payload-canary",
      authorization: "Bearer secret-token-canary",
      stack: "postgres://connection-string-canary",
      headers: { "x-api-key": "header-secret-canary" },
    } as unknown as AlertRow;
    const markup = render(fact({ alerts: [leaky] }));
    for (const canary of ["secret-token-canary", "raw-payload-canary", "connection-string-canary", "header-secret-canary"]) {
      expect(markup).not.toContain(canary);
    }
  });
});

describe("AlertsBlock acknowledge semantics (D-04)", () => {
  it("renders Подтвердить only on OPEN unacknowledged rows with the Russian accessible name", () => {
    const markup = render(fact());
    expect(markup).toContain("Подтвердить");
    expect(markup).toContain('aria-label="Подтвердить алерт Исчерпание квоты провайдера"');
    expect(render(fact({ alerts: [row({ status: "RESOLVED", resolvedAt: "2026-11-11T04:00:00.000Z" })] }))).not.toContain("Подтвердить");
  });

  it("after acknowledging: the row still exists, status stays Активен, count unchanged, marker shows instead of the button", () => {
    const markup = render(fact({ alerts: [row({ acknowledgedAt: "2026-11-11T07:00:00.000Z" })] }));
    expect(markup.split('data-testid="alert-row"').length - 1).toBe(1);
    expect(markup).toContain("Активен");
    expect(markup).toContain("Подтверждён");
    expect(markup).toContain("<time dateTime=\"2026-11-11T07:00:00.000Z\"");
    expect(markup).not.toContain("Подтвердить алерт");
    expect(markup).not.toContain(">Подтвердить<");
    expect(markup).toContain("<dd style=\"font-variant-numeric:tabular-nums\">3</dd>");
  });
});

describe("AlertsBlock Russian plural helper", () => {
  it.each([
    [1, "1 алерт"],
    [2, "2 алерта"],
    [4, "4 алерта"],
    [5, "5 алертов"],
    [11, "11 алертов"],
    [12, "12 алертов"],
    [14, "14 алертов"],
    [21, "21 алерт"],
    [22, "22 алерта"],
    [25, "25 алертов"],
  ] as const)("pluralizes %i as «%s»", (count, expected) => {
    expect(alertPlural(count)).toBe(expected);
  });

  it("renders the group count line with the plural helper", () => {
    const markup = render(fact({ alerts: [row(), row({ id: "second", signal: "SYNC_RUN", scope: "sync", severity: "WARNING" })] }));
    expect(markup).toContain("Активные</strong><span> · 2 алерта</span>");
  });
});

describe("AlertsBlock pagination", () => {
  it("slices rows per page of 25 via the independent alertPage parameter and shows the range copy", () => {
    const alerts = Array.from({ length: 30 }, (_, index) => row({ id: `alert-${String(index + 1).padStart(2, "0")}`, signal: "SYNC_RUN", scope: `scope-${index + 1}`, severity: "WARNING" }));
    const firstPage = render(fact({ alerts }), 1);
    expect(firstPage).toContain("Показано 1–25 из 30");
    expect(firstPage).toContain('data-testid="alert-row"');
    expect(firstPage.split('data-testid="alert-row"').length - 1).toBe(25);
    expect(firstPage).toContain("alertPage=2");
    const secondPage = render(fact({ alerts }), 2);
    expect(secondPage).toContain("Показано 26–30 из 30");
    expect(secondPage.split('data-testid="alert-row"').length - 1).toBe(5);
    expect(secondPage).toContain("scope-30");
  });
});
