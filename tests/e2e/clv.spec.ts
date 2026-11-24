import { expect, test } from "@playwright/test";

import { createPrismaClient, createSettlementPipelineService, type PrismaClient } from "../../packages/database/src/index.js";
import { CLV_LEAGUE_ID, seedCandidate, seedClvLeague, type SeededCandidate } from "../helpers/clv-read-seed.js";
import { readLiveReleaseState } from "./live-release-stack.js";

/**
 * CLV-01..03 end to end on the owned release stack (ports 3240/3241, throwaway Postgres and Redis):
 * the operator records a complete closing set through the real POST /internal/closing-odds route, both matches are
 * settled through the real settlement pipeline, and the results page shows the de-vigged CLV for the match with a closing
 * and a typed Russian reason for the match without one. Nothing here touches the developer database.
 */

const OPERATOR_HEADERS = { "x-operator-credential": "phase-06-operator-credential" } as const;
const SOURCE = "e2e-book";
const MODEL_VERSION = "poisson-v1";
const FOOTER_DISCLOSURE = "помните о риске финансовых потерь";
const PAGE_WARNING = "Историческая оценка не гарантирует будущих результатов.";
const MISSING_CLOSE_COPY = "CLV без маржи недоступен: оператор не записал коэффициенты закрытия для этого матча и рынка";
const RAW_CODES = ["CLOSING_SET_MISSING", "CLOSING_SET_INCOMPLETE", "CANDIDATE_SET_INCOMPLETE", "SOURCE_CONVENTION_MISMATCH", "CLOSING_BEFORE_CANDIDATE", "CLOSING_NOT_PRE_KICKOFF", "INVALID_ODDS", "INVALID_TIMESTAMP"];

type Book = Readonly<{ HOME: string; DRAW: string; AWAY: string }>;

/** Independent re-computation of the documented formula (proportional de-vig), deliberately not the product code. */
function expectedClvPercent(candidate: Book, closing: Book): string {
  const fair = (book: Book) => {
    const inverse = [book.HOME, book.DRAW, book.AWAY].map((odds) => 1 / Number(odds));
    return inverse[0]! / inverse.reduce((sum, value) => sum + value, 0);
  };
  const percent = (fair(closing) / fair(candidate) - 1) * 100;
  return `${percent >= 0 ? "+" : "−"}${Math.abs(percent).toFixed(2)} %`;
}

async function settle(database: PrismaClient, candidate: SeededCandidate): Promise<void> {
  const kickoff = new Date(candidate.kickoffUtc);
  const observed = new Date(kickoff.getTime() + 2 * 60 * 60 * 1_000);
  const suffix = candidate.key;
  await database.fixture.update({ where: { id: candidate.fixtureId }, data: { status: "FINISHED" } });
  await database.sourceObservation.create({ data: { id: `e2e-result-obs-${suffix}`, provider: "acceptance", endpointFamily: "RESULTS", externalIdentity: candidate.fixtureId, observedAt: observed, payloadHash: `e2e-result-hash-${suffix}`, rawPayload: { home: 2, away: 1 }, payloadBytes: 20 } });
  await database.resultVersion.create({ data: { id: `e2e-result-${suffix}`, fixtureId: candidate.fixtureId, observationId: `e2e-result-obs-${suffix}`, effectiveAt: kickoff, observedAt: observed, homeGoals: 2, awayGoals: 1, status: "FINISHED", revision: 1 } });
  await createSettlementPipelineService({ database }).process({ fixtureId: candidate.fixtureId, resultVersionId: `e2e-result-${suffix}`, forecastSnapshotId: candidate.forecastSnapshotId, policyVersion: "settlement-policy-v1", correlationId: `e2e-clv-${suffix}` });
}

