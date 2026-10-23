"use client";

import { backupStateLabel, offsiteStateLabel } from "../../../components/enum-labels";
import { formatInstant } from "../../../components/time-format";

/**
 * Read-time backup/restore-verification fact produced by the API `backups()`
 * projection (BAK-03): five states, basenames only, never a directory path.
 */
export type BackupStatusFact = {
  configured: boolean;
  state: "NOT_CONFIGURED" | "NEVER_VERIFIED" | "STALE" | "FAILED" | "HEALTHY";
  lastBackup: { fileName: string; byteSize: number | null; sha256: string | null; durationMs: number; completedAt: string; status: string; offsiteStatus: string } | null;
  backupStale: boolean;
  lastDrill: { overall: string; completedAt: string; restoreDurationMs: number; containerCleanup: string; failedChecks: string[] } | null;
  drillStale: boolean;
  retentionCount: number;
  drillIntervalHours: number;
};

// Co-located mirrors of the operations page card/button constants — page.tsx
// cannot be imported here without a cycle, and the plan forbids restyling.
const card = { border: "1px solid var(--color-border)", borderRadius: 4, background: "var(--color-surface)", padding: 20, overflowWrap: "anywhere" } as const;
const button = { minHeight: 44, padding: "8px 14px" } as const;

const DRILL_OVERALL_LABELS: Record<string, string> = { VERIFIED: "Пройдена", FAILED: "Сбой", UNVERIFIED: "Не подтверждена" };
const CONTAINER_CLEANUP_LABELS: Record<string, string> = { REMOVED: "Контейнер удалён", RETAINED: "Контейнер оставлен" };

function drillOverallLabel(overall: string): string { return DRILL_OVERALL_LABELS[overall] ?? overall; }
function containerCleanupLabel(value: string): string { return CONTAINER_CLEANUP_LABELS[value] ?? value; }
function fileSize(bytes: number | null): string { return bytes === null ? "Недоступно" : `${(bytes / (1024 * 1024)).toFixed(2)} МБ`; }
function duration(ms: number): string { return `${(ms / 1000).toFixed(1)} с`; }

export function BackupStatusBlock({ backups, pending, notice, noticeFailed, onBackup, onDrill }: {
  backups: BackupStatusFact;
  pending: "backup" | "drill" | null;
  notice: string | null;
  noticeFailed: boolean;
  onBackup(): void;
  onDrill(): void;
}) {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const date = (value: string | null): string => (value ? formatInstant(value, zone) : "Недоступно");
  return <article style={card} data-testid="backup-status" data-state={backups.state}>
    <p>Общее состояние: <strong>{backupStateLabel(backups.state)}</strong></p>
    <dl>
      <dt>Последняя резервная копия</dt>
      <dd>{backups.lastBackup
        ? <><time dateTime={backups.lastBackup.completedAt}>{date(backups.lastBackup.completedAt)}</time> · {backups.lastBackup.fileName} · размер {fileSize(backups.lastBackup.byteSize)} · {duration(backups.lastBackup.durationMs)} · {backups.lastBackup.status}</>
        : "Никогда"}</dd>
      <dt>Хранение вне сервера</dt>
      <dd>{offsiteStateLabel(backups.lastBackup?.offsiteStatus ?? "NOT_CONFIGURED")}</dd>
      <dt>Возраст резервной копии</dt>
      <dd>{backups.backupStale ? "Устарело (дольше суточного интервала с учётом допуска)" : "В норме"}</dd>
      <dt>Последняя проверка восстановления</dt>
      <dd>{backups.lastDrill
        ? <><time dateTime={backups.lastDrill.completedAt}>{date(backups.lastDrill.completedAt)}</time> · {drillOverallLabel(backups.lastDrill.overall)} · восстановление {duration(backups.lastDrill.restoreDurationMs)} · {containerCleanupLabel(backups.lastDrill.containerCleanup)}</>
        : "Никогда не выполнялась"}</dd>
      <dt>Давность проверки восстановления</dt>
      <dd>{backups.drillStale ? `Устарело (дольше интервала ${backups.drillIntervalHours} ч с учётом суточного допуска)` : "В норме"}</dd>
      <dt>Непрошедшие проверки</dt>
      <dd>{backups.lastDrill && backups.lastDrill.failedChecks.length > 0
        ? <ul>{backups.lastDrill.failedChecks.map((check) => <li key={check}>{check}</li>)}</ul>
        : "Нет"}</dd>
      <dt>Хранится резервных копий</dt>
      <dd>{backups.retentionCount}</dd>
    </dl>
    <p><button style={button} disabled={pending !== null} onClick={onBackup}>Создать резервную копию сейчас</button></p>
    <p><button style={button} disabled={pending !== null} onClick={onDrill}>Запустить проверку восстановления сейчас</button></p>
    <p role={noticeFailed ? "alert" : "status"}>{pending === "backup"
      ? "Резервная копия поставлена в очередь…"
      : pending === "drill"
        ? "Проверка восстановления поставлена в очередь…"
        : notice ?? ""}</p>
  </article>;
}
