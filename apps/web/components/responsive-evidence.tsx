import type { ReactNode } from "react";

export type EvidenceColumn<Row> = Readonly<{
  key: string;
  label: string;
  value: (row: Row) => ReactNode;
}>;

type ResponsiveEvidenceProps<Row> = Readonly<{
  projectionId: string;
  label: string;
  tableLabel: string;
  caption: string;
  rows: readonly Row[];
  columns: readonly EvidenceColumn<Row>[];
  rowKey: (row: Row) => string;
  conclusion: (row: Row) => ReactNode;
  denominator: (row: Row) => ReactNode;
  warning?: (row: Row) => ReactNode;
  freshness?: (row: Row) => ReactNode;
  action?: (row: Row) => ReactNode;
  /** Необязательная отметка текущей строки (главная линия): aria-current и data-current на строке и карточке, details карточки открыт. Без пропа разметка не меняется. */
  rowCurrent?: (row: Row) => boolean;
}>;

export function ResponsiveEvidence<Row>({
  projectionId,
  label,
  tableLabel,
  caption,
  rows,
  columns,
  rowKey,
  conclusion,
  denominator,
  warning,
  freshness,
  action,
  rowCurrent,
}: ResponsiveEvidenceProps<Row>) {
  const currentAttributes = (row: Row) => (rowCurrent?.(row) ? ({ "aria-current": "true", "data-current": "true" } as const) : {});
  return (
    <div className="responsive-evidence" data-evidence-projection={projectionId}>
      <div className="evidence-desktop evidence-table-scroll" data-evidence-desktop role="region" aria-label={label} tabIndex={0}>
        <table aria-label={tableLabel}>
          <caption>{caption}</caption>
          <thead><tr>{columns.map((column) => <th scope="col" key={column.key}>{column.label}</th>)}</tr></thead>
          <tbody>{rows.map((row) => <tr key={rowKey(row)} {...currentAttributes(row)}>{columns.map((column, index) => index === 0
            ? <th scope="row" key={column.key} data-evidence-field={column.key}>{column.value(row)}</th>
            : <td key={column.key} data-evidence-field={column.key}>{column.value(row)}</td>)}</tr>)}</tbody>
        </table>
      </div>
      <div className="evidence-mobile" data-evidence-mobile aria-label={`${label} cards`}>
        {rows.map((row) => {
          // null/undefined/false из warning — «предупреждения нет»: пустой <p> не рисуется (строки по-прежнему рисуются как раньше).
          const warningNode = warning?.(row);
          return (
          <article className="evidence-card" key={rowKey(row)} {...currentAttributes(row)}>
            <h4>{conclusion(row)}</h4>
            <p className="evidence-denominator">{denominator(row)}</p>
            {warningNode != null && warningNode !== false && <p>{warningNode}</p>}
            {freshness && <p>{freshness(row)}</p>}
            {action?.(row)}
            <details open={rowCurrent?.(row) ? true : undefined}>
              <summary>Полные доказательства</summary>
              <dl>{columns.map((column) => <div key={column.key} data-evidence-field={column.key}><dt>{column.label}</dt><dd>{column.value(row)}</dd></div>)}</dl>
            </details>
          </article>
          );
        })}
      </div>
    </div>
  );
}
