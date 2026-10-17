import { evidenceLimitationLabel } from "./enum-labels";

type EvidenceStateNoticeProps = Readonly<{
  state?: string | undefined;
  freshness?: string | undefined;
  limitationReason?: string | null | undefined;
}>;

export function EvidenceStateNotice({ state, freshness, limitationReason }: EvidenceStateNoticeProps) {
  if (state === "PENDING") {
    return <p role="status">Доказательства перестраиваются для этой точки отсчёта. Частичные вычисления не публикуются.</p>;
  }
  if (state === "UNAVAILABLE") {
    return <p role="alert">Исторические доказательства не удалось загрузить для этой точки отсчёта. Более новые данные не подставлялись. Попробуйте снова.</p>;
  }
  return (
    <div aria-label="Статус доказательств">
      {freshness === "STALE" && <p>Исторические доказательства неактуальны для этой точки отсчёта. Времена источников остаются видимыми ниже.</p>}
      {limitationReason && <p>{evidenceLimitationLabel(limitationReason)}</p>}
    </div>
  );
}
