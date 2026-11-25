import { RiskDisclosure } from "../../components/risk-disclosure";
import { ScannerAvailable, StateChip } from "./scanner-rows";
import {
  CHECKED_COUNT_LABEL, EMPTY_CHIP, EMPTY_HEADING, EMPTY_OUTCOMES_LEGEND, EMPTY_TEXT, EMPTY_ZERO_RECEIPTS_LINK, EMPTY_ZERO_RECEIPTS_TEXT, HOW_TO_READ_SUMMARY,
  POLICY_PLAQUE_HREF, POLICY_PLAQUE_LABEL, POLICY_PLAQUE_LINK, POLICY_PLAQUE_TEXT, SCANNER_ORDERING_NOTICE, SCANNER_SCOPE_LINE, SCANNER_TITLE, SCANNER_TOP_LINE,
  UNAVAILABLE_CHIP, UNAVAILABLE_HEADING, UNAVAILABLE_HINT, UNAVAILABLE_LINK, UNAVAILABLE_TEXT, howToReadBullets, outcomeTileOrder, valueOutcomeLabel,
} from "./scanner-labels";
import type { ScannerPayload } from "./scanner-types";

/* Presentational server components: plain anchors only, no client script, no loading or skeleton markup. */

function HowToRead({ data }: { data: ScannerPayload }) {
  return (
    <details className="well">
      <summary>{HOW_TO_READ_SUMMARY}</summary>
      <ul>
        {howToReadBullets(data.freshnessPolicy).map((bullet, index) => (
          <li key={index}>
            {typeof bullet === "string" ? bullet : (
              <>
                {bullet.before}
                <code>{bullet.code}</code>
                {bullet.after}
              </>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}

function PolicyPlaque() {
  return (
    <aside aria-label={POLICY_PLAQUE_LABEL} className="state-notice tone-info">
      <div className="state-notice-head">
        <span className="state-dot state-dot--lg" />
        <strong className="state-notice-title">{POLICY_PLAQUE_LABEL}</strong>
      </div>
      <p className="state-notice-text">{POLICY_PLAQUE_TEXT}</p>
      <p><a href={POLICY_PLAQUE_HREF}>{POLICY_PLAQUE_LINK}</a></p>
    </aside>
  );
}

function ScannerEmpty({ data }: { data: ScannerPayload }) {
  const noReceipts = data.checkedCount === 0;
  return (
    <section aria-labelledby="scanner-empty-heading">
      <h2 id="scanner-empty-heading">{EMPTY_HEADING}</h2>
      <p><StateChip tone="neutral">{EMPTY_CHIP}</StateChip></p>
      <p>{EMPTY_TEXT}</p>
      <dl className="scanner-counts">
        <div>
          <dt>{CHECKED_COUNT_LABEL}</dt>
          <dd>{data.checkedCount}</dd>
        </div>
        {noReceipts ? null : outcomeTileOrder(data.outcomeCounts).map((code) => (
          <div key={code}>
            <dt>{valueOutcomeLabel(code)}</dt>
            <dd>{data.outcomeCounts[code]}</dd>
          </div>
        ))}
      </dl>
      {noReceipts ? (
        <>
          <p>{EMPTY_ZERO_RECEIPTS_TEXT}</p>
          <p>
            {/* Plain anchor by contract (15-03): the scanner page ships no router link, so no prefetch and no client code. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/fixtures">{EMPTY_ZERO_RECEIPTS_LINK}</a>
          </p>
        </>
      ) : (
        <p className="market-legend">{EMPTY_OUTCOMES_LEGEND}</p>
      )}
      {data.allPolicyConfigMismatch ? <PolicyPlaque /> : null}
    </section>
  );
}

function ScannerUnavailable() {
  return (
    <section aria-labelledby="scanner-unavailable-heading">
      <div className="state-notice tone-warning" role="alert">
        <h2 id="scanner-unavailable-heading">{UNAVAILABLE_HEADING}</h2>
        <p><StateChip tone="warning">{UNAVAILABLE_CHIP}</StateChip></p>
        <p>{UNAVAILABLE_TEXT}</p>
        <p>{UNAVAILABLE_HINT}</p>
        <a className="btn-secondary btn-compact" href="/scanner">{UNAVAILABLE_LINK}</a>
      </div>
    </section>
  );
}

/** `data` is the parsed payload, or null when the read failed or the payload was not recognised (fail closed). */
export function ScannerView({ data }: { data: ScannerPayload | null }) {
  return (
    <div className="page-stack">
      <header className="page-head">
        <h1 className="page-title">{SCANNER_TITLE}</h1>
        <p className="page-deck">{SCANNER_TOP_LINE}</p>
        <p className="page-deck">{SCANNER_SCOPE_LINE}</p>
      </header>
      <RiskDisclosure />
      {data === null ? <ScannerUnavailable /> : (
        <>
          <p className="note-strip">{SCANNER_ORDERING_NOTICE}</p>
          <HowToRead data={data} />
          {data.state === "AVAILABLE" ? <ScannerAvailable data={data} /> : <ScannerEmpty data={data} />}
        </>
      )}
    </div>
  );
}