test("an operator closing set becomes a de-vigged CLV on the results page, and a match without one shows its reason", async ({ page, request }, testInfo) => {
  const state = readLiveReleaseState();
  const database = createPrismaClient(state.databaseUrl);
  // The desktop and mobile projects share one stack and one cohort: distinct odds keep their rows apart.
  const mobile = testInfo.project.name === "mobile-chromium";
  const withClose: Book = mobile ? { HOME: "2.30", DRAW: "3.25", AWAY: "3.10" } : { HOME: "2.40", DRAW: "3.20", AWAY: "3.00" };
  const withoutClose: Book = mobile ? { HOME: "2.70", DRAW: "3.10", AWAY: "2.80" } : { HOME: "2.60", DRAW: "3.30", AWAY: "2.90" };
  const closing: Book = mobile ? { HOME: "2.05", DRAW: "3.50", AWAY: "3.70" } : { HOME: "2.10", DRAW: "3.40", AWAY: "3.60" };
  const tag = mobile ? "m" : "d";

  try {
    if ((await database.league.count({ where: { id: CLV_LEAGUE_ID } })) === 0) await seedClvLeague(database);
    const now = Date.now();
    const kickoffUtc = new Date(now + 30 * 60 * 1_000).toISOString();
    const submittedAt = new Date(now - 31 * 60 * 1_000).toISOString();
    const base = { kickoffUtc, settledAt: kickoffUtc, source: SOURCE, submittedAt, open: true } as const;
    const matchA = await seedCandidate(database, { ...base, key: `clv-e2e-${tag}-a`, odds: withClose });
    const matchB = await seedCandidate(database, { ...base, key: `clv-e2e-${tag}-b`, odds: withoutClose });

    // CLV-01: only the operator credential reaches the write path (404 otherwise), and a complete set is stored once.
    const observedAt = new Date(now - 60 * 1_000).toISOString();
    const body = { fixtureId: matchA.fixtureId, market: "ONE_X_TWO", sourceConvention: SOURCE, observedAt, selections: (["HOME", "DRAW", "AWAY"] as const).map((selection) => ({ selection, decimalOdds: closing[selection] })) };
    expect((await request.post(`${state.apiOrigin}/internal/closing-odds`, { data: body })).status()).toBe(404);
    const created = await request.post(`${state.apiOrigin}/internal/closing-odds`, { headers: OPERATOR_HEADERS, data: body });
    expect(created.status()).toBe(201);
    expect((await request.post(`${state.apiOrigin}/internal/closing-odds`, { headers: OPERATOR_HEADERS, data: body })).status()).toBe(200);
    expect(await database.closingOddsObservation.count({ where: { fixtureId: matchA.fixtureId } })).toBe(3);
    expect(await database.closingOddsObservation.count({ where: { fixtureId: matchB.fixtureId } })).toBe(0);

    // The match is settled through the real pipeline; after that the operator path refuses the fixture (D-02).
    await settle(database, matchA);
    await settle(database, matchB);
    const late = await request.post(`${state.apiOrigin}/internal/closing-odds`, { headers: OPERATOR_HEADERS, data: { ...body, fixtureId: matchB.fixtureId } });
    expect(late.status()).toBe(422);

    // CLV-02: the results page of the exact cohort.
    const from = new Date(now - 2 * 24 * 60 * 60 * 1_000).toISOString();
    const to = new Date(now + 2 * 24 * 60 * 60 * 1_000).toISOString();
    const query = new URLSearchParams({ modelVersion: MODEL_VERSION, competitionId: CLV_LEAGUE_ID, market: "ONE_X_TWO", from, to });
    await page.goto(`/scorecards?${query}`);
    await expect(page.getByRole("heading", { level: 2, name: "Реестр кандидатов" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: /CLV без маржи/ })).toBeVisible();

    const rowOf = (odds: string) => page.getByRole("row").filter({ has: page.getByRole("cell", { name: `${Number(odds).toFixed(2)}`, exact: true }) });
    const rowA = rowOf(withClose.HOME);
    await expect(rowA).toHaveCount(1);
    const expected = expectedClvPercent(withClose, closing);
    await expect(rowA).toContainText(expected);
    await expect(rowA).toContainText("no-vig-clv-v1");
    await expect(rowA).toContainText(`источник ${SOURCE}`);
    await expect(rowA).toContainText(/закрытие \d{1,2} \S+ \d{4} г\.(,| в) \d{2}:\d{2} UTC/);
    // The frozen odds-ratio value keeps its own label: candidate / closing - 1 on raw odds.
    await expect(rowA).toContainText("odds-ratio-clv-v1");

    const rowB = rowOf(withoutClose.HOME);
    await expect(rowB).toHaveCount(1);
    await expect(rowB).toContainText(MISSING_CLOSE_COPY);
    await expect(rowB).not.toContainText("no-vig-clv-v1 ·");

    // No raw typed code and no profit promise reach the user; the page warning and the persistent footer disclosure stay.
    const text = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    for (const code of RAW_CODES) expect(text, code).not.toContain(code);
    expect(text).not.toMatch(/гарантированн|гарантируем|верная ставка|точно выигра|прибыль гарантирована|заработа/iu);
    expect(text).toContain("Это не прогноз, не обещание прибыли и не рекомендация");
    await expect(page.getByText(PAGE_WARNING)).toBeVisible();
    await expect(page.getByText(FOOTER_DISCLOSURE)).toBeVisible();

    // The methodology section the page links to exists.
    await page.getByRole("link", { name: "Подробнее в методологии" }).click();
    await expect(page).toHaveURL(/\/methodology#clv$/);
    await expect(page.getByRole("heading", { level: 2, name: "Сравнение с закрытием линии (CLV)" })).toBeVisible();
  } finally {
    await database.$disconnect();
  }
});
