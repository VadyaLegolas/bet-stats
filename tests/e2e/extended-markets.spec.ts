import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";

import { buildTeamEvidence, type EvidenceMatch, type ForecastResponseDto } from "../../packages/domain/src/index";
import { createPrismaClient } from "../../packages/database/src/index";
import { seedCustomMatrixForecast, seedLegacyForecastVariants, type LegacyForecastVariants } from "../helpers/extended-markets-seed";

/*
 * Phase 14, plan 14-08: the interaction and accessibility contract of the Asian handicap and exact-score sections,
 * on the real stack (PostgreSQL, Nest and Next, no request interception), like forecast-workbench.spec.ts.
 *
 * One fixture carries three snapshots of one match: a forecast issued through the API (score matrix persisted, source
 * PERSISTED), a legacy snapshot that reproduces the stored markets (REDERIVED) and a legacy snapshot that no longer
 * does (UNAVAILABLE). The legacy rows are new INSERTs; nothing existing is updated.
 */

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const API_ORIGIN = "http://127.0.0.1:3001";
const run = `${process.pid}-${Date.now()}`;
const fixtureId = `live-extended-fixture-${run}`;
const homeTeamId = `live-extended-home-${run}`;
const awayTeamId = `live-extended-away-${run}`;
const kickoff = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
const preMatchCutoff = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
const rederivedCutoff = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
const unavailableCutoff = new Date(Date.now() - 11 * 60 * 60 * 1000).toISOString();
const edgeLowCutoff = new Date(Date.now() - 10 * 60 * 60 * 1000).toISOString();
const edgeHighCutoff = new Date(Date.now() - 9 * 60 * 60 * 1000).toISOString();

const UNAVAILABLE_SENTENCE = "Для этого прогноза расширенные рынки недоступны: матрица счёта не была сохранена.";
const DISCLOSURE = "Вероятности — это оценки, а не гарантии. Вы можете потерять деньги при ставках.";
const AH_TABLE = "Азиатский гандикап — таблица линий";
const MINUS = "−";

let issuedForecast: ForecastResponseDto;
let legacy: LegacyForecastVariants;
/** Persisted lopsided matrices: the main line sits at -2.5 (home-heavy, with a zero-probability 0:3 cell) and at +2.5. */
let edgeLowId: string;
let edgeHighId: string;

function eligibilityHeaders() {
  return {
    "x-eligibility-region": "PL",
    "x-age-acknowledged": "true",
    "x-eligibility-checked-at": new Date().toISOString(),
  };
}

function matches(teamId: string): EvidenceMatch[] {
  return Array.from({ length: 10 }, (_, index) => {
    const instant = new Date(Date.UTC(2026, 7, 20 + index, 12)).toISOString();
    return {
      fixtureId: `${teamId}-history-${index}`,
      kickoffUtc: instant, effectiveAt: instant, observedAt: instant, sourceUpdatedAt: null,
      payloadHash: `${teamId}-payload-${index}`, payloadBytes: 30 + index, teamId,
      opponentId: `opponent-${index}`, venue: index % 2 === 0 ? "HOME" : "AWAY",
      goalsFor: 1 + (index % 2), goalsAgainst: index % 3 === 0 ? 1 : 0, points: index % 3 === 0 ? 1 : 3,
    };
  });
}

