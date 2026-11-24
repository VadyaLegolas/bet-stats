import { createElement } from "../../apps/web/node_modules/react/index.js";
import { renderToStaticMarkup } from "../../apps/web/node_modules/react-dom/server.js";
import { describe, expect, it, vi } from "vitest";

// The dashboard mounts ResultsSyncButton, which reads the app router. As probe-verified
// in results-sync-button-ui.test.tsx, root test files must mock the resolved
// node_modules path — the bare `next/navigation` specifier does not intercept here.
vi.mock("../../apps/web/node_modules/next/navigation.js", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { ScorecardDashboard, canonicalScorecardQuery, type ScorecardViewModel } from "../../apps/web/app/scorecards/scorecard-dashboard.js";

const model: ScorecardViewModel = {
  cohortIdentity: { modelVersion: "model-v1", competitionId: "premier-league", market: "ONE_X_TWO", from: "2026-01-01T00:00:00.000Z", to: "2026-02-01T00:00:00.000Z" },
  health: { state: "LIMITED", reasons: ["COHORT_BELOW_MINIMUM"], performanceClaim: null },
  denominators: { fixtureCount: 8, forecastCount: 8, eventCount: 24, valueCount: 1 },
  metrics: { meanBrierScore: 0.44, meanLogLoss: 0.67 },
  reliability: { policyId: "sha256:reliability", buckets: [{ index: 0, lowerBound: 0, upperBound: 0.1, upperBoundInclusive: false, meanForecast: 0.06, observedFrequency: 0.1, count: 10, gap: 0.04, direction: "UNDER_CONFIDENT", evidenceState: "INSUFFICIENT" }] },
  financial: { count: 1, totalStakedUnits: "1", totalProfitUnits: "0.5", roi: "0.5", yield: "0.5", policyId: "flat-one-unit-v1" },
  clv: { status: "UNAVAILABLE", reason: "NO_COMPARABLE_CLOSE", comparableCount: 0 },
  receipts: { formulaId: "sha256:formula", cohortPolicyId: "sha256:cohort" },
};

describe("scorecard dashboard", () => {
  it("renders cohort health and denominators before metrics with an accessible reliability table", () => {
    const markup = renderToStaticMarkup(createElement(ScorecardDashboard, { scorecard: model, candidates: { items: [], nextCursor: null, pageTotals: { count: 0, stakeUnits: "0", profitUnits: "0" } } }));
    expect(markup.indexOf("Ограниченные доказательства")).toBeLessThan(markup.indexOf("Оценка Брайера"));
    expect(markup).toContain("8 матчей");
    expect(markup).toContain("Таблица доказательств надёжности");
    expect(markup).toContain("Доказательства по закрытию линии недоступны");
    expect(markup).toContain("нет сопоставимого коэффициента закрытия линии");
    expect(markup).toContain("Квитанции формул и политик");
    expect(markup).not.toMatch(/stake recommendation|guaranteed return/i);
  });

  it("renders human-readable Russian copy instead of raw calibration enum codes", () => {
    const markup = renderToStaticMarkup(createElement(ScorecardDashboard, { scorecard: model, candidates: { items: [{ id: "v-1", selection: "Хозяева", decimalOdds: "2.10", outcome: "UNAVAILABLE", stakeUnits: "1", profitUnits: "0", clv: { status: "UNAVAILABLE", reason: "CLOSING_OBSERVATION_MISSING", value: null } }], nextCursor: null, pageTotals: { count: 1, stakeUnits: "1", profitUnits: "0" } } }));
    expect(markup).toContain("Наблюдаемое выше прогноза");
    expect(markup).toContain("выборка когорты меньше минимума");
    expect(markup).toContain("нет наблюдения коэффициента закрытия");
    expect(markup).not.toContain("UNDER_CONFIDENT");
    expect(markup).not.toContain("OVER_CONFIDENT");
    expect(markup).not.toContain("ALIGNED");
    expect(markup).not.toContain("COHORT_BELOW_MINIMUM");
    expect(markup).not.toContain("CLOSING_OBSERVATION_MISSING");
    expect(markup).not.toContain("NO_COMPARABLE_CLOSE");
    expect(markup).not.toContain("SUFFICIENT");
  });

  it("explains the missing value-unit chain only while the panels are empty", () => {
    const empty = { ...model, financial: { ...model.financial, count: 0, totalStakedUnits: "0", totalProfitUnits: "0", roi: null, yield: null } };
    const emptyMarkup = renderToStaticMarkup(createElement(ScorecardDashboard, { scorecard: empty, candidates: { items: [], nextCursor: null, pageTotals: { count: 0, stakeUnits: "0", profitUnits: "0" } } }));
    expect(emptyMarkup).toContain("Цепочка: кандидат value → финиш матча → публикация результатов («Загрузить результаты») → единица оценки.");
    expect(emptyMarkup).toContain("Единицы оценки появляются только из рассчитанных кандидатов — цепочка появления в реестре ниже.");
    const populated = renderToStaticMarkup(createElement(ScorecardDashboard, { scorecard: model, candidates: { items: [{ id: "v-1", selection: "Хозяева", decimalOdds: "2.10", outcome: "WIN", stakeUnits: "1", profitUnits: "1.1", clv: { status: "UNAVAILABLE", reason: null, value: null } }], nextCursor: null, pageTotals: { count: 1, stakeUnits: "1", profitUnits: "1.1" } } }));
    expect(populated).not.toContain("Цепочка: кандидат value");
    expect(populated).not.toContain("Единицы оценки появляются");
  });

  it("mounts the results publication button above the ведомость", () => {
    const markup = renderToStaticMarkup(createElement(ScorecardDashboard, { scorecard: model, candidates: { items: [], nextCursor: null, pageTotals: { count: 0, stakeUnits: "0", profitUnits: "0" } } }));
    expect(markup).toContain("<h2>Загрузка результатов</h2>");
    expect(markup).toContain("Загрузить результаты");
    expect(markup).toContain("Публикует итоги завершённых матчей принудительно");
    /* The button leads the page: its panel comes before the cohort filter form,
       so publishing results never needs a detour through «Матчи». */
    expect(markup.indexOf("Загрузка результатов")).toBeLessThan(markup.indexOf("Применить точную когорту"));
  });

  it("keeps exact filters in deterministic URL identity without silent substitution", () => {
    expect(canonicalScorecardQuery(model.cohortIdentity)).toBe("modelVersion=model-v1&competitionId=premier-league&market=ONE_X_TWO&from=2026-01-01T00%3A00%3A00.000Z&to=2026-02-01T00%3A00%3A00.000Z");
    const unavailable = { ...model, health: { state: "UNAVAILABLE" as const, reasons: ["NO_SCOREABLE_FIXTURES"], performanceClaim: null }, metrics: null };
    const markup = renderToStaticMarkup(createElement(ScorecardDashboard, { scorecard: unavailable, candidates: { items: [], nextCursor: null, pageTotals: { count: 0, stakeUnits: "0", profitUnits: "0" } } }));
    expect(markup).toContain("Нет пригодных для оценки доказательств для этой точной когорты");
    expect(markup).toContain("model-v1");
    expect(markup).toContain("premier-league");
  });

  describe("no-vig CLV column (CLV-02, D-06)", () => {
    const NO_VIG_REASONS = ["CLOSING_SET_MISSING", "CLOSING_SET_INCOMPLETE", "CANDIDATE_SET_INCOMPLETE", "SOURCE_CONVENTION_MISMATCH", "INVALID_TIMESTAMP", "CLOSING_BEFORE_CANDIDATE", "CLOSING_NOT_PRE_KICKOFF", "INVALID_ODDS"] as const;
    const page = (clvNoVig: unknown) => ({ items: [{ id: "v-1", selection: "Хозяева", decimalOdds: "2.10", outcome: "WIN", stakeUnits: "1", profitUnits: "1.1", clv: { status: "AVAILABLE", reason: null, value: "0.0450", policyVersion: "odds-ratio-clv-v1" }, clvNoVig }], nextCursor: null, pageTotals: { count: 1, stakeUnits: "1", profitUnits: "1.1" } }) as never;
    const render = (clvNoVig: unknown) => renderToStaticMarkup(createElement(ScorecardDashboard, { scorecard: model, candidates: page(clvNoVig) }));

    it("shows the de-vigged value with policy label, closing time and source, and keeps the odds-ratio value under its own label", () => {
      const markup = render({ status: "AVAILABLE", policyVersion: "no-vig-clv-v1", value: "0.052341", pCandidateFair: "0.4500", pCloseFair: "0.4735", closingObservedAt: "2026-11-30T11:00:00.000Z", source: "manual-book-a" });
      expect(markup).toContain("CLV без маржи");
      expect(markup).toContain("+5.23 %");
      expect(markup).toContain("no-vig-clv-v1");
      expect(markup).toContain("manual-book-a");
      expect(markup).toContain("30 ноября 2026");
      expect(markup).toContain("odds-ratio-clv-v1");
      expect(markup).toContain("0.0450");
      expect(markup).toContain("CLV по коэффициентам");
    });

    it.each(NO_VIG_REASONS)("renders a Russian reason for %s and never the raw code", (reason) => {
      const markup = render({ status: "UNAVAILABLE", policyVersion: "no-vig-clv-v1", reason });
      expect(markup).not.toContain(reason);
      expect(markup).toContain("CLV без маржи недоступен:");
      expect(markup).not.toContain("нет данных");
    });

    it("gives every reason its own distinct Russian text", () => {
      const texts = NO_VIG_REASONS.map((reason) => render({ status: "UNAVAILABLE", policyVersion: "no-vig-clv-v1", reason }).match(/CLV без маржи недоступен: ([^<]*)</u)?.[1]);
      expect(texts.every((text) => typeof text === "string" && /[а-яё]/iu.test(text))).toBe(true);
      expect(new Set(texts).size).toBe(NO_VIG_REASONS.length);
    });

    it("degrades to «нет данных» when the API does not carry the field and never prints a negative-zero value as a promise", () => {
      expect(render(undefined)).toContain("нет данных");
      expect(render({ status: "AVAILABLE", policyVersion: "no-vig-clv-v1", value: "-0.0312", pCandidateFair: "0.5", pCloseFair: "0.4844", closingObservedAt: "2026-11-30T11:00:00.000Z", source: "s" })).toContain("−3.12 %");
    });

    it("states that CLV is neither a forecast nor a profit promise and keeps the responsible-use warning", () => {
      const markup = render({ status: "AVAILABLE", policyVersion: "no-vig-clv-v1", value: "0.01", pCandidateFair: "0.5", pCloseFair: "0.505", closingObservedAt: "2026-11-30T11:00:00.000Z", source: "s" });
      expect(markup).toContain("не прогноз");
      expect(markup).toContain("Историческая оценка не гарантирует будущих результатов.");
      expect(markup).not.toMatch(/гарантированн|гарантируем|верная ставка|точно выигра|прибыль гарантирована|заработа/iu);
    });
  });

  it("speaks Russian with a calendar period instead of raw API keys and ISO instants", () => {
    const markup = renderToStaticMarkup(createElement(ScorecardDashboard, { scorecard: model, candidates: { items: [], nextCursor: null, pageTotals: { count: 0, stakeUnits: "0", profitUnits: "0" } } }));
    for (const label of ["Период с", "Период по", "Версия модели", "Соревнование", "Рынок"]) expect(markup).toContain(label);
    /* The five API keys must not surface as labels — they stay as input names for the query. */
    expect(markup).not.toContain(">modelVersion<");
    expect(markup).not.toContain(">competitionId<");
    expect(markup).not.toContain(">from<");
    expect(markup).not.toContain(">to<");
    /* Whole UTC days in the pickers: the exclusive bound 2026-02-01T00:00:00.000Z floors to
       its own day 2026-01-31 so the picked end day stays whole when the server converts back.
       React reorders attributes in SSR markup, so match name+value pairs, not full tags. */
    expect(markup).toContain('name="from" value="2026-01-01"');
    expect(markup).toContain('name="to" value="2026-01-31"');
    expect(markup.match(/type="date"/g)).toHaveLength(2);
    expect(markup).not.toContain("2026-02-01T00:00:00.000Z");
    expect(markup).toContain("Выберите период календарём");
  });
});
