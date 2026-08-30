type EvidenceStateNoticeProps = Readonly<{
  state?: string;
  freshness?: string;
  limitationReason?: string | null;
}>;

export function EvidenceStateNotice({ state, freshness, limitationReason }: EvidenceStateNoticeProps) {
  if (state === "PENDING") {
    return <p role="status">Evidence is being rebuilt for this cutoff. Partial calculations are not published.</p>;
  }
  if (state === "UNAVAILABLE") {
    return <p role="alert">Historical evidence could not be loaded for this cutoff. No newer data was substituted. Try again.</p>;
  }
  return (
    <div aria-label="Evidence status">
      {freshness === "STALE" && <p>Historical evidence is stale for this cutoff. Source times remain visible below.</p>}
      {limitationReason && <p>{limitationReason}</p>}
    </div>
  );
}