async function seedEvidence(): Promise<void> {
  const prisma = createPrismaClient(databaseUrl!);
  try {
    const leagueId = `live-extended-league-${run}`;
    const seasonId = `live-extended-season-${run}`;
    const syncRunId = `live-extended-run-${run}`;
    await prisma.league.create({ data: { id: leagueId, name: "Live Extended League", countryCode: "PL" } });
    await prisma.season.create({ data: { id: seasonId, leagueId, label: "2026/27", startsOn: new Date("2026-07-01"), endsOn: new Date("2027-06-30") } });
    await prisma.team.createMany({ data: [
      { id: homeTeamId, name: "Extended Home", normalizedName: `extended-home-${run}`, countryCode: "PL" },
      { id: awayTeamId, name: "Extended Away", normalizedName: `extended-away-${run}`, countryCode: "PL" },
    ] });
    await prisma.fixture.create({ data: { id: fixtureId, leagueId, seasonId, homeTeamId, awayTeamId, kickoffUtc: new Date(kickoff), status: "SCHEDULED" } });
    await prisma.syncRun.create({ data: {
      id: syncRunId, logicalKey: syncRunId, revision: 1, provider: "project-live", endpointFamily: "RESULTS", lane: "critical",
      windowFrom: new Date("2026-08-01T00:00:00.000Z"), windowTo: new Date(preMatchCutoff), state: "SUCCEEDED", correlationId: syncRunId,
      expectedUnits: 1, completedUnits: 1, expectedCaptures: 1, completedCaptures: 1,
      completionManifest: { expectedUnits: ["results"], completedUnits: ["results"], expectedCaptures: ["capture"], completedCaptures: ["capture"] },
    } });
    for (const teamId of [homeTeamId, awayTeamId]) {
      const evidence = buildTeamEvidence({ teamId, opponentId: "shared-opponent", asOf: preMatchCutoff, matches: matches(teamId).map((match) => ({ ...match, opponentId: "shared-opponent" })) });
      const componentNames = ["form5", "form10", "elo", "homeStrength", "awayStrength", "goalRates", "restDays", "h2h"] as const;
      const components = componentNames.map((component) => {
        const item = evidence[component];
        return { component, value: item.value as never, sampleSize: item.sampleSize, limitation: item.limitation, sourceTimes: item.sourceRefs as never };
      });
      await prisma.evidenceBuild.create({ data: {
        id: `${teamId}-build`, teamId, cutoff: new Date(preMatchCutoff), configVersion: "evidence-v1", configHash: `config-${teamId}`, syncRunId,
        state: "PUBLISHED", publishedAt: new Date(preMatchCutoff),
        components: { create: [...components, { component: "receipt", value: evidence.receipt as never, sampleSize: evidence.receipt.inputs.length, limitation: null, sourceTimes: evidence.receipt.inputs as never }] },
      } });
    }
  } finally { await prisma.$disconnect(); }
}

async function publishForecasts(request: APIRequestContext): Promise<void> {
  const response = await request.post(`${API_ORIGIN}/fixtures/${fixtureId}/forecasts`, { headers: eligibilityHeaders(), data: { kind: "PRE_MATCH", cutoff: preMatchCutoff } });
  const body = await response.text();
  expect(response.status(), body).toBe(201);
  issuedForecast = JSON.parse(body) as ForecastResponseDto;
  const prisma = createPrismaClient(databaseUrl!);
  try {
    legacy = await seedLegacyForecastVariants(prisma, issuedForecast, { prefix: `live-extended-${run}`, rederivedCutoff, unavailableCutoff });
    edgeLowId = await seedCustomMatrixForecast(prisma, issuedForecast, { id: `live-extended-${run}-edge-low`, revision: 3, supersedesForecastId: legacy.unavailableId, cutoff: edgeLowCutoff, expectedGoals: { home: 4, away: 0.2 }, zeroCell: [0, 3] });
    edgeHighId = await seedCustomMatrixForecast(prisma, issuedForecast, { id: `live-extended-${run}-edge-high`, revision: 4, supersedesForecastId: edgeLowId, cutoff: edgeHighCutoff, expectedGoals: { home: 0.2, away: 4 } });
  } finally { await prisma.$disconnect(); }
}

/** The API view of each snapshot decides the state the page must draw: the spec proves the three variants really differ. */
async function extendedState(request: APIRequestContext, forecastId: string): Promise<{ state: string; source?: string }> {
  const response = await request.get(`${API_ORIGIN}/fixtures/${fixtureId}/forecasts/${forecastId}/extended-markets`, { headers: eligibilityHeaders() });
  expect(response.ok()).toBeTruthy();
  return await response.json() as { state: string; source?: string };
}

async function openForecast(page: Page, forecastId: string): Promise<void> {
  await page.goto(`/fixtures/${fixtureId}`);
  await page.getByLabel("Снимок прогноза").selectOption(forecastId);
}

function lineCell(row: Locator): Locator { return row.locator('[data-evidence-field="line"]'); }

async function seriousViolations(page: Page) {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  return result.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical").map((violation) => ({ id: violation.id, impact: violation.impact, nodes: violation.nodes.slice(0, 3).map((node) => node.target) }));
}

