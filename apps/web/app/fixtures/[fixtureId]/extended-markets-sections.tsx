"use client";

import type { ExtendedMarketsView } from "@bet-stats/domain";
import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";

import { ContextualMethodologyWarning } from "../../../components/contextual-methodology-warning";
import { AH_RESULT_LABELS, extendedUnavailableLabel, SCORE_MATRIX_SOURCE_LABELS } from "../../../components/enum-labels";
import { ResponsiveEvidence, type EvidenceColumn } from "../../../components/responsive-evidence";
import {
  ahRowModel,
  ahSummaryModel,
  ahWindow,
  type AhDisplaySide,
  type AhRowModel,
  exactGridModel,
  type ExactCellModel,
  expanderLabel,
  expanderStatus,
  type ExtendedMarketsSlot,
  normaliseExtendedMarkets,
  type OddsCellModel,
  tailLine,
  windowCaption,
} from "./extended-markets-model";

/**
 * Разделы «Азиатский гандикап» (#asian-handicap) и «Точный счёт» (#exact-score) — сиблинги панели
 * «Замороженный прогноз» (UI-SPEC, Layout and Placement). Клиентский остров нужен только для переключателя
 * стороны и расширителя; данные приходят готовыми с сервера, состояния загрузки нет. UI ничего не считает:
 * вероятности, окно, главная линия и коэффициенты берутся из вида как есть (D-04, D-06).
 *
 * Модуль не импортирует верстак страницы матча (правило чанк-графа T-10-06) и не ленивый (не next/dynamic).
 */

type AvailableView = Extract<ExtendedMarketsView, { state: "AVAILABLE" }>;

const METHODOLOGY_HREF = "/methodology#extended-markets";
const MAIN_MARKETS_UNTOUCHED = "Три основных рынка этого прогноза (1X2, тотал 2.5, обе забьют) не затронуты.";
const READ_FAILED_COPY = "Не удалось загрузить расширенные рынки. Остальные данные страницы не изменились. Повторите попытку.";
const AH_CAPTION = "Вероятности пяти исходов ставки на выбранную сторону по каждой линии; значения взяты из замороженной матрицы счёта.";
const EXACT_CAPTION = "В каждой клетке — вероятность счёта и справедливый десятичный коэффициент. Строки — голы хозяев, столбцы — голы гостей";

function Head({ id, title, showMeta }: { id: string; title: string; showMeta: boolean }) {
  return <div className="market-head">
    <h3 id={id}>{title}</h3>
    {showMeta && <>
      <span className="state-chip state-chip--md tone-neutral"><span className="state-dot" />Без калибровки</span>
      <Link href={METHODOLOGY_HREF}>Как это считается</Link>
    </>}
  </div>;
}

function Shell({ sectionId, title, showMeta, children }: { sectionId: string; title: string; showMeta: boolean; children?: ReactNode }) {
  const headingId = `${sectionId}-heading`;
  return <section id={sectionId} aria-labelledby={headingId} className="panel workbench-card">
    <Head id={headingId} title={title} showMeta={showMeta} />
    {children}
  </section>;
}

function OddsText({ cell }: { cell: OddsCellModel }) {
  return cell.available ? <>{cell.text}</> : <>{cell.text}{cell.reason && <span className="market-sub">{cell.reason}</span>}</>;
}

/** Устаревший снимок: нейтральное постоянное уведомление, без повтора (повтор не изменит неизменяемый снимок). */
function UnavailableNotice({ reason }: { reason: string }) {
  return <div className="state-notice tone-neutral" role="status" data-extended-state="UNAVAILABLE">
    <div className="state-notice-head"><span className="state-chip state-chip--md tone-neutral"><span className="state-dot" />Недоступно</span></div>
    <p className="state-notice-text">{extendedUnavailableLabel(reason)}</p>
    <p className="state-notice-text">{MAIN_MARKETS_UNTOUCHED}</p>
    <p className="state-notice-text"><Link href={METHODOLOGY_HREF}>Почему так — в методологии</Link></p>
  </div>;
}

/** Сбой чтения — настоящая ошибка: role=alert и обновление страницы; остальная страница не затронута. */
function ReadFailedNotice({ refreshHref }: { refreshHref: string }) {
  return <div className="state-notice tone-danger" role="alert" data-extended-state="READ_FAILED">
    <p className="state-notice-text">{READ_FAILED_COPY}</p>
    <p className="state-notice-text"><a href={refreshHref} onClick={(event) => { event.preventDefault(); window.location.reload(); }}>Обновить страницу</a></p>
  </div>;
}

