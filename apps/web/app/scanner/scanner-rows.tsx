import type { ReactNode } from "react";

import { oddsMarketLabel, selectionLabelFor } from "../../components/enum-labels";
import { formatAge, formatCapturedWarsaw, formatKickoffWarsaw } from "../../components/time-format";
import {
  ALL_STALE_LINE, ASIAN_HANDICAP_EDGE_DEFINITION_ID, ASIAN_HANDICAP_EDGE_NOTE, DETAIL_SUMMARY, FACT_LABELS, FACT_UNITS, FAIR_ODDS_UNAVAILABLE,
  FORECAST_UPDATED_CHIP, FORECAST_UPDATED_NOTE, FRESHNESS_LABELS, LIST_HEADING, MATCH_LINK_TEXT, MISSING_VALUE, ODDS_ENTERED_PREFIX, RECEIPT_LINK_TEXT,
  TRUNCATION_CHIP, isAsianHandicapMarket, matchLinkSuffix, receiptLinkSuffix, sourceLine, staleHeading, staleLead, staleSummary, summaryCountsText, truncationText,
} from "./scanner-labels";
import type { ScannerItem, ScannerPayload } from "./scanner-types";

/* Server components only: no client directive, no router link, no sorting call, no raw markup injection.
   Stored receipt strings are rendered as they are stored, each as the only child of its dd. */

type Tone = "neutral" | "warning" | "info";

/** Text chip: the state is always carried by the label, the dot only repeats the tone. */
export function StateChip({ tone, children }: { tone: Tone; children: string }) {
  return (
    <span className={`state-chip state-chip--md tone-${tone}`}>
      <span className="state-dot" />
      {children}
    </span>
  );
}

const CHIP_ROW_STYLE = { display: "flex", flexWrap: "wrap", gap: "var(--space-2)" } as const;

/** Stored value in a dd; a null column is shown as a missing value, never as 0, NaN or a blank. */
const stored = (value: string | null, missing: string = MISSING_VALUE) => value ?? missing;

function Fact({ label, children, sub }: { label: string; children: ReactNode; sub?: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      {children}
      {sub === undefined ? null : <dd className="scanner-sub">{sub}</dd>}
    </div>
  );
}

export function ScannerRow({ item }: { item: ScannerItem }) {
  const marketLabel = oddsMarketLabel(item.market);
  const selectionLabel = selectionLabelFor(item.market, item.selection);
  const fixtureHref = `/fixtures/${encodeURIComponent(item.fixtureId)}`;
  const freshnessTone: Tone = item.freshness === "FRESH" ? "neutral" : "warning";
  const showsKnownEdgeNote = item.edgeDefinition === ASIAN_HANDICAP_EDGE_DEFINITION_ID;
  const showsForeignEdgeDefinition = item.edgeDefinition !== null && !showsKnownEdgeNote;

  return (
    <li className="scanner-row" id={`receipt-${item.receiptId}`} data-freshness={item.freshness}>
      <div className="scanner-pick">
        <span className="market-sub">{marketLabel}</span>
        <p>{selectionLabel}</p>
        <div style={CHIP_ROW_STYLE}>
          <StateChip tone={freshnessTone}>{FRESHNESS_LABELS[item.freshness]}</StateChip>
          {item.forecastNewerAvailable ? <StateChip tone="info">{FORECAST_UPDATED_CHIP}</StateChip> : null}
        </div>
      </div>
      <dl className="scanner-facts">
        <Fact label={FACT_LABELS.edge} sub={<span className="market-sub">{FACT_UNITS.edge}</span>}>
          <dd className="scanner-key">{stored(item.edge)}</dd>
        </Fact>
        <Fact label={FACT_LABELS.expectedValue} sub={<span className="market-sub">{FACT_UNITS.expectedValue}</span>}>
          <dd className="scanner-key">{stored(item.expectedValue)}</dd>
        </Fact>
        <Fact
          label={FACT_LABELS.decimalOdds}
          sub={
            <>
              <span className="market-sub">{sourceLine(item.oddsSource)}</span>
              <span className="market-sub">
                {ODDS_ENTERED_PREFIX}
                <time dateTime={item.oddsSubmittedAt}>{formatCapturedWarsaw(item.oddsSubmittedAt)}</time>, {formatAge(item.oddsAgeSeconds)}
              </span>
            </>
          }
        >
          <dd>{stored(item.decimalOdds)}</dd>
        </Fact>
        <Fact
          label={isAsianHandicapMarket(item.market) ? FACT_LABELS.modelProbabilityAsianHandicap : FACT_LABELS.modelProbability}
          sub={<span className="market-sub">{FACT_UNITS.modelProbability}</span>}
        >
          <dd>{stored(item.modelProbability)}</dd>
        </Fact>
      </dl>
      {item.forecastNewerAvailable ? <p className="scanner-note">{FORECAST_UPDATED_NOTE}</p> : null}
      <details className="scanner-detail">
        <summary>{DETAIL_SUMMARY}</summary>
        <dl className="scanner-facts">
          <Fact label={FACT_LABELS.noVigProbability}>
            <dd>{stored(item.noVigProbability)}</dd>
          </Fact>
          <Fact label={FACT_LABELS.fairOdds}>
            <dd>{stored(item.fairOdds, FAIR_ODDS_UNAVAILABLE)}</dd>
          </Fact>
          <Fact label={FACT_LABELS.receipt}>
            <dd><code>{item.receiptId}</code></dd>
          </Fact>
          <Fact label={FACT_LABELS.forecastSnapshot}>
            <dd><code>{item.forecastSnapshotId}</code></dd>
          </Fact>
          <Fact label={FACT_LABELS.policyVersion}>
            <dd>
              {item.valuePolicyVersion === null ? MISSING_VALUE : <code>{item.valuePolicyVersion}</code>}
              {item.evPolicyVersion === null ? null : <> <code>{item.evPolicyVersion}</code></>}
            </dd>
          </Fact>
          {showsForeignEdgeDefinition ? (
            <Fact label={FACT_LABELS.edgeDefinition}>
              <dd><code>{item.edgeDefinition}</code></dd>
            </Fact>
          ) : null}
        </dl>
        {showsKnownEdgeNote ? <p className="scanner-note">{ASIAN_HANDICAP_EDGE_NOTE}</p> : null}
      </details>
      <p className="scanner-links">
        <a href={fixtureHref}>
          {MATCH_LINK_TEXT}
          <span className="sr-only">{matchLinkSuffix(item.homeTeam, item.awayTeam, marketLabel, selectionLabel)}</span>
        </a>
        <a href={`/internal-api/value/${encodeURIComponent(item.receiptId)}`} target="_blank" rel="noopener noreferrer">
          {RECEIPT_LINK_TEXT}
          <span className="sr-only">{receiptLinkSuffix(marketLabel, selectionLabel)}</span>
        </a>
      </p>
    </li>
  );
}