/** Page-level sideways scroll, with the widest offenders named so a failure points at the element, not at a number. */
async function expectNoPageOverflow(page: Page, label: string): Promise<void> {
  const overflow = await page.evaluate(() => {
    const viewport = document.documentElement.clientWidth;
    /* An element contributes to the page scroll width only when no ancestor between it and the page clips it. */
    const clippedByAncestor = (element: HTMLElement) => {
      for (let ancestor = element.parentElement; ancestor && ancestor !== document.documentElement; ancestor = ancestor.parentElement) {
        if (getComputedStyle(ancestor).overflowX !== "visible") return true;
      }
      return false;
    };
    return {
      excess: document.documentElement.scrollWidth - viewport,
      offenders: [...document.querySelectorAll<HTMLElement>("body *")]
        .filter((element) => (element.getBoundingClientRect().right > viewport + 1 || (element.scrollWidth > element.clientWidth + 1 && getComputedStyle(element).overflowX === "visible" && element.getBoundingClientRect().left + element.scrollWidth > viewport + 1)) && !clippedByAncestor(element))
        .slice(0, 8)
        .map((element) => ({ tag: element.tagName, id: element.id, className: String(element.className).slice(0, 60), text: element.innerText?.slice(0, 50), right: Math.round(element.getBoundingClientRect().right) })),
    };
  });
  expect(overflow.excess, `${label}: ${JSON.stringify(overflow.offenders)}`).toBeLessThanOrEqual(1);
}

/**
 * Boxes of the exact-score grid caption and axis headers against the visible width of their scroll region.
 * Page scrollWidth alone cannot see this defect: the region clips the table, so a caption wider than the region, a
 * row-axis header stacked one letter per line and a column-axis header pushed past the edge all leave the page intact.
 * Returns one message per violation, with numbers, so a failure names the element and the value.
 */
async function measureExactGrid(page: Page): Promise<string[]> {
  return await page.locator("#exact-score .evidence-table-scroll").evaluate((region) => {
    const problems: string[] = [];
    region.scrollLeft = 0;
    const regionBox = region.getBoundingClientRect();
    const left = regionBox.left;
    const right = regionBox.left + region.clientWidth;
    const textBox = (element: Element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      return range.getBoundingClientRect();
    };
    const lineCount = (element: Element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      return new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size;
    };
    const caption = region.querySelector("caption");
    const corner = region.querySelector("thead tr:first-child > th:first-child");
    const otherLabel = region.querySelector("tfoot th");
    const columnAxis = region.querySelector('thead th[scope="colgroup"]');
    if (!caption || !corner || !otherLabel || !columnAxis) return ["grid parts are missing: caption, corner, tfoot th or colgroup header"];

    const captionBox = caption.getBoundingClientRect();
    if (captionBox.left < left - 1 || captionBox.right > right + 1) problems.push(`caption box ${Math.round(captionBox.left)}..${Math.round(captionBox.right)} is outside the visible ${Math.round(left)}..${Math.round(right)}`);
    const textAlign = getComputedStyle(caption).textAlign;
    if (textAlign !== "start" && textAlign !== "left") problems.push(`caption text-align is ${textAlign}, expected start or left`);
    const cornerLines = lineCount(corner);
    if (cornerLines > 2) problems.push(`row-axis header "${corner.textContent}" takes ${cornerLines} lines, expected at most 2`);
    const otherLines = lineCount(otherLabel);
    if (otherLines > 3) problems.push(`tfoot header "${otherLabel.textContent}" takes ${otherLines} lines, expected at most 3`);
    const axisText = textBox(columnAxis);
    if (axisText.left < left - 1 || axisText.right > right + 1) problems.push(`column-axis text "${columnAxis.textContent}" ${Math.round(axisText.left)}..${Math.round(axisText.right)} is outside the visible ${Math.round(left)}..${Math.round(right)}`);
    const axisLines = lineCount(columnAxis);
    if (axisLines !== 1) problems.push(`column-axis header "${columnAxis.textContent}" takes ${axisLines} lines, expected 1`);
    return problems;
  });
}

/**
 * With the region scrolled to its end, the pinned labels (corner cell, first row header, tfoot header) must still sit at
 * the region's left edge and must be the topmost element at their centre, not covered by the text of a body cell.
 */
async function measureStuckHeaders(page: Page): Promise<string[]> {
  return await page.locator("#exact-score .evidence-table-scroll").evaluate((region) => {
    const problems: string[] = [];
    region.scrollLeft = region.scrollWidth;
    const left = region.getBoundingClientRect().left;
    const cells: Array<[string, Element | null]> = [
      ["corner cell", region.querySelector("thead tr:first-child > th:first-child")],
      ["first row header", region.querySelector("tbody th")],
      ["tfoot header", region.querySelector("tfoot th")],
    ];
    for (const [name, cell] of cells) {
      if (!cell) { problems.push(`${name} is missing`); continue; }
      const box = cell.getBoundingClientRect();
      if (Math.abs(box.left - left) > 1) problems.push(`${name} left edge ${Math.round(box.left)} is ${Math.round(box.left - left)} px from the region edge ${Math.round(left)}`);
      const x = box.left + box.width / 2;
      const y = box.top + box.height / 2;
      if (x < 0 || y < 0 || x > document.documentElement.clientWidth || y > document.documentElement.clientHeight) { problems.push(`${name} centre ${Math.round(x)},${Math.round(y)} is outside the viewport`); continue; }
      const top = document.elementFromPoint(x, y);
      if (!top || (top !== cell && !cell.contains(top))) problems.push(`${name} is covered by <${top?.tagName.toLowerCase()} class="${top ? String(top.className) : ""}">`);
    }
    region.scrollLeft = 0;
    return problems;
  });
}

