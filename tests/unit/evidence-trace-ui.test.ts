import { createElement } from "../../apps/web/node_modules/react/index.js";
import { renderToStaticMarkup } from "../../apps/web/node_modules/react-dom/server.js";
import { describe, expect, it } from "vitest";

import type { EvidenceProjectionDto, EvidenceSourceRef } from "../../packages/domain/src/index.js";

import { EvidenceTraceTable, traceComponentLabels } from "../../apps/web/app/teams/[teamId]/evidence/page.js";

const ref = (fixtureId: string): EvidenceSourceRef => ({ fixtureId, effectiveAt: "2026-08-22T16:00:00.000Z", observedAt: "2026-08-22T18:00:00.000Z", sourceUpdatedAt: null, payloadHash: "sha-256:feedstock", payloadBytes: 512 });

const components: EvidenceProjectionDto["components"] = {
  form5: { kind: "form5", value: 1.8, unit: "points-per-match", sampleSize: 5, limitation: null, sourceRefs: [ref("fx-201")] },
  elo: { kind: "elo", value: 1520.5, unit: "rating-points", sampleSize: 10, limitation: null, sourceRefs: [ref("fx-201"), ref("fx-202")] },
};

describe("traceComponentLabels", () => {
  it("joins the Russian labels of components whose source refs include the fixture", () => {
    expect(traceComponentLabels({ components }, "fx-201")).toBe("Взвешенная форма за 5 матчей, Рейтинг Elo");
    expect(traceComponentLabels({ components }, "fx-202")).toBe("Рейтинг Elo");
  });

  it("returns null when no source refs reference the fixture", () => {
    expect(traceComponentLabels({ components }, "fx-999")).toBeNull();
  });

  it("returns null for missing or empty components", () => {
    expect(traceComponentLabels({}, "fx-201")).toBeNull();
    expect(traceComponentLabels({ components: {} }, "fx-201")).toBeNull();
  });
});

describe("EvidenceTraceTable", () => {
  it("renders a HOME win row with venue, outcome, score, provider, fixture label and component labels", () => {
    const markup = renderToStaticMarkup(createElement(EvidenceTraceTable, {
      rows: [{ fixtureId: "fx-201", effectiveAt: "2026-08-22T16:00:00.000Z", observedAt: "2026-08-22T18:00:00.000Z", venue: "HOME", outcome: "WIN", score: { home: 2, away: 1 }, source: "data-feed-7" }],
      fixtureLabels: { "fx-201": "Арсенал против Челси" },
      components,
      timeZone: "Europe/Warsaw",
    }));
    expect(markup).toContain("Арсенал против Челси");
    expect(markup).toContain("дома");
    expect(markup).toContain("победа");
    expect(markup).toContain("2:1");
    expect(markup).toContain("data-feed-7");
    expect(markup).toContain("Взвешенная форма за 5 матчей");
    expect(markup).toContain("Рейтинг Elo");
    expect(markup).toContain("<time dateTime=\"2026-08-22T16:00:00.000Z\" title=\"2026-08-22T16:00:00.000Z\">22 августа 2026 г. в 18:00</time>");
    expect(markup).toContain("<time dateTime=\"2026-08-22T18:00:00.000Z\" title=\"2026-08-22T18:00:00.000Z\">22 августа 2026 г. в 20:00</time>");
  });

  it("renders an AWAY draw row and a LOSS row in Russian", () => {
    const markup = renderToStaticMarkup(createElement(EvidenceTraceTable, {
      rows: [
        { fixtureId: "fx-202", effectiveAt: "2026-08-22T16:00:00.000Z", observedAt: "2026-08-22T18:00:00.000Z", venue: "AWAY", outcome: "DRAW", score: { home: 0, away: 0 }, source: "data-feed-7" },
        { fixtureId: "fx-303", venue: "HOME", outcome: "LOSS", score: { home: 1, away: 3 }, source: "data-feed-7" },
      ],
      fixtureLabels: {},
      components,
      timeZone: "Europe/Warsaw",
    }));
    expect(markup).toContain("в гостях");
    expect(markup).toContain("ничья");
    expect(markup).toContain("0:0");
    expect(markup).toContain("поражение");
    expect(markup).toContain("1:3");
    expect(markup).toContain("fx-202");
  });

  it("renders every unavailable cell as the Russian fallback for a fully-null row", () => {
    const markup = renderToStaticMarkup(createElement(EvidenceTraceTable, {
      rows: [{ fixtureId: "fx-404" }],
      fixtureLabels: {},
      components,
      timeZone: "Europe/Warsaw",
    }));
    expect(markup).toContain("fx-404");
    expect((markup.match(/Неизвестно/g) ?? []).length).toBe(7);
  });

  it("never leaks raw venue or outcome enum codes into the rendered markup", () => {
    const markup = renderToStaticMarkup(createElement(EvidenceTraceTable, {
      rows: [
        { fixtureId: "fx-201", effectiveAt: "2026-08-22T16:00:00.000Z", observedAt: "2026-08-22T18:00:00.000Z", venue: "HOME", outcome: "WIN", score: { home: 2, away: 1 }, source: "data-feed-7" },
        { fixtureId: "fx-202", venue: "AWAY", outcome: "DRAW", score: { home: 0, away: 0 }, source: "data-feed-7" },
        { fixtureId: "fx-303", venue: "HOME", outcome: "LOSS", score: { home: 1, away: 3 }, source: "data-feed-7" },
        { fixtureId: "fx-404" },
      ],
      fixtureLabels: { "fx-201": "Арсенал против Челси" },
      components,
      timeZone: "Europe/Warsaw",
    }));
    expect(markup).not.toContain("HOME");
    expect(markup).not.toContain("AWAY");
    expect(markup).not.toContain("WIN");
    expect(markup).not.toContain("DRAW");
    expect(markup).not.toContain("LOSS");
  });
});
