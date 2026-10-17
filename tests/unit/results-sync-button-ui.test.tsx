// The node unit project has no DOM library (no jsdom, happy-dom, @testing-library or
// react-test-renderer anywhere in the store) and installing one is out of quick scope, so a
// real click cannot be simulated. The behavioral cases below instead drive runResultsSync —
// the exact exported function the «Загрузить результаты» button's onClick delegates to —
// with stubbed fetch/window; the first case asserts the button/hint markup statically.
import { createElement } from "../../apps/web/node_modules/react/index.js";
import { renderToStaticMarkup } from "../../apps/web/node_modules/react-dom/server.js";
import { afterEach, describe, expect, it, vi } from "vitest";

// Probe-verified: mocking the bare `next/navigation` specifier does NOT intercept the
// component's import from a root test file — the resolved node_modules path does.
const refreshSpy = vi.hoisted(() => vi.fn());
vi.mock("../../apps/web/node_modules/next/navigation.js", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshSpy }),
}));

import { DateRangeFilter, formatResultsSyncResults, runResultsSync } from "../../apps/web/components/date-range-filter.js";

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("manual results publication button", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("renders both sync buttons and the results hint", () => {
    const markup = renderToStaticMarkup(createElement(DateRangeFilter, { leagues: ["Премьер-лига"], competition: "", autoSync: false }));
    expect(markup).toContain("Обновить матчи");
    expect(markup).toContain("Загрузить результаты");
    expect(markup).toContain("btn-secondary");
    expect(markup).toContain("публикует итоги завершённых матчей");
  });

  it("posts the scoped run, reports published results and refreshes quota + page", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse({ results: [{ league: "Премьер-лига", status: "synced", fixtures: 3, results: 3 }] }));
    vi.stubGlobal("fetch", fetchSpy);
    const dispatchSpy = vi.fn();
    vi.stubGlobal("window", { dispatchEvent: dispatchSpy });
    const setState = vi.fn();
    const refresh = vi.fn();

    await runResultsSync("Премьер-лига", setState, refresh);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe("/internal-api/fixtures/results-sync");
    expect(fetchSpy.mock.calls[0]?.[1]).toMatchObject({ method: "POST", cache: "no-store" });
    expect(JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body))).toEqual({ force: true, competitions: ["Премьер-лига"] });
    expect(setState).toHaveBeenLastCalledWith({ pending: false, message: "Премьер-лига: опубликовано 3 результата", error: false });
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    expect(dispatchSpy.mock.calls[0]?.[0]).toBeInstanceOf(CustomEvent);
    expect(dispatchSpy.mock.calls[0]?.[0].type).toBe("fixtures-quota-refresh");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("omits the competitions key for a full run and skips refresh while nothing published", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse({ results: [{ league: "Премьер-лига", status: "skipped", fixtures: 0 }] }));
    vi.stubGlobal("fetch", fetchSpy);
    const dispatchSpy = vi.fn();
    vi.stubGlobal("window", { dispatchEvent: dispatchSpy });
    const setState = vi.fn();
    const refresh = vi.fn();

    await runResultsSync("", setState, refresh);

    expect(JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body))).toEqual({ force: true });
    expect(setState).toHaveBeenLastCalledWith({ pending: false, message: "Премьер-лига: уже опубликовано недавно", error: false });
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("renders results-specific Russian copy for an unavailable run", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse({ reason: "DETERMINISTIC_MODE" }, 503));
    vi.stubGlobal("fetch", fetchSpy);
    const dispatchSpy = vi.fn();
    vi.stubGlobal("window", { dispatchEvent: dispatchSpy });
    const setState = vi.fn();
    const refresh = vi.fn();

    await runResultsSync("Премьер-лига", setState, refresh);

    expect(setState).toHaveBeenLastCalledWith({
      pending: false,
      message: "Загрузка результатов недоступна в демонстрационном режиме без базы данных.",
      error: true,
    });
    expect(dispatchSpy).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("maps per-league statuses and published-result plurals", () => {
    expect(formatResultsSyncResults([
      { league: "Премьер-лига", status: "failed", fixtures: 0, reason: "PROVIDER_ACCESS_RESTRICTED" },
    ])).toBe("Премьер-лига: лига недоступна на тарифе провайдера");
    expect(formatResultsSyncResults([
      { league: "Премьер-лига", status: "failed", fixtures: 0, reason: "PROVIDER_REQUEST_FAILED" },
    ])).toBe("Премьер-лига: сбой запроса к провайдеру");
    expect(formatResultsSyncResults([
      { league: "Премьер-лига", status: "failed", fixtures: 0, reason: "RESULT_FIXTURE_UNRESOLVED" },
    ])).toBe("Премьер-лига: отказ (RESULT_FIXTURE_UNRESOLVED)");
    expect(formatResultsSyncResults([
      { league: "Премьер-лига", status: "denied", fixtures: 0 },
    ])).toBe("Премьер-лига: отказ (UNKNOWN)");
    expect(formatResultsSyncResults([{ league: "Премьер-лига", status: "synced", fixtures: 1, results: 1 }]))
      .toBe("Премьер-лига: опубликовано 1 результат");
    expect(formatResultsSyncResults([{ league: "Премьер-лига", status: "synced", fixtures: 2, results: 2 }]))
      .toBe("Премьер-лига: опубликовано 2 результата");
    expect(formatResultsSyncResults([{ league: "Премьер-лига", status: "synced", fixtures: 5, results: 5 }]))
      .toBe("Премьер-лига: опубликовано 5 результатов");
  });
});
