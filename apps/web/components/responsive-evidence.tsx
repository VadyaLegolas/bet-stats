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
}: ResponsiveEvidenceProps<Row>) {
  return (
    <div className="responsive-evidence" data-evidence-projection={projectionId}>
      <div className="evidence-desktop evidence-table-scroll" data-evidence-desktop role="region" aria-label={label} tabIndex={0}>
        <table aria-label={tableLabel}>
          <caption>{caption}</caption>
          <thead><tr>{columns.map((column) => <th scope="col" key={column.key}>{column.label}</th>)}</tr></thead>
          <tbody>{rows.map((row) => <tr key={rowKey(row)}>{columns.map((column, index) => index === 0
            ? <th scope="row" key={column.key} data-evidence-field={column.key}>{column.value(row)}</th>
            : <td key={column.key} data-evidence-field={column.key}>{column.value(row)}</td>)}</tr>)}</tbody>
        </table>
      </div>
      <div className="evidence-mobile" data-evidence-mobile aria-label={`${label} cards`}>
        {rows.map((row) => (
          <article className="evidence-card" key={rowKey(row)}>
            <h4>{conclusion(row)}</h4>
            <p className="evidence-denominator">{denominator(row)}</p>
            {warning && <p>{warning(row)}</p>}
            {freshness && <p>{freshness(row)}</p>}
            {action?.(row)}
            <details>
              <summary>Complete evidence</summary>
              <dl>{columns.map((column) => <div key={column.key} data-evidence-field={column.key}><dt>{column.label}</dt><dd>{column.value(row)}</dd></div>)}</dl>
            </details>
          </article>
        ))}
      </div>
    </div>
  );
}
