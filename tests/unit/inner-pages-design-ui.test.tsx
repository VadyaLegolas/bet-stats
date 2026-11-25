import { createElement } from "../../apps/web/node_modules/react/index.js";
import { renderToStaticMarkup } from "../../apps/web/node_modules/react-dom/server.js";
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MODEL_CARD } from "@bet-stats/domain";

// ScorecardDashboard mounts ResultsSyncButton, which reads the app router. As in
// scorecard-ui.test.tsx the resolved node_modules path is mocked (the bare specifier is not intercepted).
vi.mock("../../apps/web/node_modules/next/navigation.js", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import FaqPage from "../../apps/web/app/faq/page.js";
import MethodologyPage from "../../apps/web/app/methodology/page.js";
import { ScorecardDashboard, type ScorecardViewModel } from "../../apps/web/app/scorecards/scorecard-dashboard.js";

const stripTags = (value: string) => value.replace(/<[^>]*>/g, "");
const normalise = (value: string) => value.replace(/\s+/g, " ").trim();

/** Markup between the opening tag found at `openTag` and its matching close of the same element name. */
function innerOf(markup: string, openTag: string, name: string): string {
  const from = markup.indexOf(openTag);
  expect(from, `missing ${openTag}`).toBeGreaterThan(-1);
  const start = from + openTag.length;
  const tags = new RegExp(`<(/?)${name}(?![\\w-])`, "g");
  let depth = 1;
  for (const tag of markup.slice(start).matchAll(tags)) {
    depth += tag[1] ? -1 : 1;
    if (depth === 0) return markup.slice(start, start + tag.index!);
  }
  throw new Error(`unclosed ${openTag}`);
}

const model: ScorecardViewModel = {
  cohortIdentity: { modelVersion: "model-v1", competitionId: "premier-league", market: "ONE_X_TWO", from: "2026-01-01T00:00:00.000Z", to: "2026-02-01T00:00:00.000Z" },
  health: { state: "LIMITED", reasons: ["COHORT_BELOW_MINIMUM"], performanceClaim: null },
  denominators: { fixtureCount: 8, forecastCount: 8, eventCount: 24, valueCount: 1 },
  metrics: { meanBrierScore: 0.44, meanLogLoss: 0.67 },
  reliability: { policyId: "sha256:reliability", buckets: [] },
  financial: { count: 1, totalStakedUnits: "1", totalProfitUnits: "0.5", roi: "0.5", yield: "0.5", policyId: "flat-one-unit-v1" },
  clv: { status: "UNAVAILABLE", reason: "NO_COMPARABLE_CLOSE", comparableCount: 0 },
  receipts: { formulaId: "sha256:formula", cohortPolicyId: "sha256:cohort" },
} as unknown as ScorecardViewModel;
const emptyCandidates = { items: [], nextCursor: null, pageTotals: { count: 0, stakeUnits: "0", profitUnits: "0" } };
const renderScorecards = (overrides: Record<string, unknown> = {}, candidates: Record<string, unknown> = emptyCandidates, cursor?: string) =>
  renderToStaticMarkup(createElement(ScorecardDashboard, { scorecard: { ...model, ...overrides } as ScorecardViewModel, candidates: candidates as never, ...(cursor ? { cursor } : {}) }));

describe("scorecards design markup", () => {
  const markup = renderScorecards();

  it("renders the two proper-score metrics as KPI tiles with unchanged element text", () => {
    const tiles = [...markup.matchAll(/<p class="kpi-tile">(.*?)<\/p>/g)].map((match) => normalise(stripTags(match[1]!)));
    expect(tiles).toEqual(["Оценка Брайера: 0.4400", "Логарифмическая потеря: 0.6700"]);
    expect(markup).toContain('<span class="kpi-label">Оценка Брайера<span class="sr-only">:</span></span> <span class="kpi-value">0.4400</span>');
    const grid = innerOf(markup, '<div class="kpi-grid">', "div");
    expect(grid.match(/class="kpi-tile"/g)?.length).toBe(2);
    expect(markup).toContain('<h2>Правильные меры оценки</h2><div class="kpi-grid">');
  });

  it("keeps health before metrics, the deck class and the null-metrics paragraph", () => {
    expect(markup.indexOf("Ограниченные доказательства")).toBeLessThan(markup.indexOf("Оценка Брайера"));
    expect(markup).toContain('<p class="page-deck">Историческая оценка зафиксированных прогнозов');
    const empty = renderScorecards({ metrics: null });
    expect(empty).toContain("<h2>Правильные меры оценки</h2><p>Метрики правильных мер оценки недоступны.</p>");
    expect(empty).not.toContain("kpi-");
  });

  it("styles the receipts disclosure as a panel and the pagination links as touch targets", () => {
    expect(markup).toMatch(/<details id="formula-policy-receipts" class="panel panel--stack">/);
    const paged = renderScorecards({}, { ...emptyCandidates, nextCursor: "next-token" }, "current-cursor");
    expect(paged).toMatch(/<nav aria-label="Страницы кандидатов" class="cluster">/);
    const links = [...paged.matchAll(/<a class="link-touch" href="([^"]*)">([^<]*)<\/a>/g)].map((match) => match[2]);
    expect(links).toEqual(["Назад (первая страница)", "Далее"]);
  });
});

describe("methodology design markup", () => {
  const markup = renderToStaticMarkup(createElement(MethodologyPage));
  const ids = ["inputs", "dixon-coles", "what-is-excluded", "confidence", "limitations", "evaluation", "calibration", "extended-markets", "clv", "responsible-use", "change-history"];

  it("is a full-width page column with deck paragraphs", () => {
    expect(markup.startsWith('<article class="page-column"><h1>Как работают прогнозы</h1>')).toBe(true);
    expect(markup.match(/<p class="page-deck">/g)?.length).toBe(2);
  });

  it("keeps the h2 order and makes each h2 the first child of its section", () => {
    const h2 = [...markup.matchAll(/<h2>(.*?)<\/h2>/g)].map((match) => match[1]);
    expect(h2).toEqual(["Входы", "Поправка на низкие счета", "Что исключается", "Уверенность", "Ограничения", "Оценка", "Калибровка вероятностей", "Азиатский гандикап и точный счёт", "Сравнение с закрытием линии (CLV)", "Ответственное использование", "История изменений"]);
    for (const id of ids) expect(markup, id).toMatch(new RegExp(`<section id="${id}"[^>]*><h2>`));
  });

  it("publishes the CLV section with definition, method, evaluation-only role, late-entry refusal and honest limits", () => {
    const section = normalise(stripTags(innerOf(markup, '<section id="clv" class="panel">', "section")));
    expect(section).toContain(MODEL_CARD.clv.definition);
    for (const text of [...MODEL_CARD.clv.method, ...MODEL_CARD.clv.evaluationOnly, ...MODEL_CARD.clv.recording, ...MODEL_CARD.clv.limitations]) expect(section).toContain(text);
    expect(section).toContain("оценочный вид, а не прогноз и не обещание прибыли");
    expect(section).toContain("Поздние записи отклоняются");
    expect(section).toContain("Один источник");
    expect(section).toContain("Малые выборки");
    expect(section).toContain("no-vig-clv-v1");
    expect(markup).toContain("model-card-v1.4.0");
  });

  it("publishes the extended-markets section between calibration and CLV with the corrected tail wording and honest limits", () => {
    const section = normalise(stripTags(innerOf(markup, '<section id="extended-markets" class="panel">', "section")));
    const block = MODEL_CARD.extendedMarkets;
    expect(markup.indexOf('id="extended-markets"')).toBeGreaterThan(markup.indexOf('id="calibration-technical"'));
    expect(markup.indexOf('id="extended-markets"')).toBeLessThan(markup.indexOf('<section id="clv"'));
    expect(section).toContain(block.derivation);
    for (const text of [...block.method, ...block.limitations, ...block.formulas]) expect(section).toContain(text);
    expect(section).toContain("уже учтён нормировкой на сохранённую массу");
    expect(section).not.toMatch(/хвост[^.]*входит в строку/iu);
    expect(section).toContain("хранимому итоговому счёту");
    expect(section).toContain("дополнительным временем или серией пенальти");
    expect(section).toContain(block.versions.pushAwareEv);
    expect(section).toContain(block.legacyTolerance);
    expect(markup).toMatch(/<details id="extended-markets-technical" class="well"><summary>Технические подробности<\/summary>/);
  });

  it("links the limitations section to the extended-markets section and keeps the lead, disclosure and responsible use intact", () => {
    const limitations = normalise(stripTags(innerOf(markup, '<section id="limitations" class="panel">', "section")));
    expect(limitations).toContain("Азиатский гандикап и точный счёт — см. отдельный раздел.");
    expect(markup).toContain('href="/methodology#extended-markets"');
    expect(markup).toContain("Мы оцениваем вероятности событий футбольных матчей на основе исторических темпов забиваемых голов");
    expect(markup).toContain("Вероятности — это оценки, а не гарантии. Вы можете потерять деньги при ставках.");
    expect(markup).toContain("Используйте эти оценки только как прозрачные аналитические доказательства.");
  });

  it("wraps only the first nine sections into one large card grid, in order", () => {
    expect(markup.match(/<div class="card-grid card-grid--lg">/g)?.length).toBe(1);
    const grid = innerOf(markup, '<div class="card-grid card-grid--lg">', "div");
    expect([...grid.matchAll(/<section id="([^"]+)"/g)].map((match) => match[1])).toEqual(ids.slice(0, 9));
    expect(grid).not.toContain('id="responsible-use"');
    expect(grid).not.toContain('id="change-history"');
    expect(markup.indexOf('id="responsible-use"')).toBeGreaterThan(markup.indexOf('id="clv-technical"'));
    expect(markup).toMatch(/<section id="responsible-use" class="panel panel--stack panel--band">/);
    expect(markup).toMatch(/<section id="change-history" class="panel panel--stack">/);
    expect(markup).toMatch(/<section id="inputs" class="panel">/);
  });

  it("renders the model-card metadata as a facts grid with five groups and keeps its label", () => {
    const open = '<dl aria-label="Метаданные текущей карточки модели" class="panel panel--stack facts-grid">';
    expect(markup).toContain(open);
    const dl = innerOf(markup, open, "dl");
    expect(dl.match(/<div><dt>/g)?.length).toBe(5);
  });

  it("keeps every technical details element plain-text summarised and the history entries complete", () => {
    const total = markup.match(/<details /g)?.length ?? 0;
    expect(total).toBeGreaterThan(0);
    expect(markup.match(/<details id="[^"]+" class="well"><summary>Технические подробности<\/summary>/g)?.length).toBe(total);
    expect(markup.match(/<article class="history-entry">/g)?.length).toBe(MODEL_CARD.changeHistory.length);
  });
});

describe("faq design markup", () => {
  const markup = renderToStaticMarkup(createElement(FaqPage));

  it("keeps list and definition-list semantics with step cards and ruled questions", () => {
    expect(markup).toContain('<ol class="steps-list" role="list">');
    const list = innerOf(markup, '<ol class="steps-list" role="list">', "ol");
    expect(list.match(/<li>/g)?.length).toBe(12);
    expect(markup).toContain('<dl class="faq-list">');
    const questions = innerOf(markup, '<dl class="faq-list">', "dl");
    expect(questions.match(/<dt>/g)?.length).toBe(5);
    expect(markup).not.toContain("<details");
    expect(markup).not.toContain("<summary");
  });

  it("keeps the deck paragraph first and the headings unchanged", () => {
    expect(markup).toMatch(/<h1>FAQ: как пользоваться сайтом<\/h1><p class="page-deck">Пошаговая инструкция/);
    for (const heading of ["Пошаговая инструкция", "Частые вопросы", "Где смотреть дальше"]) expect(markup).toContain(`>${heading}</h2>`);
    expect(markup).toContain('href="/methodology#responsible-use"');
  });
});

describe("inner pages stylesheet contract", () => {
  const raw = readFileSync(resolve(import.meta.dirname, "../../apps/web/app/globals.css"), "utf8");
  const css = raw.replace(/\/\*[\s\S]*?\*\//g, "");
  const markup = renderScorecards({}, { ...emptyCandidates, nextCursor: "n" }, "c") + renderToStaticMarkup(createElement(MethodologyPage)) + renderToStaticMarkup(createElement(FaqPage));

  it("has a selector for every kpi-, card-grid--, panel--band, faq-, steps- (and page-deck, link-touch, cluster) class emitted", () => {
    const classes = new Set<string>();
    for (const match of markup.matchAll(/class="([^"]*)"/g)) {
      for (const token of match[1]!.split(/\s+/)) if (/^(kpi-|card-grid--|panel--band|faq-|steps-|page-deck$|link-touch$|cluster$)/.test(token)) classes.add(token);
    }
    expect(classes.size).toBeGreaterThan(6);
    for (const token of classes) expect(css, `missing .${token}`).toMatch(new RegExp(`\\.${token}(?![\\w-])`));
  });

  it("uses only design tokens for colour in the new rules", () => {
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([, selector]) => /\.(kpi-|card-grid--lg|panel--band|steps-list|faq-list|well|page-deck|back-link)/.test(selector!));
    expect(rules.length).toBeGreaterThan(15);
    for (const [, selector, body] of rules) {
      expect(body, selector!.trim()).not.toMatch(/#[0-9a-fA-F]{3,8}(?![\w-])/);
      expect(body, selector!.trim()).not.toMatch(/rgba?\(/);
    }
  });

  it("defines the deck rule under .release-main and the chevron summary", () => {
    expect(css).toMatch(/\.release-main \.page-deck\s*\{/);
    expect(css).toMatch(/summary::after\s*\{/);
  });

  it("keeps filter chips at 44px and no 40px remains", () => {
    const chip = css.match(/\.filter-chip\s*\{[^}]*\}/);
    expect(chip).not.toBeNull();
    expect(chip![0]).toMatch(/min-height:\s*44px/);
    expect(css).not.toMatch(/min-height:\s*40px/);
  });

  /** Every declaration block whose selector is exactly `selector` (a class can have several rules). */
  const bodies = (selector: string) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([, sel]) => sel!.trim() === selector).map(([, , body]) => body!);

  it("aligns the date headings and the header / footer radii with the canvas", () => {
    expect(bodies(".date-group-heading").join(" ")).toMatch(/color:\s*var\(--color-accent-text\)/);
    expect(bodies(".quota-counter").join(" ")).toMatch(/border-radius:\s*14px/);
    expect(bodies(".theme-toggle").join(" ")).toMatch(/border-radius:\s*16px/);
    const badge = bodies(".release-age-badge").join(" ");
    expect(badge).toMatch(/width:\s*38px/);
    expect(badge).toMatch(/height:\s*38px/);
    expect(badge).toMatch(/border-radius:\s*12px/);
  });
});
