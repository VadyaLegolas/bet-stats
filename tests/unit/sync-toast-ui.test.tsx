// The node unit project has no DOM library, so the popup behavior is asserted here where
// it is testable without one: the pure phase→toast mapping, the title/TTL tables and the
// stack's static markup. The timer lifecycle (hide mark → exit fade → removal) lives in
// the client hook and is verified live in the browser.
import { createElement } from "../../apps/web/node_modules/react/index.js";
import { renderToStaticMarkup } from "../../apps/web/node_modules/react-dom/server.js";
import { describe, expect, it } from "vitest";

import {
  MAX_TOASTS,
  TOAST_EXIT_MS,
  TOAST_TTL_MS,
  SyncToastStack,
  syncToastFor,
  toastTitle,
} from "../../apps/web/components/sync-toast.js";

describe("disappearing sync popups", () => {
  it("stays silent while a phase runs or produced no message", () => {
    expect(syncToastFor("fixtures", { pending: true })).toBeNull();
    expect(syncToastFor("fixtures", { pending: true, message: "Премьер-лига: загружено 3 матча" })).toBeNull();
    expect(syncToastFor("results", { pending: false })).toBeNull();
  });

  it("maps finished phases to success or error popups carrying the status-line message", () => {
    expect(syncToastFor("fixtures", { pending: false, message: "Премьер-лига: загружено 3 матча", error: false }))
      .toEqual({ kind: "success", message: "Премьер-лига: загружено 3 матча" });
    expect(syncToastFor("results", { pending: false, message: "Премьер-лига: опубликовано 2 результата", error: false }))
      .toEqual({ kind: "success", message: "Премьер-лига: опубликовано 2 результата" });
    expect(syncToastFor("fixtures", { pending: false, message: "Не удалось запустить обновление.", error: true }))
      .toEqual({ kind: "error", message: "Не удалось запустить обновление." });
    expect(syncToastFor("results", { pending: false, message: "Сервер данных недоступен — загрузка результатов не выполнена.", error: true }))
      .toEqual({ kind: "error", message: "Сервер данных недоступен — загрузка результатов не выполнена." });
  });

  it("titles the popup after the button that was pressed", () => {
    expect(toastTitle("fixtures", "success")).toBe("Матчи обновлены");
    expect(toastTitle("fixtures", "error")).toBe("Не удалось обновить матчи");
    expect(toastTitle("results", "success")).toBe("Результаты обновлены");
    expect(toastTitle("results", "error")).toBe("Не удалось загрузить результаты");
  });

  it("keeps errors on screen longer than successes and caps the stack", () => {
    expect(TOAST_TTL_MS.success).toBe(5000);
    expect(TOAST_TTL_MS.error).toBe(8000);
    expect(TOAST_EXIT_MS).toBeGreaterThan(0);
    expect(MAX_TOASTS).toBe(3);
  });

  it("renders a success popup with its title, summary and a close control", () => {
    const markup = renderToStaticMarkup(createElement(SyncToastStack, {
      toasts: [{ id: 1, phase: "fixtures", kind: "success", message: "Премьер-лига: загружено 3 матча", leaving: false }],
      onDismiss: () => {},
    }));
    expect(markup).toContain("Матчи обновлены");
    expect(markup).toContain("Премьер-лига: загружено 3 матча");
    expect(markup).toContain("sync-toast--success");
    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-label="Закрыть уведомление"');
    expect(markup).not.toContain("sync-toast--leaving");
  });

  it("renders an error popup as an assertive alert and marks the leaving fade", () => {
    const markup = renderToStaticMarkup(createElement(SyncToastStack, {
      toasts: [{ id: 2, phase: "results", kind: "error", message: "Премьер-лига: сбой запроса к провайдеру", leaving: true }],
      onDismiss: () => {},
    }));
    expect(markup).toContain("Не удалось загрузить результаты");
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("sync-toast--error");
    expect(markup).toContain("sync-toast--leaving");
  });

  it("renders nothing while there are no popups", () => {
    expect(renderToStaticMarkup(createElement(SyncToastStack, { toasts: [], onDismiss: () => {} }))).toBe("");
  });
});
