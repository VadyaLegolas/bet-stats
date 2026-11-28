import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

/*
 * Phase 15, plan 15-05: every state of /scanner and the visual, keyboard and safety backstops of 15-UI-SPEC.md, against
 * the deterministic stub API of tests/e2e/scanner-stub-api.mjs. Run with `-c playwright.scanner.config.ts`
 * (`pnpm verify:scanner`); the real stack is covered by value-scanner-live.spec.ts.
 */

const stubOrigin = process.env.SCANNER_STUB_ORIGIN;

/* Held-out stored strings: the page must print them character for character. */
const LONG_ODDS = "2.123456789012345678901234567890123456789";
const HELD_OUT: ReadonlyArray<{ readonly receipt: string; readonly edge: string; readonly expectedValue: string }> = [
  { receipt: "stub-receipt-1", edge: "0.0432109876543210987654321", expectedValue: "0.1234567890123456789012345678901234567891" },
  { receipt: "stub-receipt-2", edge: "1.2e-7", expectedValue: "3.4e-7" },
  { receipt: "stub-receipt-3", edge: "0.1000", expectedValue: "0.2000" },
];
const LONG_SOURCE = "UnbrokenBookmakerSourceLabel".padEnd(80, "x");
const SCRIPT_SOURCE = "<script>window.__scannerStubInjected=true</script>";
const LONG_TEAM = "Borussiamoenchengladbachunterhachingeintrachtfrankfurtleverkusen";

const NAV_LABELS = ["Матчи", "Анализ", "Сканер", "Результаты", "Методология", "FAQ", "Операции"];
const AVAILABLE_HEADING = "Кандидаты value на ближайшие 7 суток";
const EMPTY_HEADING = "Кандидатов value на ближайшие 7 суток нет";
const UNAVAILABLE_HEADING = "Сканер value сейчас недоступен";
const PLAQUE_LABEL = "Ограничение версии политики value";
const ALL_STALE_LINE = "Кандидатов со свежими или стареющими коэффициентами нет. Все кандидаты — в блоке «Устаревшие коэффициенты» ниже.";
const RISK_DISCLOSURE = "Вероятности — это оценки, а не гарантии. Вы можете потерять деньги при ставках.";

async function useScenario(request: APIRequestContext, name: string): Promise<void> {
  const response = await request.post(`${stubOrigin}/__scenario`, { data: { name } });
  expect(response.ok(), `the stub accepts scenario ${name}`).toBe(true);
}

async function openScanner(page: Page): Promise<void> {
  await page.goto("/scanner");
  await expect(page.getByRole("heading", { level: 1, name: "Сканер value" })).toBeVisible();
}

async function openAllDetails(page: Page): Promise<void> {
  await page.locator("main details").evaluateAll((elements) => { for (const element of elements) (element as HTMLDetailsElement).open = true; });
}

async function violations(page: Page) {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  return result.violations.map((violation) => ({ id: violation.id, targets: violation.nodes.map((node) => node.target.join(" ")) }));
}

async function pageOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