function ahColumns(): readonly EvidenceColumn<AhRowModel>[] {
  const line: EvidenceColumn<AhRowModel> = {
    key: "line",
    label: "Линия",
    value: (row) => <>{row.label}{row.isMain && <>{" "}<span className="state-chip state-chip--md tone-positive"><span className="state-dot" />Главная линия</span></>}{row.homeHint && <span className="market-sub">{row.homeHint}</span>}{row.sub && <span className="market-sub">{row.sub}</span>}</>,
  };
  const outcomes = (["WIN", "HALF_WIN", "PUSH", "HALF_LOSS", "LOSS"] as const).map((result): EvidenceColumn<AhRowModel> => ({
    key: result.toLowerCase().replaceAll("_", "-"),
    label: AH_RESULT_LABELS[result],
    value: (row) => {
      const cell = row.outcomes.find((outcome) => outcome.result === result);
      if (!cell) return null;
      return cell.srText ? <>{cell.text}<span className="sr-only">{cell.srText}</span></> : cell.text;
    },
  }));
  return [
    line,
    ...outcomes,
    { key: "effective", label: "Эффективная вероятность выигрыша", value: (row) => row.effective },
    { key: "fair", label: "Справедливый коэффициент", value: (row) => <OddsText cell={row.fair} /> },
  ];
}

const AH_COLUMNS = ahColumns();

function AsianHandicapSection({ view, side, expanded, onSide, onExpanded }: { view: AvailableView; side: AhDisplaySide; expanded: boolean; onSide: (side: AhDisplaySide) => void; onExpanded: (expanded: boolean) => void }) {
  const { lines, mainLine } = view.asianHandicap;
  const rows = useMemo(() => ahWindow(lines, mainLine, side, expanded).map((line) => ahRowModel(line, side, mainLine)), [lines, mainLine, side, expanded]);
  const summary = useMemo(() => ahSummaryModel(lines, mainLine), [lines, mainLine]);
  return <Shell sectionId="asian-handicap" title="Азиатский гандикап" showMeta>
    <p>Вероятности исходов для линий от −2.5 до +2.5, рассчитанные по замороженной матрице счёта этого прогноза. Расчёт не использует коэффициенты букмекера.</p>
    <ContextualMethodologyWarning context="extendedMarkets" />
    <p className="market-sub">Матрица счёта: {SCORE_MATRIX_SOURCE_LABELS[view.source]}. Правила: <code>{view.rules.ahLines}</code>.</p>
    <dl className="market-summary">
      <div><dt>Главная линия</dt><dd>{summary.mainLabel}</dd></div>
      <div><dt>Справедливый коэффициент на хозяев</dt><dd><OddsText cell={summary.home} /></dd></div>
      <div><dt>Справедливый коэффициент на гостей</dt><dd><OddsText cell={summary.away} /></dd></div>
    </dl>
    <p className="market-sub">Главная линия — та, на которой по модели шансы сторон ближе всего к равным.</p>
    <div className="market-toolbar">
      <div className="market-side" role="group" aria-label="Сторона гандикапа">
        <button type="button" className="filter-chip" aria-pressed={side === "HOME"} onClick={() => onSide("HOME")}>Хозяева</button>
        <button type="button" className="filter-chip" aria-pressed={side === "AWAY"} onClick={() => onSide("AWAY")}>Гости</button>
      </div>
      <button type="button" className="btn-secondary btn-compact" aria-expanded={expanded} aria-controls="ah-lines" onClick={() => onExpanded(!expanded)}>{expanderLabel(expanded)}</button>
    </div>
    <p className="market-sub">{windowCaption(expanded)}</p>
    <p className="sr-only" role="status">{expanderStatus(expanded)}; сторона: {side === "HOME" ? "хозяева" : "гости"}</p>
    <div id="ah-lines" className="market-table">
      <ResponsiveEvidence<AhRowModel>
        projectionId="asian-handicap-lines"
        label="Азиатский гандикап — доказательства по линиям"
        tableLabel="Азиатский гандикап — таблица линий"
        caption={AH_CAPTION}
        rows={rows}
        columns={AH_COLUMNS}
        rowKey={(row) => row.key}
        conclusion={(row) => <>{row.label}{row.isMain && <>{" "}<span className="state-chip state-chip--md tone-positive"><span className="state-dot" />Главная линия</span></>}{row.homeHint && <span className="market-sub">{row.homeHint}</span>}</>}
        denominator={(row) => `Эффективная вероятность выигрыша ${row.effective} · справедливый коэффициент ${row.fair.text}`}
        warning={(row) => row.sub}
        rowCurrent={(row) => row.isMain}
      />
    </div>
    <p className="market-legend">Прочерк — такого исхода на этой линии не бывает. Проценты округлены: сумма может отличаться от 100%.</p>
    <details className="well">
      <summary>Как читать таблицу</summary>
      <ul>
        <li>Выигрыш — ставка выиграла полностью, проигрыш — проиграла полностью, возврат — ставка вернулась (пуш).</li>
        <li>На четвертных линиях (например, −0.75) ставка делится поровну между двумя соседними линиями, поэтому возможны «выигрыш половины ставки» и «проигрыш половины ставки».</li>
        <li>Эффективная вероятность выигрыша = вероятность выигрыша + половина вероятности выигрыша половины ставки.</li>
        <li>Справедливый коэффициент — коэффициент, при котором ожидаемый результат ставки по модели равен нулю с учётом возврата и половинных исходов. Он не показывает ошибку букмекера и не является рекомендацией.</li>
        <li>Версии правил: <code>{view.rules.ahLines}</code>, <code>{view.rules.ahSettlement}</code>, <code>{view.rules.exactScoreBuckets}</code>.</li>
      </ul>
    </details>
  </Shell>;
}

