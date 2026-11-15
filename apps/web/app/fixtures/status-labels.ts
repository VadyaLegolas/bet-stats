export const STATUS_LABELS: Record<string, string> = {
  SCHEDULED: "запланирован",
  TIMED: "назначен",
  LIVE: "в игре",
  IN_PLAY: "в игре",
  PAUSED: "перерыв",
  FINISHED: "завершён",
  SUSPENDED: "приостановлен",
  POSTPONED: "перенесён",
  CANCELLED: "отменён",
  AWARDED: "присвоен",
};

/** Статусы, означающие, что матч уже идёт — такие карточки остаются на странице
 * с красным значком LIVE и убираются только после завершения матча. */
export const LIVE_STATUSES = new Set(["LIVE", "IN_PLAY", "PAUSED"]);

export const isLiveStatus = (status: string): boolean => LIVE_STATUSES.has(status);

export const statusLabel = (status: string): string => STATUS_LABELS[status] ?? status.toLowerCase();