/** Every rendered box and every text line of main that leaves the viewport (screen-reader-only text is excluded). */
async function outsideViewport(page: Page): Promise<string[]> {
  return page.locator("main").evaluate((main) => {
    const viewport = document.documentElement.clientWidth;
    const offenders: string[] = [];
    const describe = (element: Element) => `${element.tagName.toLowerCase()}.${element.getAttribute("class") ?? ""} «${(element.textContent ?? "").slice(0, 40)}»`;
    for (const element of main.querySelectorAll("*")) {
      if (element.closest(".sr-only")) continue;
      const boxes = [element.getBoundingClientRect()];
      for (const node of element.childNodes) {
        if (node.nodeType !== Node.TEXT_NODE || !node.textContent?.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        boxes.push(...Array.from(range.getClientRects()));
      }
      if (boxes.some((box) => box.width > 0 && (box.left < -0.5 || box.right > viewport + 0.5))) offenders.push(describe(element));
    }
    return offenders;
  });
}

/** Labels that overflow, take more than two lines or break inside a word. */
async function brokenLabels(page: Page): Promise<{ checked: number; broken: string[] }> {
  return page.locator("main").evaluate((main) => {
    const broken: string[] = [];
    let checked = 0;
    for (const label of main.querySelectorAll("dt")) {
      if (label.getClientRects().length === 0) continue;
      checked += 1;
      const text = label.textContent ?? "";
      if (label.scrollWidth > label.clientWidth + 1) broken.push(`overflow: ${text}`);
      const lines = new Set<number>();
      const walker = document.createTreeWalker(label, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        for (const match of (node.textContent ?? "").matchAll(/[\p{L}\p{N}]+/gu)) {
          const range = document.createRange();
          range.setStart(node, match.index);
          range.setEnd(node, match.index + match[0].length);
          const tops = new Set(Array.from(range.getClientRects(), (box) => Math.round(box.top)));
          if (tops.size > 1) broken.push(`mid-word break: ${match[0]} in ${text}`);
          for (const top of tops) lines.add(top);
        }
      }
      if (lines.size > 2) broken.push(`${lines.size} lines: ${text}`);
    }
    return { checked, broken };
  });
}

/** Standalone targets (row links and disclosure summaries) lower than 44 px. */
async function smallTargets(page: Page): Promise<{ checked: number; small: string[] }> {
  return page.locator("main").evaluate((main) => {
    const small: string[] = [];
    let checked = 0;
    for (const target of main.querySelectorAll(".scanner-links a, summary, a.btn-secondary")) {
      if (target.getClientRects().length === 0) continue;
      checked += 1;
      const height = target.getBoundingClientRect().height;
      if (height < 43.5) small.push(`${height.toFixed(1)}px «${(target.textContent ?? "").slice(0, 40)}»`);
    }
    return { checked, small };
  });
}

test.beforeEach(async ({ request }) => {
  if (!stubOrigin) throw new Error("SCANNER_STUB_ORIGIN is missing: run this specification with `playwright test -c playwright.scanner.config.ts` (pnpm verify:scanner)");
  await useScenario(request, "available");
});

for (const width of [320, 375, 768, 1440]) {
  for (const scheme of ["light", "dark", "forced colors"] as const) {
    test(`AVAILABLE at ${width} px, ${scheme}: no horizontal scroll, whole values, unbroken labels, 44 px targets`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      // The theme is read while the page loads, so the media is emulated before it opens.
      await page.emulateMedia(scheme === "forced colors" ? { colorScheme: "light", forcedColors: "active" } : { colorScheme: scheme, forcedColors: "none" });
      await openScanner(page);
      await expect(page.locator("html")).toHaveAttribute("data-theme", scheme === "dark" ? "dark" : "light");
      expect(await page.evaluate(() => matchMedia("(forced-colors: active)").matches)).toBe(scheme === "forced colors");
      await expect(page.getByRole("heading", { level: 2, name: AVAILABLE_HEADING })).toBeVisible();

      expect(await pageOverflow(page), "collapsed page").toBeLessThanOrEqual(1);
      await openAllDetails(page);
      await expect(page.locator("li.scanner-row:visible")).toHaveCount(5);

      expect(await pageOverflow(page), "expanded page").toBeLessThanOrEqual(1);
      expect(await outsideViewport(page)).toEqual([]);

      const labels = await brokenLabels(page);
      expect(labels.checked).toBeGreaterThan(20);
      expect(labels.broken).toEqual([]);

      const targets = await smallTargets(page);
      // Two links and one summary per row, the how-to-read summary and the stale summary.
      expect(targets.checked).toBe(17);
      expect(targets.small).toEqual([]);

      for (const held of HELD_OUT) {
        const keys = page.locator(`#receipt-${held.receipt} dd.scanner-key`);
        expect(await keys.allTextContents()).toEqual([held.edge, held.expectedValue]);
        for (const box of [await keys.nth(0).boundingBox(), await keys.nth(1).boundingBox()]) {
          expect(box).not.toBeNull();
          expect(box!.x).toBeGreaterThanOrEqual(0);
          expect(box!.x + box!.width).toBeLessThanOrEqual(width + 0.5);
        }
      }
      const first = page.locator("#receipt-stub-receipt-1");
      await expect(first.locator("dd", { hasText: LONG_ODDS })).toHaveText(LONG_ODDS);
      // Long unbroken text is shown in full.
      await expect(first.getByText(`Источник: ${LONG_SOURCE}`, { exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { level: 3, name: `${LONG_TEAM} — Arsenal` })).toBeVisible();
    });
  }
}

for (const colorScheme of ["light", "dark"] as const) {
  test(`axe finds no violation in the ${colorScheme} theme on AVAILABLE, EMPTY with the plaque, UNAVAILABLE and all-stale`, async ({ page, request }) => {
    await page.emulateMedia({ colorScheme });
    for (const [scenario, heading] of [
      ["available", AVAILABLE_HEADING],
      ["empty-policy", EMPTY_HEADING],
      ["unavailable", UNAVAILABLE_HEADING],
      ["all-stale", AVAILABLE_HEADING],
    ] as const) {
      for (const width of [320, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await useScenario(request, scenario);
        await openScanner(page);
        await expect(page.locator("html")).toHaveAttribute("data-theme", colorScheme);
        await expect(page.getByRole("heading", { level: 2, name: heading, exact: true })).toBeVisible();
        expect(await violations(page), `${scenario}, ${width} px`).toEqual([]);
        await openAllDetails(page);
        expect(await violations(page), `${scenario} expanded, ${width} px`).toEqual([]);
        expect(await pageOverflow(page), `${scenario}, ${width} px`).toBeLessThanOrEqual(1);
      }
    }
  });
}

for (const width of [768, 900, 1023]) {
  test(`the seven navigation links share one row inside the ${width} px viewport`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openScanner(page);
    const links = page.getByRole("navigation", { name: "Основная навигация" }).getByRole("link");
    await expect(links).toHaveText(NAV_LABELS);
    await page.evaluate(() => document.fonts.ready);
    const boxes = await links.evaluateAll((elements) => elements.map((element) => {
      const box = element.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(element);
      return { label: element.textContent, top: Math.round(box.top), left: box.left, right: box.right, textLines: new Set(Array.from(range.getClientRects(), (line) => Math.round(line.top))).size };
    }));
    expect(new Set(boxes.map((box) => box.top)).size, JSON.stringify(boxes)).toBe(1);
    for (const box of boxes) {
      expect(box.left, `${box.label}`).toBeGreaterThanOrEqual(0);
      expect(box.right, `${box.label}`).toBeLessThanOrEqual(width);
      expect(box.textLines, `${box.label}`).toBe(1);
    }
    expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
    await expect(links.filter({ hasText: "Сканер" })).toHaveAttribute("aria-current", "page");
  });
}

test("EMPTY with zero receipts: its own heading and chip, the count 0, the way to the matches, no alert", async ({ page, request }) => {
  await useScenario(request, "empty-zero");
  await openScanner(page);
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { level: 2 })).toHaveText([EMPTY_HEADING]);
  await expect(main.locator(".state-chip")).toHaveText(["Пусто"]);
  await expect(main.getByRole("alert")).toHaveCount(0);
  await expect(main.locator(".scanner-counts dt")).toHaveText(["Проверено квитанций в окне"]);
  await expect(main.locator(".scanner-counts dd")).toHaveText(["0"]);
  await expect(main.getByRole("link", { name: "Открыть матчи" })).toHaveAttribute("href", "/fixtures");
  expect((await main.getByRole("link", { name: "Открыть матчи" }).boundingBox())!.height).toBeGreaterThanOrEqual(43.5);
  await expect(main.getByRole("complementary", { name: PLAQUE_LABEL })).toHaveCount(0);
  await expect(main.getByText(RISK_DISCLOSURE)).toBeVisible();
});