/** Match groups: consecutive equal fixtureId in the order received. Nothing is sorted, ranked or re-grouped. */
function groupByFixture(items: readonly ScannerItem[]): readonly (readonly ScannerItem[])[] {
  const groups: ScannerItem[][] = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (last && last[0]?.fixtureId === item.fixtureId) last.push(item);
    else groups.push([item]);
  }
  return groups;
}

function MatchGroups({ items }: { items: readonly ScannerItem[] }) {
  return (
    <ol className="scanner-groups">
      {groupByFixture(items).map((group) => {
        const first = group[0]!;
        return (
          <li className="panel scanner-match" key={`${first.fixtureId}-${first.receiptId}`}>
            <div className="scanner-match-head">
              <h3>
                <a href={`/fixtures/${encodeURIComponent(first.fixtureId)}`}>{`${first.homeTeam} — ${first.awayTeam}`}</a>
              </h3>
              <p className="scanner-match-meta">
                {`${first.competition} · `}
                <time dateTime={first.kickoffAt}>{formatKickoffWarsaw(first.kickoffAt)}</time>
              </p>
            </div>
            <ul className="scanner-rows">
              {group.map((item) => <ScannerRow item={item} key={item.receiptId} />)}
            </ul>
          </li>
        );
      })}
    </ol>
  );
}

export function ScannerAvailable({ data }: { data: ScannerPayload }) {
  // Stable filters on freshness: placement changes, order and values do not.
  const mainItems = data.items.filter((item) => item.freshness !== "STALE");
  const staleItems = data.items.filter((item) => item.freshness === "STALE");
  const matchCount = new Set(data.items.map((item) => item.fixtureId)).size;

  return (
    <>
      <section aria-labelledby="scanner-list-heading">
        <h2 id="scanner-list-heading">{LIST_HEADING}</h2>
        <p className="market-legend">
          {summaryCountsText(data.items.length, matchCount)}
          <time dateTime={data.generatedAt}>{formatCapturedWarsaw(data.generatedAt)}</time>.
        </p>
        {data.truncated ? (
          <p className="note-strip">
            <StateChip tone="warning">{TRUNCATION_CHIP}</StateChip> {truncationText(data.items.length, data.totalCandidates, data.limit)}
          </p>
        ) : null}
        {mainItems.length > 0 ? <MatchGroups items={mainItems} /> : <p>{ALL_STALE_LINE}</p>}
      </section>
      {staleItems.length > 0 ? (
        <section aria-labelledby="scanner-stale-heading">
          <h2 id="scanner-stale-heading">{staleHeading(staleItems.length)}</h2>
          <p>{staleLead(data.freshnessPolicy.agingMaxHours)}</p>
          <details className="scanner-stale" open={mainItems.length === 0}>
            <summary>{staleSummary(staleItems.length)}</summary>
            <MatchGroups items={staleItems} />
          </details>
        </section>
      ) : null}
    </>
  );
}
