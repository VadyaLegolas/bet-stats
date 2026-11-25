import { parseMarketId } from "@bet-stats/domain";

import { AH_RESULT_LABELS, oddsMarketLabel, selectionLabelFor, valueReasonLabel } from "../../../components/enum-labels";
import { formatSigned, formatSignedPercent, labelReason, percent, readAhBreakdownReceipt, type AhBreakdownReceipt, type ValueResult } from "./workbench-format";

const OUTCOME_COPY = {
  VALUE_CANDIDATE: { heading: "Кандидат value", detail: "Все настроенные проверки доказательств, уверенности, преимущества и ожидаемого value пройдены для этой точной пары снимков." },
  NO_VALUE: { heading: "Нет value-сигнала", detail: "Доказательств достаточно, но ни один из настроенных порогов value-сигнала не пройден. Ниже — какие проверки не прошли." },
  INSUFFICIENT_EVIDENCE: { heading: "Недостаточно доказательств", detail: "Доказательства, уверенность или качество данных не позволили провести квалифицированное сравнение." },
} as const;

const BREAKDOWN_HEADING = "Разбор ожидаемого value по пяти исходам";
const BREAKDOWN_MISSING = "Разбор по пяти исходам недоступен для этой квитанции.";
const PUSH_SENTENCE = "При азиатском гандикапе ставка может быть возвращена (пуш), а на четвертных линиях она делится пополам, поэтому исходом может быть выигрыш или проигрыш половины ставки.";
const ROUNDING_NOTE = "Значения округлены; итог рассчитан по точным числам.";

/** Таблица разбора: вероятности, возвраты и вклады — из записанной квитанции, итог — поле expectedValue квитанции; UI ничего не умножает и не суммирует (D-13). */
function BreakdownTable({ breakdown, expectedValue }: { breakdown: AhBreakdownReceipt; expectedValue: string }) {
  return <>
    <h4>{BREAKDOWN_HEADING}</h4>
    <div className="evidence-table-scroll" role="region" aria-label={BREAKDOWN_HEADING} tabIndex={0}>
      <table className="market-table">
        <caption>Ожидаемое value на 1 единицу ставки · политика {breakdown.policyVersion}</caption>
        <thead><tr><th scope="col">Исход</th><th scope="col">Вероятность</th><th scope="col">Результат на 1 единицу ставки</th><th scope="col">Вклад в ожидаемое value</th></tr></thead>
        <tbody>{breakdown.rows.map((row) => <tr key={row.result}><th scope="row">{AH_RESULT_LABELS[row.result]}</th><td>{percent(row.probability)}</td><td>{formatSigned(row.returnPerUnit)}</td><td>{formatSignedPercent(row.contribution)}</td></tr>)}</tbody>
        <tfoot><tr><th scope="row" colSpan={3}>Итого — ожидаемое value</th><td>{formatSignedPercent(expectedValue)}</td></tr></tfoot>
      </table>
    </div>
  </>;
}

export function ValueOutcomeSection({ result, canonicalReceipt, copyMessage, copyReceipt }: { result: ValueResult; canonicalReceipt: string; copyMessage: string; copyReceipt: () => void | Promise<void> }) {
  const family = parseMarketId(result.market)?.family;
  const isAsianHandicap = family === "ASIAN_HANDICAP";
  const isExtended = isAsianHandicap || family === "EXACT_SCORE";
  const breakdown = isAsianHandicap ? readAhBreakdownReceipt(result.receipt) : null;
  const labels = isAsianHandicap
    ? { model: "Эффективная вероятность выигрыша", noVig: "Вероятность без вига (приближённо)" }
    : { model: "Модельная вероятность", noVig: "Вероятность без перекрытия" };
  return <section className="panel workbench-card outcome-card" aria-labelledby="outcome-heading" role={result.outcome === "INSUFFICIENT_EVIDENCE" ? "alert" : "status"}><h3 id="outcome-heading">{OUTCOME_COPY[result.outcome].heading}</h3><p>{OUTCOME_COPY[result.outcome].detail}</p>{isExtended && <p>Рынок: {oddsMarketLabel(result.market)} · выбор: {selectionLabelFor(result.market, result.selection)}</p>}<p>Снимок прогноза <code>{result.forecastSnapshotId}</code> · Снимок коэффициентов <code>{result.oddsSnapshotId}</code></p><ul>{result.reasons.map((reason) => <li key={reason}>{valueReasonLabel(reason)}</li>)}</ul><dl className="ev-rows"><div><dt>{labels.model}</dt><dd>{percent(result.modelProbability)}</dd></div><div><dt>{labels.noVig}</dt><dd>{percent(result.noVigProbability)}</dd></div><div><dt>Преимущество</dt><dd>{percent(result.edge)}</dd></div><div><dt>Ожидаемое value</dt><dd className={result.outcome === "VALUE_CANDIDATE" ? "value-chip value-chip--positive" : "value-chip"}>{percent(result.expectedValue)}</dd></div></dl>
    {isAsianHandicap && (breakdown ? <BreakdownTable breakdown={breakdown} expectedValue={result.expectedValue} /> : <p className="note-strip">{BREAKDOWN_MISSING}</p>)}
    {isAsianHandicap && <p>{PUSH_SENTENCE}</p>}
    {breakdown && <p className="market-legend">{ROUNDING_NOTE}</p>}
    <details className="well"><summary>Точная неизменяемая квитанция решения</summary><h4>ID и версии квитанции</h4><dl><dt>Квитанция value</dt><dd><code>{result.id}</code></dd><dt>Снимок прогноза</dt><dd><code>{result.forecastSnapshotId}</code></dd><dt>Снимок коэффициентов</dt><dd><code>{result.oddsSnapshotId}</code></dd><dt>Создана</dt><dd><time dateTime={result.createdAt}>{result.createdAt}</time></dd>{Object.entries(result.receipt).filter(([key]) => key.toLowerCase().includes("version") || key === "cutoff").map(([key, value]) => <div key={key}><dt>{labelReason(key)}</dt><dd>{String(value)}</dd></div>)}{breakdown && <div><dt>Политика ожидаемого value</dt><dd>{breakdown.policyVersion}</dd></div>}</dl>
      <h4>Источники, допущения и формулы</h4><pre className="pre-wrap">{JSON.stringify({ sources: result.receipt.sources, evidenceBuildIds: result.receipt.evidenceBuildIds, assumptions: result.receipt.assumptions, formulas: result.receipt.formulas }, null, 2)}</pre>
      <h4>Результаты проверок и пороги</h4><pre className="pre-wrap">{JSON.stringify({ outcome: result.outcome, reasons: result.reasons, thresholds: result.receipt.thresholds, gates: result.receipt.gates }, null, 2)}</pre>
      <h4>Канонический структурированный JSON</h4><pre className="pre-wrap">{canonicalReceipt}</pre><p className="cluster"><button type="button" className="btn-secondary" onClick={() => void copyReceipt()}>Скопировать JSON точной квитанции</button>{" "}<a className="link-touch" href={`/internal-api/value/${encodeURIComponent(result.id)}?download=true`} download>Скачать JSON точной квитанции</a></p><p aria-live="polite">{copyMessage}</p>
    </details></section>;
}
