import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vitest";

import { BackupStatusBlock, type BackupStatusFact } from "./backup-status-block";

const fact = (overrides: Partial<BackupStatusFact> = {}): BackupStatusFact => ({
  configured: true,
  state: "HEALTHY",
  lastBackup: { fileName: "football_prediction-20261023T100000Z.dump", byteSize: 4_194_304, sha256: "d".repeat(64), durationMs: 3_200, completedAt: "2026-10-23T10:00:00.000Z", status: "SUCCEEDED", offsiteStatus: "COPIED" },
  backupStale: false,
  lastDrill: { overall: "VERIFIED", completedAt: "2026-10-22T12:00:00.000Z", restoreDurationMs: 9_000, containerCleanup: "REMOVED", failedChecks: [] },
  drillStale: false,
  retentionCount: 14,
  drillIntervalHours: 168,
  ...overrides,
});

function render(backups: BackupStatusFact, overrides: Partial<Parameters<typeof BackupStatusBlock>[0]> = {}): string {
  return renderToStaticMarkup(createElement(BackupStatusBlock, { backups, pending: null, notice: null, noticeFailed: false, onBackup: () => {}, onDrill: () => {}, ...overrides }));
}

describe("BackupStatusBlock five-state rendering", () => {
  it.each([
    ["NOT_CONFIGURED", "Не настроено"],
    ["NEVER_VERIFIED", "Никогда не проверялось"],
    ["STALE", "Устарело"],
    ["FAILED", "Сбой"],
    ["HEALTHY", "Здорово"],
  ] as const)("renders the Russian label for state %s", (state, label) => {
    const markup = render(fact({ state, lastBackup: state === "NOT_CONFIGURED" ? null : fact().lastBackup, lastDrill: state === "NEVER_VERIFIED" ? null : fact().lastDrill }));
    expect(markup).toContain(label);
  });

  it.each(["NOT_CONFIGURED", "NEVER_VERIFIED", "STALE", "FAILED"] as const)("never renders green «Здорово» for the non-green state %s", (state) => {
    const markup = render(fact({ state, lastBackup: state === "NOT_CONFIGURED" ? null : fact().lastBackup, lastDrill: state === "NEVER_VERIFIED" ? null : fact().lastDrill }));
    expect(markup).not.toContain("Здорово");
  });

  it("renders never-verified and not-configured drill rows as explicit non-green copy", () => {
    expect(render(fact({ state: "NEVER_VERIFIED", lastDrill: null }))).toContain("Никогда не выполнялась");
    expect(render(fact({ state: "NOT_CONFIGURED", lastBackup: null, lastDrill: null }))).toContain("Не настроено");
  });

  it("renders stale flags non-green even when the last receipt said VERIFIED", () => {
    const markup = render(fact({ state: "STALE", backupStale: true }));
    expect(markup).toContain("Устарело");
    expect(markup).toContain("Возраст резервной копии");
    expect(markup).not.toContain("Здорово");
  });
});

describe("BackupStatusBlock backup and drill details", () => {
  it("renders last backup time via a machine-readable <time>, file name, size and duration", () => {
    const markup = render(fact());
    expect(markup).toContain("<time dateTime=\"2026-10-23T10:00:00.000Z\"");
    expect(markup).toContain("football_prediction-20261023T100000Z.dump");
    expect(markup).toContain("4.00 МБ");
    expect(markup).toContain("3.2 с");
  });

  it("renders the last drill overall and the failed-check list", () => {
    const markup = render(fact({ state: "FAILED", lastDrill: { overall: "FAILED", completedAt: "2026-10-22T12:00:00.000Z", restoreDurationMs: 9_000, containerCleanup: "RETAINED", failedChecks: ["parity.Fixture", "fkOrphans"] } }));
    expect(markup).toContain("Сбой");
    expect(markup).toContain("parity.Fixture");
    expect(markup).toContain("fkOrphans");
    expect(markup).toContain("Контейнер оставлен");
  });

  it("never renders a directory path — fixtures and output carry basenames only", () => {
    const markup = render(fact());
    expect(markup).not.toMatch(/[A-Za-z]:\\\\|\/var\/backups|Users.Vlad/);
  });
});

describe("BackupStatusBlock off-host row", () => {
  it("distinguishes off-host «Не настроено» from «Деградировано»", () => {
    expect(render(fact({ lastBackup: { ...fact().lastBackup!, offsiteStatus: "NOT_CONFIGURED" } }))).toContain("Хранение вне сервера");
    const degraded = render(fact({ lastBackup: { ...fact().lastBackup!, offsiteStatus: "DEGRADED" } }));
    expect(degraded).toContain("Деградировано");
    expect(degraded).not.toContain("Хранение вне сервера</dt><dd>Не настроено");
    const notConfigured = render(fact({ lastBackup: { ...fact().lastBackup!, offsiteStatus: "NOT_CONFIGURED" } }));
    expect(notConfigured).toContain("Не настроено");
    expect(notConfigured).not.toContain("Деградировано");
  });
});

describe("BackupStatusBlock trigger controls", () => {
  it("renders both Russian trigger buttons and role=status feedback while pending", () => {
    const markup = render(fact(), { pending: "backup" });
    expect(markup).toContain("Создать резервную копию сейчас");
    expect(markup).toContain("Запустить проверку восстановления сейчас");
    expect(markup).toContain("Резервная копия поставлена в очередь…");
    expect(markup).toMatch(/<button[^>]*disabled/);
  });

  it("renders drill-pending feedback and clears it back to an empty status line", () => {
    expect(render(fact(), { pending: "drill" })).toContain("Проверка восстановления поставлена в очередь…");
    expect(render(fact(), { pending: null, notice: "Резервная копия поставлена в очередь." })).toContain("Резервная копия поставлена в очередь.");
    expect(render(fact(), { pending: null, notice: null })).toContain("role=\"status\"");
  });

  it("renders a failed trigger notice as role=alert", () => {
    const markup = render(fact(), { pending: null, notice: "Не удалось запустить: резервные копии не настроены.", noticeFailed: true });
    expect(markup).toContain("role=\"alert\"");
    expect(markup).toContain("резервные копии не настроены");
  });
});