test("EMPTY with receipts: outcome counts in the fixed order and no policy plaque", async ({ page, request }) => {
  await useScenario(request, "empty-counts");
  await openScanner(page);
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { level: 2 })).toHaveText([EMPTY_HEADING]);
  await expect(main.locator(".state-chip")).toHaveText(["Пусто"]);
  await expect(main.getByRole("alert")).toHaveCount(0);
  await expect(main.locator(".scanner-counts dt")).toHaveText(["Проверено квитанций в окне", "недостаточно доказательств", "не прошло пороги политики"]);
  await expect(main.locator(".scanner-counts dd")).toHaveText(["7", "4", "3"]);
  await expect(main.getByText("Это не сбой данных.", { exact: false })).toBeVisible();
  await expect(main.getByRole("link", { name: "Открыть матчи" })).toHaveCount(0);
  await expect(main.getByRole("complementary", { name: PLAQUE_LABEL })).toHaveCount(0);
});

test("EMPTY with a policy mismatch: the information plaque is added inside the empty state", async ({ page, request }) => {
  await useScenario(request, "empty-policy");
  await openScanner(page);
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { level: 2 })).toHaveText([EMPTY_HEADING]);
  await expect(main.locator(".state-chip")).toHaveText(["Пусто"]);
  await expect(main.getByRole("alert")).toHaveCount(0);
  await expect(main.locator(".scanner-counts dd")).toHaveText(["5", "5"]);
  const plaque = main.getByRole("complementary", { name: PLAQUE_LABEL });
  await expect(plaque).toContainText("Это ограничение версии, а не отсутствие расхождений с рынком.");
  await expect(plaque.getByRole("link", { name: "Методология и ограничения" })).toHaveAttribute("href", "/methodology#limitations");
});