function ExactCellContent({ cell }: { cell: ExactCellModel }) {
  return <>
    <span className="market-cell-p"><span className="sr-only">{cell.srScore}</span>{cell.probability}</span>
    <span className="market-cell-o">
      {cell.odds.available
        ? <><span className="sr-only">{cell.srOdds}</span><span aria-hidden="true">{cell.oddsPrefix}</span>{cell.odds.text}</>
        : <>{cell.odds.text}{cell.odds.reason && <span className="market-sub">{cell.odds.reason}</span>}</>}
    </span>
  </>;
}

function ExactScoreSection({ view }: { view: AvailableView }) {
  const grid = useMemo(() => exactGridModel(view.exactScore), [view.exactScore]);
  return <Shell sectionId="exact-score" title="Точный счёт" showMeta>
    <p>Вероятности 16 явных счетов от 0:0 до 3:3 и всех остальных исходов вместе. Семнадцать вероятностей в сумме дают 100%.</p>
    <p className="note-strip">Вероятности точного счёта — оценки модели без калибровки, а не гарантии.</p>
    <p className="market-sub">{tailLine(view.tail.tailMass)}{view.tail.warning && <>{" "}<span className="state-chip state-chip--md tone-warning"><span className="state-dot" />Хвост повышен</span></>}</p>
    {/* market-grid-scroll: размерный контейнер, чтобы подпись таблицы занимала видимую ширину области прокрутки. */}
    <div className="evidence-table-scroll market-grid-scroll" role="region" aria-label="Точный счёт — таблица вероятностей" tabIndex={0}>
      <table className="market-table market-grid">
        <caption>{EXACT_CAPTION}</caption>
        <thead>
          <tr><th rowSpan={2} scope="col">Голы хозяев</th><th colSpan={grid.columns.length} scope="colgroup">Голы гостей</th></tr>
          <tr>{grid.columns.map((goals) => <th scope="col" key={goals}>{goals}</th>)}</tr>
        </thead>
        <tbody>
          {grid.rows.map((row) => <tr key={row.homeGoals}>
            <th scope="row">{row.homeGoals}</th>
            {row.cells.map((cell) => <td key={cell.selection}><ExactCellContent cell={cell} /></td>)}
          </tr>)}
        </tbody>
        <tfoot>
          <tr><th scope="row">Любой другой счёт</th><td colSpan={grid.columns.length}><ExactCellContent cell={grid.other} /></td></tr>
        </tfoot>
      </table>
    </div>
  </Shell>;
}

/**
 * Состояние стороны и расширителя поднято сюда и не зависит от forecast.id: при смене снимка прогноза сторона и
 * режим окна сохраняются в рамках сессии, а при перезагрузке сбрасываются (в адресе не хранятся).
 */
export function ExtendedMarketsSections({ slot, initialSide = "HOME", initialExpanded = false, refreshHref = "#" }: { slot: ExtendedMarketsSlot; initialSide?: AhDisplaySide; initialExpanded?: boolean; refreshHref?: string }) {
  const [side, setSide] = useState<AhDisplaySide>(initialSide);
  const [expanded, setExpanded] = useState(initialExpanded);
  const resolved = useMemo(() => normaliseExtendedMarkets(slot), [slot]);
  if (resolved.state === "AVAILABLE") {
    return <>
      <AsianHandicapSection view={resolved} side={side} expanded={expanded} onSide={setSide} onExpanded={setExpanded} />
      <ExactScoreSection view={resolved} />
    </>;
  }
  const notice = () => resolved.state === "READ_FAILED" ? <ReadFailedNotice refreshHref={refreshHref} /> : <UnavailableNotice reason={resolved.reason} />;
  return <>
    <Shell sectionId="asian-handicap" title="Азиатский гандикап" showMeta={false}>{notice()}</Shell>
    <Shell sectionId="exact-score" title="Точный счёт" showMeta={false}>{notice()}</Shell>
  </>;
}
