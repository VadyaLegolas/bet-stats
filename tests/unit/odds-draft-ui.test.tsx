import { createElement } from "../../apps/web/node_modules/react/index.js";
import { renderToStaticMarkup } from "../../apps/web/node_modules/react-dom/server.js";
import { describe, expect, it } from "vitest";

import {
  buildOddsSubmission,
  ForecastWorkbench,
  forecastOptionLabel,
  oddsDraftStorageKey,
  selectStableSnapshot,
  validateOddsFields,
} from "../../apps/web/app/fixtures/[fixtureId]/forecast-workbench.js";

describe("manual odds workbench draft behavior", () => {
  it("scopes versioned local drafts by fixture and market", () => {
    expect(oddsDraftStorageKey("fixture/1", "ONE_X_TWO")).toBe("bet-stats:manual-odds-draft-v1:fixture%2F1:ONE_X_TWO");
  });

  it("requires every market selection and identifies invalid fields", () => {
    expect(validateOddsFields("ONE_X_TWO", { HOME: "2.10", DRAW: "", AWAY: "1" })).toEqual({
      DRAW: "Enter decimal odds.",
      AWAY: "Decimal odds must be greater than 1.00.",
    });
    expect(validateOddsFields("BTTS", { YES: "1.91", NO: "2.05" })).toEqual({});
  });

  it("builds only a complete server input without client-derived analytics", () => {
    expect(buildOddsSubmission({
      fixtureId: "fixture-1",
      market: "BTTS",
      sourceLabel: "Manual book",
      fields: { YES: "1.91", NO: "2.05" },
      capturedAt: "2026-09-06T03:00:00.000Z",
      oddsSnapshotId: "draft-client-id",
    })).toEqual({
      oddsSnapshotId: "draft-client-id",
      market: "BTTS",
      sourceLabel: "Manual book",
      capturedAt: "2026-09-06T03:00:00.000Z",
      selections: [
        { selection: "YES", decimalOdds: "1.91" },
        { selection: "NO", decimalOdds: "2.05" },
      ],
    });
    expect(() => buildOddsSubmission({ fixtureId: "fixture-1", market: "BTTS", sourceLabel: "", fields: { YES: "1.91", NO: "" }, capturedAt: "now", oddsSnapshotId: "id" })).toThrow("INCOMPLETE_ODDS_BOOK");
  });

  it("keeps an explicit selected snapshot when newer snapshots arrive", () => {
    const original = { id: "forecast-1" };
    expect(selectStableSnapshot("forecast-1", [original, { id: "forecast-2" }])).toBe(original);
    expect(selectStableSnapshot("missing", [original, { id: "forecast-2" }])).toBe(original);
  });

  it("labels discovered snapshots with their exact non-round cutoff", () => {
    expect(forecastOptionLabel({
      id: "forecast-lineup-2",
      kind: "LINEUP_CONFIRMED",
      revision: 2,
      cutoff: "2026-09-06T11:17:23.000Z",
    })).toBe("LINEUP_CONFIRMED revision 2 — 2026-09-06T11:17:23.000Z — forecast-lineup-2");
  });

  it("renders an honest empty state when discovery returns no issued snapshots", () => {
    const markup = renderToStaticMarkup(createElement(ForecastWorkbench, { fixtureId: "fixture-1", forecasts: [] }));
    expect(markup).toContain("No comparable forecast pair yet");
    expect(markup).toContain("This fixture does not have two issued forecast snapshots.");
    expect(markup).not.toContain("fixture and cutoff");
  });
});