for (const scenario of ["unavailable", "invalid-shape"]) {
  test(`${scenario}: the page fails closed to UNAVAILABLE with an alert and no counts`, async ({ page, request }) => {
    await useScenario(request, scenario);
    await openScanner(page);
    const main = page.getByRole("main");
    await expect(main.getByRole("heading", { level: 2 })).toHaveText([UNAVAILABLE_HEADING]);
    await expect(main.locator(".state-chip")).toHaveText(["Недоступно"]);
    await expect(main.getByRole("alert")).toHaveCount(1);
    await expect(main.getByRole("alert")).toContainText("Это не значит, что кандидатов нет.");
    await expect(main.getByRole("link", { name: "Обновить страницу" })).toHaveAttribute("href", "/scanner");
    await expect(main.locator("dl, li.scanner-row, .note-strip")).toHaveCount(0);
    await expect(main.getByText("Это не сбой данных.", { exact: false })).toHaveCount(0);
    await expect(main.getByText(RISK_DISCLOSURE)).toBeVisible();
  });
}

test("truncated list: the chip and the amended sentence with the shown count, the total and the limit", async ({ page, request }) => {
  await useScenario(request, "truncated");
  await openScanner(page);
  const main = page.getByRole("main");
  await expect(main.locator(".note-strip .state-chip")).toHaveText("Показана часть списка");
  await expect(main.locator(".note-strip", { has: page.locator(".state-chip") })).toContainText(
    "Показаны кандидаты первых по времени матчей: 4 из 250 (лимит списка — 200). Более поздние матчи в список не вошли.",
  );
  await expect(main.locator("li.scanner-row")).toHaveCount(4);
  await expect(main.getByRole("alert")).toHaveCount(0);
});

test("all-stale: the main list says so and the stale block is open", async ({ page, request }) => {
  await useScenario(request, "all-stale");
  await openScanner(page);
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { level: 2 })).toHaveText([AVAILABLE_HEADING, "Устаревшие коэффициенты (5)"]);
  await expect(main.getByText(ALL_STALE_LINE, { exact: true })).toBeVisible();
  await expect(main.locator("details.scanner-stale")).toHaveAttribute("open", "");
  await expect(main.locator("details.scanner-stale li.scanner-row:visible")).toHaveCount(5);
  await expect(main.getByRole("alert")).toHaveCount(0);
});

test("available: the stale block starts closed and opens from the keyboard with Enter and Space", async ({ page }) => {
  await openScanner(page);
  const stale = page.locator("details.scanner-stale");
  const summary = stale.locator(":scope > summary");
  const row = page.locator("#receipt-stub-receipt-5");
  await expect(summary).toHaveText("Показать устаревшие строки: 1");
  await expect(stale).not.toHaveAttribute("open", "");
  await expect(row).toBeHidden();
  await expect(page.getByText(ALL_STALE_LINE, { exact: true })).toHaveCount(0);

  await summary.focus();
  await page.keyboard.press("Enter");
  await expect(stale).toHaveAttribute("open", "");
  await expect(row).toBeVisible();
  await expect(row).toHaveAttribute("data-freshness", "STALE");
  await expect(row.locator(".state-chip")).toHaveText(["Коэффициенты устарели"]);
  await page.keyboard.press("Enter");
  await expect(stale).not.toHaveAttribute("open", "");
  await page.keyboard.press("Space");
  await expect(stale).toHaveAttribute("open", "");
  await expect(row).toBeVisible();
});

test("keyboard: a row is walked as details summary, match page, receipt, and link names carry their suffixes", async ({ page }) => {
  await openScanner(page);
  const row = page.locator("#receipt-stub-receipt-1");
  const summary = row.locator("details.scanner-detail > summary");
  const pageLink = row.locator(".scanner-links a").nth(0);
  const receiptLink = row.locator(".scanner-links a").nth(1);

  await page.locator(".scanner-match-head h3 a").first().focus();
  await page.keyboard.press("Tab");
  await expect(summary).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(pageLink).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(receiptLink).toBeFocused();

  await expect(pageLink).toHaveAccessibleName(`Страница матча ${LONG_TEAM} — Arsenal, 1X2, Хозяева`);
  await expect(receiptLink).toHaveAccessibleName("Квитанция (JSON) 1X2, Хозяева; откроется в новой вкладке");
  await expect(pageLink).toHaveAttribute("href", "/fixtures/stub-fixture-1");
  await expect(receiptLink).toHaveAttribute("href", "/internal-api/value/stub-receipt-1");
  await expect(receiptLink).toHaveAttribute("target", "_blank");
  await expect(receiptLink).toHaveAttribute("rel", "noopener noreferrer");

  await summary.focus();
  await page.keyboard.press("Enter");
  await expect(row.locator("details.scanner-detail")).toHaveAttribute("open", "");
  await expect(row.locator("details.scanner-detail code").first()).toHaveText("stub-receipt-1");
});

