import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { buildTeamEvidence, type EvidenceMatch, type ForecastResponseDto, type OddsMarket, type OddsSelection } from "../../packages/domain/src/index";
import { createPrismaClient } from "../../packages/database/src/index";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const API_ORIGIN = "http://127.0.0.1:3001";
const run = `${process.pid}-${Date.now()}`;
const fixtureId = `live-workbench-fixture-${run}`;
const homeTeamId = `live-workbench-home-${run}`;
const awayTeamId = `live-workbench-away-${run}`;
const kickoff = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
const initialCutoff = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
const preMatchCutoff = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
let issuedForecast: ForecastResponseDto;

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
  const prisma = createPrismaClient(databaseUrl);
  try {
    const leagueId = `live-workbench-league-${run}`;
    const seasonId = `live-workbench-season-${run}`;
    const syncRunId = `live-workbench-run-${run}`;
    await prisma.league.create({ data: { id: leagueId, name: "Live Workbench League", countryCode: "PL" } });
    await prisma.season.create({ data: { id: seasonId, leagueId, label: "2026/27", startsOn: new Date("2026-07-01"), endsOn: new Date("2027-06-30") } });
    await prisma.team.createMany({ data: [
      { id: homeTeamId, name: "Live Home", normalizedName: `live-home-${run}`, countryCode: "PL" },
      { id: awayTeamId, name: "Live Away", normalizedName: `live-away-${run}`, countryCode: "PL" },
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
      const buildId = `${teamId}-build`;
      const componentNames = ["form5", "form10", "elo", "homeStrength", "awayStrength", "goalRates", "restDays", "h2h"] as const;
      const components = componentNames.map((component) => {
        const item = evidence[component];
        return { component, value: item.value as never, sampleSize: item.sampleSize, limitation: item.limitation, sourceTimes: item.sourceRefs as never };
      });
      await prisma.evidenceBuild.create({ data: {
        id: buildId, teamId, cutoff: new Date(preMatchCutoff), configVersion: "evidence-v1", configHash: `config-${teamId}`, syncRunId,
        state: "PUBLISHED", publishedAt: new Date(preMatchCutoff),
        components: { create: [...components, { component: "receipt", value: evidence.receipt as never, sampleSize: evidence.receipt.inputs.length, limitation: null, sourceTimes: evidence.receipt.inputs as never }] },
      } });
    }
  } finally { await prisma.$disconnect(); }
}

async function publishForecast(request: APIRequestContext): Promise<void> {
  const response = await request.post(`${API_ORIGIN}/fixtures/${fixtureId}/forecasts`, {
    headers: eligibilityHeaders(), data: { kind: "PRE_MATCH", cutoff: preMatchCutoff },
  });
  const body = await response.text();
  expect(response.status(), body).toBe(201);
  issuedForecast = JSON.parse(body) as ForecastResponseDto;
  const prisma = createPrismaClient(databaseUrl);
  try {
    const lowConfidence: ForecastResponseDto = {
      ...issuedForecast, id: `limited-forecast-${run}`, kind: "INITIAL", revision: 1, cutoff: initialCutoff,
      inputHash: `limited-input-${run}`, evidenceFingerprint: `limited-evidence-${run}`,
      confidence: { ...issuedForecast.confidence, score: 0.2, components: { ...issuedForecast.confidence.components, completeness: 0.2 } },
      limitations: ["LIMITED_HISTORY", "LINEUP_NOT_CONFIRMED"],
      receipt: { ...issuedForecast.receipt, forecastSnapshotId: `limited-forecast-${run}` },
    };
    await prisma.forecastSnapshot.create({ data: {
      id: lowConfidence.id, fixtureId, kind: lowConfidence.kind, state: "ISSUED", revision: 1, cutoff: new Date(lowConfidence.cutoff),
      modelVersion: lowConfidence.modelVersion, modelHash: lowConfidence.modelHash, configVersion: lowConfidence.configVersion, configHash: lowConfidence.configHash,
      inputHash: lowConfidence.inputHash, evidenceFingerprint: lowConfidence.evidenceFingerprint, sourceRefs: lowConfidence.receipt.sourceRefs as never,
      probabilities: lowConfidence.probabilities as never, confidence: lowConfidence.confidence as never, assumptions: lowConfidence.assumptions as never,
      receipt: lowConfidence as never, issuedAt: new Date(lowConfidence.issuedAt),
      markets: { create: Object.entries(lowConfidence.probabilities).map(([market, probabilities]) => ({ market, probabilities: probabilities as never })) },
    } });
  } finally { await prisma.$disconnect(); }
}

async function submitBook(page: Page, market: OddsMarket, odds: readonly string[], sourceLabel = `Live source ${market}`): Promise<string> {
  await page.getByLabel("Рынок").selectOption(market);
  await page.getByLabel("Метка букмекера или источника").fill(sourceLabel);
  const selections: Readonly<Record<OddsMarket, readonly OddsSelection[]>> = {
    ONE_X_TWO: ["HOME", "DRAW", "AWAY"], OVER_UNDER_2_5: ["OVER_2_5", "UNDER_2_5"], BTTS: ["YES", "NO"],
  };
  const labels: Record<OddsSelection, string> = { HOME: "Десятичный коэффициент на хозяев", DRAW: "Десятичный коэффициент на ничью", AWAY: "Десятичный коэффициент на гостей", OVER_2_5: "Десятичный коэффициент: Тотал больше 2.5", UNDER_2_5: "Десятичный коэффициент: Тотал меньше 2.5", YES: "Десятичный коэффициент: Да", NO: "Десятичный коэффициент: Нет" };
  for (const [index, selection] of selections[market].entries()) await page.getByLabel(labels[selection]).fill(odds[index]!);
  await page.getByRole("button", { name: "Сохранить полную неизменяемую книгу коэффициентов" }).click();
  const status = page.getByRole("status").filter({ hasText: "Неизменяемый снимок коэффициентов" });
  await expect(status).toBeVisible({ timeout: 30_000 });
  const match = (await status.textContent())?.match(/снимок коэффициентов ([a-f0-9-]+) сохранён/i);
  if (!match?.[1]) throw new Error("Saved odds snapshot identity was not rendered");
  return match[1];
}

test.beforeAll(async ({ request }) => { await seedEvidence(); await publishForecast(request); });

test.describe("forecast and manual value workbench", () => {
  test("restores a partial local draft without issuing an analysis request", async ({ page }) => {
    const key = `bet-stats:manual-odds-draft-v1:${encodeURIComponent(fixtureId)}:ONE_X_TWO`;
    const draft = JSON.stringify({ schemaVersion: "manual-odds-draft-v1", analyzable: false, fixtureId, market: "ONE_X_TWO", sourceLabel: "Draft source", fields: [{ selection: "HOME", decimalOdds: "2.2" }, { selection: "DRAW", decimalOdds: "" }, { selection: "AWAY", decimalOdds: "" }] });
    await page.addInitScript(({ storageKey, value }) => localStorage.setItem(storageKey, value), { storageKey: key, value: draft });
    let analysisRequests = 0;
    page.on("request", (request) => { if (request.url().includes("/value")) analysisRequests += 1; });
    await page.goto(`/fixtures/${fixtureId}`);
    await expect(page.getByText("Локальный черновик восстановлен. Значения черновика хранятся на этом устройстве и не могут быть проанализированы.")).toBeVisible();
    await expect(page.getByLabel("Десятичный коэффициент на хозяев")).toHaveValue("2.2");
    expect(analysisRequests).toBe(0);
  });

  test("matches production JSON to the DOM, clipboard, and fixed-name download for the exact pair", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "http://127.0.0.1:3000" });
    await page.goto(`/fixtures/${fixtureId}`);
    await expect(page.getByLabel("Снимок прогноза").locator("option").filter({ hasText: initialCutoff })).toHaveCount(1);
    await page.getByLabel("Снимок прогноза").selectOption(`limited-forecast-${run}`);
    await page.getByText("Доказательства, модель и ограничения").click();
    await expect(page.getByText("limited history", { exact: false })).toBeVisible();
    await expect(page.getByText("lineup not confirmed", { exact: false })).toBeVisible();
    const insufficientOddsId = await submitBook(page, "ONE_X_TWO", ["4", "2", "2"]);
    await page.getByRole("button", { name: "Сравнить точные снимки" }).click();
    await expect(page.getByRole("heading", { level: 3, name: "Недостаточно доказательств" })).toBeVisible();

    await page.getByLabel("Снимок прогноза").selectOption(issuedForecast.id);
    const noValueOddsId = await submitBook(page, "ONE_X_TWO", ["1.6", "5", "5"]);
    await page.getByLabel("Снимок коэффициентов").selectOption(noValueOddsId);
    await page.getByRole("button", { name: "Сравнить точные снимки" }).click();
    await expect(page.getByRole("heading", { level: 3, name: "Нет value" })).toBeVisible();

    const originalOddsId = await submitBook(page, "ONE_X_TWO", ["3.8", "2.1", "2.2"], "Live source original");
    const candidateOddsId = await submitBook(page, "ONE_X_TWO", ["4", "2", "2"], "Live source replacement");
    await page.getByLabel("Снимок коэффициентов").selectOption(candidateOddsId);
    const responsePromise = page.waitForResponse((response) => response.url().includes(`/internal-api/fixtures/${fixtureId}/value`) && response.request().method() === "POST");
    await page.getByRole("button", { name: "Сравнить точные снимки" }).click();
    const comparisonResponse = await responsePromise;
    expect(comparisonResponse.ok()).toBeTruthy();
    const receipt = await comparisonResponse.json() as { id: string; forecastSnapshotId: string; oddsSnapshotId: string; outcome: string };
    await expect(page.getByRole("heading", { level: 3, name: "Кандидат value" })).toBeVisible();
    expect(receipt).toMatchObject({ forecastSnapshotId: issuedForecast.id, oddsSnapshotId: candidateOddsId, outcome: "VALUE_CANDIDATE" });
    await page.getByText("Точная неизменяемая квитанция решения").click();
    await expect(page.locator("pre").filter({ hasText: `"id": "${receipt.id}"` })).toHaveText(JSON.stringify(receipt, null, 2));
    await page.getByRole("button", { name: "Скопировать JSON точной квитанции" }).click();
    expect(JSON.parse(await page.evaluate(() => navigator.clipboard.readText()))).toEqual(receipt);
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("link", { name: "Скачать JSON точной квитанции" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(`value-receipt-${receipt.id}.json`);
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    expect(JSON.parse(Buffer.concat(chunks).toString("utf8"))).toEqual(receipt);
    await page.getByLabel("Выбор для оценки").selectOption("DRAW");
    const drawResponsePromise = page.waitForResponse((response) => response.url().includes(`/internal-api/fixtures/${fixtureId}/value`) && response.request().method() === "POST");
    await page.getByRole("button", { name: "Сравнить точные снимки" }).click();
    const drawResponse = await drawResponsePromise;
    expect(drawResponse.ok()).toBeTruthy();
    const drawReceipt = await drawResponse.json() as typeof receipt & { selection: string; modelProbability: string; expectedValue: string };
    expect(drawReceipt).toMatchObject({ forecastSnapshotId: issuedForecast.id, oddsSnapshotId: candidateOddsId, selection: "DRAW" });
    expect(drawReceipt.id).not.toBe(receipt.id);
    expect(drawReceipt.modelProbability).not.toBe((receipt as typeof drawReceipt).modelProbability);
    expect(drawReceipt.expectedValue).not.toBe((receipt as typeof drawReceipt).expectedValue);
    await expect(page.locator("pre").filter({ hasText: `"id": "${drawReceipt.id}"` })).toHaveText(JSON.stringify(drawReceipt, null, 2));
    await page.getByRole("button", { name: "Скопировать JSON точной квитанции" }).click();
    expect(JSON.parse(await page.evaluate(() => navigator.clipboard.readText()))).toEqual(drawReceipt);
    const drawDownloadPromise = page.waitForEvent("download");
    await page.getByRole("link", { name: "Скачать JSON точной квитанции" }).click();
    const drawDownload = await drawDownloadPromise;
    expect(drawDownload.suggestedFilename()).toBe(`value-receipt-${drawReceipt.id}.json`);
    const drawStream = await drawDownload.createReadStream();
    const drawChunks: Buffer[] = [];
    for await (const chunk of drawStream) drawChunks.push(Buffer.from(chunk));
    expect(JSON.parse(Buffer.concat(drawChunks).toString("utf8"))).toEqual(drawReceipt);
    expect(originalOddsId).not.toBe(candidateOddsId);
    await submitBook(page, "OVER_UNDER_2_5", ["2", "2"]);
    await submitBook(page, "BTTS", ["2", "2"]);
    expect(insufficientOddsId).not.toBe(candidateOddsId);
  });

  test("rejects unauthorized analytics and reflows without horizontal overflow", async ({ page, request }) => {
    const denied = await request.get(`${API_ORIGIN}/fixtures/${fixtureId}/forecasts?kind=PRE_MATCH&cutoff=${encodeURIComponent(preMatchCutoff)}`);
    expect(denied.status()).toBe(403);
    await page.setViewportSize({ width: 360, height: 900 });
    await page.goto(`/fixtures/${fixtureId}`);
    await page.getByText("Компоненты уверенности", { exact: false }).click();
    for (const component of ["completeness", "lineup availability", "freshness", "source reliability", "model stability"]) await expect(page.getByText(component, { exact: false })).toBeVisible();
    await expect(page.getByText("Уверенность характеризует доказательства вероятности; это не вероятность результата.")).toBeVisible();
    await page.evaluate(() => { document.body.style.fontSize = "200%"; });
    await expect(page.getByRole("heading", { level: 2, name: "Прогнозы и ручной поиск value" })).toBeVisible();
    const overflow = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
      elements: [...document.querySelectorAll<HTMLElement>("body *")]
        .filter((element) => element.getBoundingClientRect().right > document.documentElement.clientWidth + 1)
        .slice(0, 10)
        .map((element) => ({ tag: element.tagName, text: element.innerText?.slice(0, 80), right: element.getBoundingClientRect().right, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth })),
    }));
    expect(overflow.documentWidth, JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.viewportWidth);
  });
});