test.beforeAll(async ({ request }) => {
  await seedEvidence();
  await publishForecasts(request);
  expect(await extendedState(request, issuedForecast.id)).toMatchObject({ state: "AVAILABLE", source: "PERSISTED" });
  expect(await extendedState(request, legacy.rederivedId)).toMatchObject({ state: "AVAILABLE", source: "REDERIVED" });
  expect((await extendedState(request, legacy.unavailableId)).state).toBe("UNAVAILABLE");
  expect(await extendedState(request, edgeLowId)).toMatchObject({ state: "AVAILABLE", source: "PERSISTED" });
  expect(await extendedState(request, edgeHighId)).toMatchObject({ state: "AVAILABLE", source: "PERSISTED" });
});

test.describe("extended markets on a persisted forecast", () => {
  test("shows five rows, one main line, the side toggle and the expander with focus kept", async ({ page }) => {
    await openForecast(page, issuedForecast.id);
    const ah = page.locator("#asian-handicap");
    const grid = page.locator("#exact-score");
    await expect(ah.getByRole("heading", { level: 3, name: "Азиатский гандикап" })).toBeVisible();
    await expect(grid.getByRole("heading", { level: 3, name: "Точный счёт" })).toBeVisible();

    const table = ah.getByRole("table", { name: AH_TABLE });
    const rows = table.locator("tbody tr");
    await expect(rows).toHaveCount(5);
    const main = table.locator('tbody tr[aria-current="true"]');
    await expect(main).toHaveCount(1);
    await expect(main).toContainText("Главная линия");

    // The main line is marked by text and a rail, not by colour alone.
    await expect(lineCell(main).getByText("Главная линия")).toBeVisible();
    const rail = await lineCell(main).evaluate((cell) => getComputedStyle(cell).boxShadow);
    expect(rail).not.toBe("none");

    const homeLabel = /Хозяева\s+\S+/u.exec(await lineCell(main).innerText())?.[0];
    expect(homeLabel).toBeTruthy();

    const home = ah.getByRole("button", { name: "Хозяева", exact: true });
    const away = ah.getByRole("button", { name: "Гости", exact: true });
    await expect(home).toHaveAttribute("aria-pressed", "true");
    await expect(away).toHaveAttribute("aria-pressed", "false");
    await away.click();
    await expect(away).toHaveAttribute("aria-pressed", "true");
    await expect(home).toHaveAttribute("aria-pressed", "false");
    await expect(rows).toHaveCount(5);
    await expect(main).toHaveCount(1);
    await expect(lineCell(main)).toContainText("Гости");
    await expect(lineCell(main)).toContainText(`(${homeLabel})`);
    await expect(lineCell(main)).toContainText("Главная линия");
    await home.click();
    await expect(lineCell(main)).not.toContainText("(Хозяева");

    const expander = ah.locator('button[aria-controls="ah-lines"]');
    await expect(expander).toHaveAttribute("aria-expanded", "false");
    await expander.click();
    await expect(expander).toHaveAttribute("aria-expanded", "true");
    await expect(expander).toBeFocused();
    await expect(rows).toHaveCount(21);
    await expect(main).toHaveCount(1);
    await expect(ah.locator('p[role="status"]')).toContainText("Показаны все 21 линия");
    await expect(ah.getByText("Показаны все 21 линия.")).toBeVisible();
    await expander.click();
    await expect(expander).toHaveAttribute("aria-expanded", "false");
    await expect(expander).toBeFocused();
    await expect(rows).toHaveCount(5);
  });

  test("draws 16 score cells, the other-score row, the calibration chip and the persistent disclosure", async ({ page }) => {
    await openForecast(page, issuedForecast.id);
    const grid = page.locator("#exact-score");
    const table = grid.getByRole("table", { name: "Точный счёт — таблица вероятностей" }).or(grid.locator("table"));
    await expect(grid.locator("tbody td")).toHaveCount(16);
    await expect(grid.locator("tfoot").getByRole("rowheader", { name: "Любой другой счёт" })).toBeVisible();
    await expect(grid.locator("tfoot td")).toHaveCount(1);
    await expect(table.first()).toBeVisible();
    await expect(grid).toContainText("уже учтён нормировкой на сохранённую массу");
    await expect(grid).not.toContainText("входит в строку");
    await expect(page.locator("#asian-handicap .state-chip").getByText("Без калибровки", { exact: true })).toBeVisible();
    await expect(grid.locator(".state-chip").getByText("Без калибровки", { exact: true })).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Раскрытие рисков ставок" })).toContainText(DISCLOSURE);
    await expect(page.getByRole("complementary", { name: "Раскрытие рисков ставок" })).toBeVisible();
    await expect(page.locator("#asian-handicap").getByRole("link", { name: "Как это считается" })).toHaveAttribute("href", "/methodology#extended-markets");
    await expect(page.locator("#asian-handicap")).toContainText("сохранена при выпуске прогноза");
  });

  test("a re-derived legacy snapshot is drawn from the verified matrix with its own source line", async ({ page }) => {
    await openForecast(page, legacy.rederivedId);
    const ah = page.locator("#asian-handicap");
    await expect(ah.getByRole("table", { name: AH_TABLE }).locator("tbody tr")).toHaveCount(5);
    await expect(ah).toContainText("воспроизведена по сохранённым параметрам и сверена с рынками прогноза");
    await expect(page.locator("#exact-score tbody td")).toHaveCount(16);
  });
});