test("keyboard: the tab order of the whole page content follows the document order", async ({ page }) => {
  await openScanner(page);
  const expected = await page.locator("main").evaluate((main) => {
    const targets = Array.from(main.querySelectorAll<HTMLElement>("a[href], summary")).filter((element) => element.checkVisibility());
    targets.forEach((element, index) => element.setAttribute("data-walk", String(index)));
    return targets.map((_, index) => String(index));
  });
  // How-to-read, four visible rows with their match headings, and the stale summary.
  expect(expected.length).toBe(1 + 2 + 4 * 3 + 1);
  await page.locator("main").focus();
  const walked: Array<string | null> = [];
  for (let step = 0; step < expected.length; step += 1) {
    await page.keyboard.press("Tab");
    walked.push(await page.evaluate(() => document.activeElement?.getAttribute("data-walk") ?? null));
  }
  expect(walked).toEqual(expected);
  await expect(page.locator("main [tabindex]:not([tabindex='-1'])")).toHaveCount(0);
});

test("200 percent text zoom at 320 px keeps the page inside the viewport with its links", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await openScanner(page);
  const row = page.locator("#receipt-stub-receipt-1");
  const check = async (step: string) => {
    expect(await pageOverflow(page), step).toBeLessThanOrEqual(1);
    await expect(row.getByRole("link", { name: /^Страница матча/ }), step).toBeVisible();
    await expect(row.getByRole("link", { name: /^Квитанция \(JSON\)/ }), step).toBeVisible();
    expect(await outsideViewport(page), step).toEqual([]);
  };

  await page.locator("html").evaluate((element) => { element.style.fontSize = "200%"; });
  await openAllDetails(page);
  await check("root font size 200%");

  // The scanner sizes are in px, so the root setting alone does not enlarge them: double every computed size as well.
  await page.locator("main").evaluate((main) => {
    const elements = [main, ...main.querySelectorAll<HTMLElement>("*")] as HTMLElement[];
    const sizes = elements.map((element) => Number.parseFloat(getComputedStyle(element).fontSize));
    elements.forEach((element, index) => { element.style.fontSize = `${sizes[index]! * 2}px`; });
  });
  expect(await row.locator("dd.scanner-key").first().evaluate((element) => getComputedStyle(element).fontSize)).toBe("40px");
  await check("every font size doubled");
});

for (const scenario of ["available-edge-descending", "available-edge-ascending"]) {
  test(`no ranking (${scenario}): the document order is the API order and there is nothing to sort or filter with`, async ({ page, request }) => {
    await useScenario(request, scenario);
    const body = await (await request.get(`${stubOrigin}/value/scanner`)).json() as { items: Array<{ receiptId: string; edge: string }> };
    const edges = body.items.map((entry) => Number(entry.edge));
    expect(edges).toEqual([...edges].sort((left, right) => (scenario.endsWith("descending") ? right - left : left - right)));
    await openScanner(page);
    const rows = page.locator("main li.scanner-row");
    await expect(rows).toHaveCount(body.items.length);
    expect(await rows.evaluateAll((elements) => elements.map((element) => element.id))).toEqual(body.items.map((entry) => `receipt-${entry.receiptId}`));
    for (const entry of body.items) await expect(page.locator(`#receipt-${entry.receiptId} dd.scanner-key`).first()).toHaveText(entry.edge);
    await expect(page.locator("main :is(table, th, [aria-sort], button, select, input, textarea)")).toHaveCount(0);
  });
}

test("a source label that looks like a script is inert text", async ({ page }) => {
  const dialogs: string[] = [];
  page.on("dialog", (dialog) => { dialogs.push(dialog.message()); void dialog.dismiss(); });
  await openScanner(page);
  await page.waitForLoadState("load");
  await expect(page.locator("#receipt-stub-receipt-2").getByText(`Источник: ${SCRIPT_SOURCE}`, { exact: true })).toBeVisible();
  await expect(page.locator("main script")).toHaveCount(0);
  expect(await page.evaluate(() => "__scannerStubInjected" in window)).toBe(false);
  expect(dialogs).toEqual([]);
});
