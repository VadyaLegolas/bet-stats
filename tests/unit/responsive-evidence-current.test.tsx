import { createElement } from "../../apps/web/node_modules/react/index.js";
import { renderToStaticMarkup } from "../../apps/web/node_modules/react-dom/server.js";
import { describe, expect, it } from "vitest";

import { ResponsiveEvidence, type EvidenceColumn } from "../../apps/web/components/responsive-evidence.js";

type Row = { id: string; label: string; share: string };
const rows: readonly Row[] = [
  { id: "a", label: "Первая", share: "38.1%" },
  { id: "b", label: "Вторая", share: "61.9%" },
];
const columns: readonly EvidenceColumn<Row>[] = [
  { key: "label", label: "Выбор", value: (row) => row.label },
  { key: "share", label: "Доля", value: (row) => row.share },
];

const base = {
  projectionId: "fixed-rows",
  label: "Фиксированные строки",
  tableLabel: "Таблица фиксированных строк",
  caption: "Подпись таблицы",
  rows,
  columns,
  rowKey: (row: Row) => row.id,
  conclusion: (row: Row) => row.label,
  denominator: (row: Row) => `${row.share} доля`,
};

describe("ResponsiveEvidence rowCurrent", () => {
  it("keeps the markup of every existing caller byte for byte when rowCurrent is omitted", () => {
    // Снимок снят на HEAD до правки компонента (план 14-04, задача 2, шаг 1).
    const markup = renderToStaticMarkup(createElement(ResponsiveEvidence<Row>, { ...base, warning: () => "Предупреждение", freshness: () => "Свежо" }));
    expect(markup).toMatchInlineSnapshot(`"<div class="responsive-evidence" data-evidence-projection="fixed-rows"><div class="evidence-desktop evidence-table-scroll" data-evidence-desktop="true" role="region" aria-label="Фиксированные строки" tabindex="0"><table aria-label="Таблица фиксированных строк"><caption>Подпись таблицы</caption><thead><tr><th scope="col">Выбор</th><th scope="col">Доля</th></tr></thead><tbody><tr><th scope="row" data-evidence-field="label">Первая</th><td data-evidence-field="share">38.1%</td></tr><tr><th scope="row" data-evidence-field="label">Вторая</th><td data-evidence-field="share">61.9%</td></tr></tbody></table></div><div class="evidence-mobile" data-evidence-mobile="true" aria-label="Фиксированные строки cards"><article class="evidence-card"><h4>Первая</h4><p class="evidence-denominator">38.1% доля</p><p>Предупреждение</p><p>Свежо</p><details><summary>Полные доказательства</summary><dl><div data-evidence-field="label"><dt>Выбор</dt><dd>Первая</dd></div><div data-evidence-field="share"><dt>Доля</dt><dd>38.1%</dd></div></dl></details></article><article class="evidence-card"><h4>Вторая</h4><p class="evidence-denominator">61.9% доля</p><p>Предупреждение</p><p>Свежо</p><details><summary>Полные доказательства</summary><dl><div data-evidence-field="label"><dt>Выбор</dt><dd>Вторая</dd></div><div data-evidence-field="share"><dt>Доля</dt><dd>61.9%</dd></div></dl></details></article></div></div>"`);
    expect(markup).not.toContain("aria-current");
    expect(markup).not.toContain("data-current");
  });

  it("marks only the matching row and card, and opens that card's details", () => {
    const markup = renderToStaticMarkup(createElement(ResponsiveEvidence<Row>, { ...base, rowCurrent: (row: Row) => row.id === "b" }));
    expect(markup.match(/aria-current="true"/g)).toHaveLength(2);
    expect(markup.match(/data-current="true"/g)).toHaveLength(2);
    const rowMarkup = /<tr[^>]*data-current="true"[^>]*>.*?<\/tr>/.exec(markup)?.[0] ?? "";
    expect(rowMarkup).toContain("Вторая");
    expect(rowMarkup).not.toContain("Первая");
    const card = /<article[^>]*data-current="true"[^>]*>[\s\S]*?<\/article>/.exec(markup)?.[0] ?? "";
    expect(card).toContain("<details open=\"\">");
    expect(card).toContain("Вторая");
    const other = /<article class="evidence-card"[^>]*>[\s\S]*?<\/article>/.exec(markup)?.[0] ?? "";
    expect(other).toContain("Первая");
    expect(other).toContain("<details>");
  });
});
