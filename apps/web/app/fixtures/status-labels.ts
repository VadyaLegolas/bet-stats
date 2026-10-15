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

export const statusLabel = (status: string): string => STATUS_LABELS[status] ?? status.toLowerCase();