test.describe("extended markets on a snapshot that cannot be verified", () => {
  test("both sections show the neutral status, no table and a disabled comparison with the reason", async ({ page }) => {
    await openForecast(page, legacy.unavailableId);
    for (const id of ["#asian-handicap", "#exact-score"]) {
      const section = page.locator(id);
      const notice = section.locator('[data-extended-state="UNAVAILABLE"]');
      await expect(notice).toHaveAttribute("role", "status");
      await expect(notice).toContainText(UNAVAILABLE_SENTENCE);
      await expect(notice).toContainText("Три основных рынка этого прогноза (1X2, тотал 2.5, обе забьют) не затронуты.");
      await expect(section.getByRole("table")).toHaveCount(0);
      await expect(section.getByRole("button")).toHaveCount(0);
    }
    await expect(page.getByRole("heading", { level: 3, name: "Замороженный прогноз" })).toBeVisible();

    for (const family of ["ASIAN_HANDICAP", "EXACT_SCORE"]) {
      await page.locator("#market").selectOption(family);
      const compare = page.getByRole("button", { name: "Сравнить точные снимки" });
      await expect(compare).toBeDisabled();
      await expect(compare).toHaveAttribute("aria-describedby", "compare-blocked");
      await expect(page.locator("#compare-blocked")).toBeVisible();
      await expect(page.locator("#compare-blocked")).toContainText("Сравнение недоступно: для этого прогноза расширенные рынки недоступны.");
    }
  });
});

