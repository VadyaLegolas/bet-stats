import { createElement } from "../../apps/web/node_modules/react/index.js";
import { renderToStaticMarkup } from "../../apps/web/node_modules/react-dom/server.js";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import HomePage from "../../apps/web/app/page.js";

const markup = renderToStaticMarkup(createElement(HomePage));

describe("home page", () => {
  it("keeps the single h1 with its id and text", () => {
    expect(markup.match(/<h1[\s>]/g)?.length).toBe(1);
    expect(markup).toMatch(/<h1[^>]*id="home-heading"[^>]*>Достоверные данные о футбольных матчах<\/h1>/);
  });

  it("keeps the real navigation links and call-to-action texts", () => {
    for (const href of ["/fixtures", "/methodology", "/scorecards", "/faq", "/fixtures#match-analysis"]) {
      expect(markup).toContain(`href="${href}"`);
    }
    for (const text of ["Предстоящие матчи", "Как работают прогнозы", "Результаты прогнозов"]) {
      expect(markup).toContain(text);
    }
  });

  it("keeps the contents block and the three principles verbatim", () => {
    expect(markup).toContain("В этом выпуске");
    expect(markup).toContain("Как устроен продукт");
    for (const title of ["Каноническая идентичность", "Модели Пуассона и Эло", "Откалиброванные исходы"]) {
      expect(markup).toContain(title);
    }
    for (const detail of [
      "Предстоящие матчи, сгруппированные по местной дате, с честной отметкой состояния данных.",
      "Замороженные прогнозы с доказательствами, допущениями и результатами проверок.",
      "Ведомости, измеряющие калибровку после каждого завершённого матча.",
      "Входы, исключения, уверенность, ограничения и политика оценки.",
      "Пошаговая инструкция: как запустить сайт, прочитать прогноз, ввести коэффициенты и проверить результаты.",
    ]) {
      expect(markup).toContain(detail);
    }
  });

  it("lists the value scanner between the analysis and results cards", () => {
    const detail = "Сводный список кандидатов value на ближайшие 7 суток: значения из сохранённых квитанций, без ранжирования по преимуществу.";
    expect(markup).toContain('href="/scanner"');
    expect(markup).toContain("Сканер value");
    expect(markup).toContain(detail);
    const contents = markup.slice(markup.indexOf('aria-labelledby="home-contents-heading"'), markup.indexOf('aria-labelledby="home-principles-heading"'));
    const analysis = contents.indexOf(">Анализ</a>");
    const scanner = contents.indexOf(">Сканер value</a>");
    const results = contents.indexOf(">Результаты</a>");
    expect(analysis).toBeGreaterThan(-1);
    expect(scanner).toBeGreaterThan(analysis);
    expect(results).toBeGreaterThan(scanner);
    expect(contents.match(/<article class="home-card"/g)?.length).toBe(6);
  });

  it("labels every illustration as an example with fictional data", () => {
    expect(markup).toContain("Пример");
    expect(markup).toContain("вымышлен");
    expect(markup).toContain("не данные модели");
    expect(markup).toContain("Оценка вероятности, а не гарантия исхода.");
    for (const club of ["Арсенал", "Брайтон", "Севилья", "Интер", "Байер"]) {
      expect(markup).not.toContain(club);
    }
  });

  it("draws the calibration chart as an accessible illustration", () => {
    const svg = markup.match(/<svg[^>]*role="img"[^>]*>/);
    expect(svg).not.toBeNull();
    expect(svg?.[0]).toMatch(/aria-label="[^"]*Иллюстрация/);
  });

  it("ships no inert fake controls", () => {
    expect(markup).not.toContain("<button");
  });
});

describe("root layout footer", () => {
  const layout = readFileSync(resolve(import.meta.dirname, "../../apps/web/app/layout.tsx"), "utf8");

  it("carries the 18+ mark and the persistent responsible-gambling sentence", () => {
    expect(layout).toContain("18+");
    expect(layout).toContain("Исходы остаются неопределёнными");
    expect(layout).toContain("release-footer-inner");
  });
});