test.describe("manual odds form for the new markets", () => {
  test("Asian handicap: no default line, inputs hidden until a line is chosen, signed labels", async ({ page }) => {
    await openForecast(page, issuedForecast.id);
    await page.locator("#market").selectOption("ASIAN_HANDICAP");
    const line = page.locator("#ah-line");
    await expect(line).toHaveValue("");
    await expect(line.locator("option").first()).toHaveText("Выберите линию");
    await expect(line.locator("option")).toHaveCount(22);
    await expect(page.locator('input[id^="odds-"]')).toHaveCount(0);
    await expect(page.getByText("Выберите линию: для каждой линии сохраняется отдельная полная книга из двух сторон.")).toBeVisible();

    await page.getByRole("button", { name: "Сохранить полную неизменяемую книгу коэффициентов" }).click();
    await expect(page.locator("#ah-line-error")).toHaveText(/Выберите линию гандикапа\./u);
    await expect(line).toBeFocused();
    await expect(line).toHaveAttribute("aria-invalid", "true");

    await line.selectOption("-0.75");
    await expect(page.locator("#ah-line-error")).toHaveCount(0);
    await expect(page.getByLabel(`Десятичный коэффициент: Хозяева ${MINUS}0.75`)).toBeVisible();
    await expect(page.getByLabel("Десятичный коэффициент: Гости +0.75")).toBeVisible();
    await expect(page.locator('input[id^="odds-"]')).toHaveCount(2);
    await expect(page.getByText("На четвертной линии ставка делится между")).toBeVisible();
  });

  test("exact score: 17 labelled fields, an empty submit focuses the first one and counts the gaps", async ({ page }) => {
    await openForecast(page, issuedForecast.id);
    await page.locator("#market").selectOption("EXACT_SCORE");
    const fields = page.locator(".market-score-fields input");
    await expect(fields).toHaveCount(17);
    const scores = [0, 1, 2, 3].flatMap((home) => [0, 1, 2, 3].map((away) => `${home}:${away}`));
    for (const score of scores) await expect(page.locator(".market-score-fields").getByLabel(`Счёт ${score}`, { exact: true })).toHaveCount(1);
    await expect(page.locator(".market-score-fields").getByLabel("Любой другой счёт", { exact: true })).toHaveCount(1);

    await page.getByLabel("Метка букмекера или источника").fill("Live exact source");
    const save = page.getByRole("button", { name: "Сохранить полную неизменяемую книгу коэффициентов" });
    await save.click();
    await expect(page.getByRole("status").filter({ hasText: "Не заполнено полей: 17 из 17" })).toBeVisible();
    await expect(page.locator("#odds-0-0")).toBeFocused();
    await expect(page.locator("#odds-0-0")).toHaveAttribute("aria-invalid", "true");

    await page.locator("#odds-0-0").fill("9.5");
    await save.click();
    await expect(page.getByRole("status").filter({ hasText: "Не заполнено полей: 16 из 17" })).toBeVisible();
    await expect(page.locator("#odds-0-1")).toBeFocused();
  });

  test("saves a full Asian handicap book, compares it by keyboard and shows the five-outcome breakdown", async ({ page }) => {
    await openForecast(page, issuedForecast.id);
    await page.locator("#market").selectOption("ASIAN_HANDICAP");
    await page.locator("#ah-line").selectOption("-0.75");
    await page.getByLabel("Метка букмекера или источника").fill("Live AH source");
    await page.getByLabel(`Десятичный коэффициент: Хозяева ${MINUS}0.75`).fill("1.95");
    await page.getByLabel("Десятичный коэффициент: Гости +0.75").fill("1.95");
    await page.getByRole("button", { name: "Сохранить полную неизменяемую книгу коэффициентов" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Неизменяемый снимок коэффициентов" })).toBeVisible({ timeout: 30_000 });

    const comparison = page.locator("#comparison-heading").locator("xpath=..");
    await expect(comparison.getByRole("table", { name: "Полные данные ручного сравнения коэффициентов" })).toBeVisible();
    await expect(comparison).toContainText("Перекрытие (приближённо)");

    // Keyboard only: the selection select is followed by the compare button, which Enter activates.
    await page.locator("#selection").focus();
    await page.keyboard.press("Tab");
    const compare = page.getByRole("button", { name: "Сравнить точные снимки" });
    await expect(compare).toBeFocused();
    const responsePromise = page.waitForResponse((response) => response.url().includes(`/internal-api/fixtures/${fixtureId}/value`) && response.request().method() === "POST");
    await page.keyboard.press("Enter");
    expect((await responsePromise).ok()).toBeTruthy();

    const outcome = page.locator("section.outcome-card");
    await expect(outcome.getByRole("heading", { level: 4, name: "Разбор ожидаемого value по пяти исходам" })).toBeVisible();
    const breakdown = outcome.getByRole("table");
    await expect(breakdown.locator("tbody tr")).toHaveCount(5);
    await expect(breakdown.locator("tfoot")).toContainText("Итого — ожидаемое value");
    await expect(breakdown.locator("caption")).toContainText("push-aware-ev-v1");
    await expect(outcome.getByText("При азиатском гандикапе ставка может быть возвращена (пуш)", { exact: false })).toBeVisible();
  });
});

test.describe("keyboard and accessibility", () => {
  test("walks the side toggle, the expander, the line select, 17 fields and reaches the comparison button state", async ({ page }) => {
    await openForecast(page, issuedForecast.id);
    const ah = page.locator("#asian-handicap");
    const home = ah.getByRole("button", { name: "Хозяева", exact: true });
    const away = ah.getByRole("button", { name: "Гости", exact: true });
    const expander = ah.locator('button[aria-controls="ah-lines"]');

    await home.focus();
    await page.keyboard.press("Tab");
    await expect(away).toBeFocused();
    await page.keyboard.press("Space");
    await expect(away).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Tab");
    await expect(expander).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(expander).toHaveAttribute("aria-expanded", "true");
    await expect(expander).toBeFocused();
    await expect(ah.getByRole("table", { name: AH_TABLE }).locator("tbody tr")).toHaveCount(21);

    await page.locator("#market").selectOption("ASIAN_HANDICAP");
    const line = page.locator("#ah-line");
    await line.focus();
    await page.keyboard.press("ArrowDown");
    await expect(line).not.toHaveValue("");

    await page.locator("#market").selectOption("EXACT_SCORE");
    const order = [0, 1, 2, 3].flatMap((homeGoals) => [0, 1, 2, 3].map((awayGoals) => `odds-${homeGoals}-${awayGoals}`));
    await page.locator(`#${order[0]}`).focus();
    for (const id of order.slice(1)) {
      await page.keyboard.press("Tab");
      await expect(page.locator(`#${id}`)).toBeFocused();
    }
    await page.keyboard.press("Tab");
    await expect(page.locator("#odds-OTHER")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Сохранить полную неизменяемую книгу коэффициентов" })).toBeFocused();
    await expect(page.getByRole("button", { name: "Сравнить точные снимки" })).toBeDisabled();
  });

  test("axe finds no serious or critical violation with an available and an unavailable forecast, in light and dark", async ({ page }) => {
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await openForecast(page, issuedForecast.id);
      await expect(page.locator("#asian-handicap").getByRole("table", { name: AH_TABLE })).toBeVisible();
      expect(await seriousViolations(page), `available, ${colorScheme}`).toEqual([]);
      await page.locator("#asian-handicap").locator('button[aria-controls="ah-lines"]').click();
      expect(await seriousViolations(page), `available expanded, ${colorScheme}`).toEqual([]);

      await openForecast(page, legacy.unavailableId);
      await expect(page.locator("#asian-handicap").locator('[data-extended-state="UNAVAILABLE"]')).toBeVisible();
      expect(await seriousViolations(page), `unavailable, ${colorScheme}`).toEqual([]);
    }
  });
});

test.describe("visual backstops", () => {
  test("tables scroll inside their own region at 320, 768 and 1440 px and the page never scrolls sideways", async ({ page }) => {
    for (const width of [320, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await openForecast(page, issuedForecast.id);
      await expect(page.locator("#exact-score tbody td")).toHaveCount(16);
      await expectNoPageOverflow(page, `page overflow at ${width}`);

      const scroller = page.locator("#exact-score .evidence-table-scroll");
      await expect(scroller).toHaveAttribute("role", "region");
      await expect(scroller).toHaveAttribute("aria-label", "Точный счёт — таблица вероятностей");
      const metrics = await scroller.evaluate((element) => ({ scrollWidth: element.scrollWidth, clientWidth: element.clientWidth, overflowX: getComputedStyle(element).overflowX }));
      expect(["auto", "scroll"]).toContain(metrics.overflowX);
      if (width === 320) expect(metrics.scrollWidth).toBeGreaterThan(metrics.clientWidth);

      const stickyHeader = await page.locator("#exact-score tbody th").first().evaluate((cell) => getComputedStyle(cell).position);
      expect(stickyHeader).toBe("sticky");

      if (width >= 768) {
        const ahScroller = page.locator("#asian-handicap .evidence-desktop");
        await expect(ahScroller).toBeVisible();
        expect(["auto", "scroll"]).toContain(await ahScroller.evaluate((element) => getComputedStyle(element).overflowX));
        expect(await page.locator("#asian-handicap tbody th").first().evaluate((cell) => getComputedStyle(cell).position)).toBe("sticky");
      } else {
        await expect(page.locator("#asian-handicap [data-evidence-mobile]")).toBeVisible();
        await expect(page.locator("#asian-handicap article.evidence-card")).toHaveCount(5);
      }
    }
  });

  test("exact-score grid caption and axis headers stay readable inside the scroll region at 320, 375 and 768 px in light, dark and forced colors", async ({ page }) => {
    const modes = [
      ["light", { colorScheme: "light", forcedColors: "none" }],
      ["dark", { colorScheme: "dark", forcedColors: "none" }],
      ["forced colors", { colorScheme: "light", forcedColors: "active" }],
    ] as const;
    for (const width of [320, 375, 768]) {
      for (const [mode, media] of modes) {
        const label = `${width} px, ${mode}`;
        await page.setViewportSize({ width, height: 900 });
        /* The theme is read at load, so the media is emulated before the page opens (like the axe scenario). */
        await page.emulateMedia(media);
        await openForecast(page, issuedForecast.id);
        await expect(page.locator("#exact-score tbody td")).toHaveCount(16);
        await page.evaluate(() => document.fonts.ready);
        expect(await measureExactGrid(page), `grid layout at ${label}`).toEqual([]);
        await expectNoPageOverflow(page, `page overflow at ${label}`);

        const scroller = page.locator("#exact-score .evidence-table-scroll");
        const overflows = await scroller.evaluate((element) => element.scrollWidth > element.clientWidth + 1);
        if (width < 768) expect(overflows, `the grid is expected to scroll inside its region at ${label}`).toBe(true);
        if (overflows) {
          await scroller.scrollIntoViewIfNeeded();
          expect(await measureStuckHeaders(page), `pinned labels while scrolled at ${label}`).toEqual([]);
        }
      }
    }
  });

  test("200 percent text zoom keeps the sections readable and the page inside the viewport", async ({ page }) => {
    await page.setViewportSize({ width: 640, height: 900 });
    await openForecast(page, issuedForecast.id);
    await page.locator("html").evaluate((element) => { element.style.fontSize = "200%"; });
    await expect(page.locator("#asian-handicap").getByRole("heading", { level: 3, name: "Азиатский гандикап" })).toBeVisible();
    await expect(page.locator("#exact-score .evidence-table-scroll")).toBeVisible();
    await expectNoPageOverflow(page, "page overflow at 200 percent");
  });

  test("forced colors and reduced motion keep the main-line rail and the chip border", async ({ page }) => {
    await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
    await openForecast(page, issuedForecast.id);
    const main = page.locator("#asian-handicap").getByRole("table", { name: AH_TABLE }).locator('tbody tr[aria-current="true"]');
    await expect(main).toHaveCount(1);
    const rail = await main.locator("> :first-child").evaluate((cell) => getComputedStyle(cell).borderInlineStartWidth);
    expect(parseFloat(rail)).toBeGreaterThanOrEqual(4);
    const chipBorder = await lineCell(main).locator(".state-chip").evaluate((chip) => getComputedStyle(chip).borderTopWidth);
    expect(parseFloat(chipBorder)).toBeGreaterThanOrEqual(1);
    await expect(main).toContainText("Главная линия");
  });

  test("the main line at either edge keeps a five-row window and the full list runs from -2.5 to +2.5", async ({ page }) => {
    for (const [forecastId, edge] of [[edgeLowId, `${MINUS}2.5`], [edgeHighId, "+2.5"]] as const) {
      await openForecast(page, forecastId);
      const ah = page.locator("#asian-handicap");
      const table = ah.getByRole("table", { name: AH_TABLE });
      await expect(table.locator("tbody tr")).toHaveCount(5);
      const main = table.locator('tbody tr[aria-current="true"]');
      await expect(main).toHaveCount(1);
      await expect(lineCell(main)).toContainText(edge);
      await expect(lineCell(main)).toContainText("Главная линия");
      await ah.locator('button[aria-controls="ah-lines"]').click();
      const labels = await table.locator("tbody tr th").allInnerTexts();
      expect(labels).toHaveLength(21);
      expect(labels[0]).toContain(`${MINUS}2.5`);
      expect(labels[20]).toContain("+2.5");
      await expect(main).toHaveCount(1);
      await expectNoPageOverflow(page, `page overflow with the main line at ${edge}`);
    }
  });

  test("an exact-score cell with zero probability shows the unavailable odds and the reason", async ({ page }) => {
    await openForecast(page, edgeLowId);
    const cell = page.locator("#exact-score tbody tr").nth(0).locator("td").nth(3);
    await expect(cell).toContainText("Недоступно");
    await expect(cell).toContainText("вероятность счёта равна нулю");
    await expect(cell).toContainText("0.0%");
  });

  test("a long source label in the odds select wraps instead of widening the page", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 900 });
    await openForecast(page, issuedForecast.id);
    await page.locator("#market").selectOption("EXACT_SCORE");
    await page.getByLabel("Метка букмекера или источника").fill(`Live long source ${"very-long-bookmaker-name-".repeat(6)}`);
    for (const id of [...[0, 1, 2, 3].flatMap((home) => [0, 1, 2, 3].map((away) => `odds-${home}-${away}`)), "odds-OTHER"]) await page.locator(`#${id}`).fill("21");
    await page.getByRole("button", { name: "Сохранить полную неизменяемую книгу коэффициентов" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Неизменяемый снимок коэффициентов" })).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("#odds-snapshot option").filter({ hasText: "very-long-bookmaker-name-" })).toHaveCount(1);
    await expectNoPageOverflow(page, "page overflow with a long source label");
  });
});
