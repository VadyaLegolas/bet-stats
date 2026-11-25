import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient, readNoVigClvForCandidates, type NoVigClvCandidate, type NoVigClvReading, type PrismaClient } from "@bet-stats/database";
import { NO_VIG_CLV_POLICY_VERSION } from "@bet-stats/domain";

import { createPrismaEvaluationRepository } from "../../apps/api/src/modules/evaluation/evaluation.service.js";
import { insertClosingBook, persistValueSettlement, seedCandidate, seedClvLeague, type SeededCandidate } from "../helpers/clv-read-seed.js";
import { migrateDeploy, startPostgres, type TestPostgres } from "../helpers/calibration-db.js";
import { exactScoreSelections, seedExtendedMarketsFixture, seedOddsBook, type SeededOdds } from "../helpers/extended-markets-seed.js";

const KICKOFF = "2026-12-10T18:00:00.000Z";
const SETTLED = "2026-12-10T20:00:00.000Z";
const SUBMITTED = "2026-12-10T09:00:00.000Z";
const BOOK_A = "BOOK_A";
const BOOK_B = "BOOK_B";
const FULL_CANDIDATE_ODDS = { HOME: "2.4", DRAW: "3", AWAY: "4" } as const;

let postgres: TestPostgres;
let prisma: PrismaClient;
const seeded = new Map<string, SeededCandidate>();

async function seed(key: string, overrides: Partial<Parameters<typeof seedCandidate>[1]> = {}): Promise<SeededCandidate> {
  const candidate = await seedCandidate(prisma, { key, kickoffUtc: KICKOFF, settledAt: SETTLED, source: BOOK_A, submittedAt: SUBMITTED, odds: FULL_CANDIDATE_ODDS, ...overrides });
  seeded.set(key, candidate);
  return candidate;
}

function toInput(candidate: SeededCandidate, key = candidate.key): NoVigClvCandidate {
  return { key, fixtureId: candidate.fixtureId, market: candidate.market, selection: candidate.selection, oddsSnapshotId: candidate.oddsSnapshotId, kickoffUtc: new Date(candidate.kickoffUtc) };
}

/** Counts Prisma operations (one per delegate call) so a page that issues more queries per candidate is caught. */
function countingClient(base: PrismaClient): { client: PrismaClient; calls: string[] } {
  const calls: string[] = [];
  const client = base.$extends({
    query: { $allModels: { async $allOperations({ model, operation, args, query }) { calls.push(`${model}.${operation}`); return query(args); } } },
  });
  return { client: client as unknown as PrismaClient, calls };
}

describe("read-time no-vig CLV reader on real PostgreSQL", () => {
  beforeAll(async () => {
    postgres = startPostgres(`bet-stats-no-vig-reader-${process.pid}`);
    migrateDeploy(postgres.url());
    prisma = createPrismaClient(postgres.url());
    await seedClvLeague(prisma);

    // ok: two closing batches plus rows that must never be used (after kickoff, other source).
    const ok = await seed("ok");
    await insertClosingBook(prisma, { fixtureId: ok.fixtureId, market: "ONE_X_TWO", source: BOOK_A, observedAt: "2026-12-10T12:00:00.000Z", odds: { HOME: "2.0", DRAW: "3.5", AWAY: "4.5" } });
    const latest = await insertClosingBook(prisma, { fixtureId: ok.fixtureId, market: "ONE_X_TWO", source: BOOK_A, observedAt: "2026-12-10T17:00:00.000Z", odds: { HOME: "2.2", DRAW: "3.3", AWAY: "3.9" } });
    await insertClosingBook(prisma, { fixtureId: ok.fixtureId, market: "ONE_X_TWO", source: BOOK_B, observedAt: "2026-12-10T17:30:00.000Z", odds: { HOME: "1.5", DRAW: "5", AWAY: "8" } });
    await insertClosingBook(prisma, { fixtureId: ok.fixtureId, market: "ONE_X_TWO", source: BOOK_A, observedAt: "2026-12-10T18:30:00.000Z", odds: { HOME: "1.2", DRAW: "7", AWAY: "12" } });
    await persistValueSettlement(prisma, ok, latest.HOME!);

    // noclose: the only closing set belongs to the neighbouring BTTS market.
    const noclose = await seed("noclose");
    await insertClosingBook(prisma, { fixtureId: noclose.fixtureId, market: "BTTS", source: BOOK_A, observedAt: "2026-12-10T17:00:00.000Z", odds: { YES: "1.8", NO: "2.0" } });
    await persistValueSettlement(prisma, noclose);

    // incomplete: closing set lacks AWAY.
    const incomplete = await seed("incomplete");
    await insertClosingBook(prisma, { fixtureId: incomplete.fixtureId, market: "ONE_X_TWO", source: BOOK_A, observedAt: "2026-12-10T17:00:00.000Z", odds: { HOME: "2.2", DRAW: "3.3" } });
    await persistValueSettlement(prisma, incomplete);

    // foreign: a complete closing set exists, but from another source.
    const foreign = await seed("foreign");
    await insertClosingBook(prisma, { fixtureId: foreign.fixtureId, market: "ONE_X_TWO", source: BOOK_B, observedAt: "2026-12-10T17:00:00.000Z", odds: { HOME: "2.2", DRAW: "3.3", AWAY: "3.9" } });
    await persistValueSettlement(prisma, foreign);

    // stale: the latest pre-kickoff closing set is older than the candidate's submission.
    const stale = await seed("stale");
    await insertClosingBook(prisma, { fixtureId: stale.fixtureId, market: "ONE_X_TWO", source: BOOK_A, observedAt: "2026-12-10T08:00:00.000Z", odds: { HOME: "2.2", DRAW: "3.3", AWAY: "3.9" } });
    await persistValueSettlement(prisma, stale);

    // partial candidate: the manual odds snapshot has no DRAW.
    const partial = await seed("partial", { odds: { HOME: "2.4", AWAY: "4" } });
    await insertClosingBook(prisma, { fixtureId: partial.fixtureId, market: "ONE_X_TWO", source: BOOK_A, observedAt: "2026-12-10T17:00:00.000Z", odds: { HOME: "2.2", DRAW: "3.3", AWAY: "3.9" } });
    await persistValueSettlement(prisma, partial);
  }, 180_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    postgres?.remove();
  });

  async function readAll(): Promise<ReadonlyMap<string, NoVigClvReading>> {
    return readNoVigClvForCandidates(prisma, [...seeded.values()].map((candidate) => toInput(candidate)));
  }

  it("is AVAILABLE on a complete set and uses the latest pre-kickoff closing set of the same source", async () => {
    const readings = await readAll();
    const ok = readings.get("ok")!;
    expect(ok.status).toBe("AVAILABLE");
    expect(ok).toMatchObject({ status: "AVAILABLE", policyVersion: NO_VIG_CLV_POLICY_VERSION, source: BOOK_A, closingObservedAt: "2026-12-10T17:00:00.000Z" });
    if (ok.status !== "AVAILABLE") throw new Error("unreachable");
    // candidate fair 5/12 (zero margin), closing fair 13/29 (435/429 overround), clv = 11/145.
    expect(Number(ok.pCandidateFair)).toBeCloseTo(5 / 12, 12);
    expect(Number(ok.pCloseFair)).toBeCloseTo(13 / 29, 12);
    expect(Number(ok.value)).toBeCloseTo(11 / 145, 12);
  });

  it("reports a typed reason, never a value, for a missing closing set (neighbouring market is not borrowed)", async () => {
    const reading = (await readAll()).get("noclose")!;
    expect(reading).toMatchObject({ status: "UNAVAILABLE", policyVersion: NO_VIG_CLV_POLICY_VERSION, reason: "CLOSING_SET_MISSING" });
    expect(reading).not.toHaveProperty("value");
  });

  it("reports CLOSING_SET_INCOMPLETE for a closing set without every selection", async () => {
    expect((await readAll()).get("incomplete")).toMatchObject({ status: "UNAVAILABLE", reason: "CLOSING_SET_INCOMPLETE" });
  });

  it("reports SOURCE_CONVENTION_MISMATCH when only another source closed the market", async () => {
    const reading = (await readAll()).get("foreign")!;
    expect(reading).toMatchObject({ status: "UNAVAILABLE", reason: "SOURCE_CONVENTION_MISMATCH" });
    expect(reading).not.toHaveProperty("value");
  });

  it("reports CLOSING_BEFORE_CANDIDATE when the latest pre-kickoff closing set predates the candidate", async () => {
    expect((await readAll()).get("stale")).toMatchObject({ status: "UNAVAILABLE", reason: "CLOSING_BEFORE_CANDIDATE" });
  });

  it("reports CANDIDATE_SET_INCOMPLETE when the candidate's own odds set lacks a selection", async () => {
    expect((await readAll()).get("partial")).toMatchObject({ status: "UNAVAILABLE", reason: "CANDIDATE_SET_INCOMPLETE" });
  });

  it("returns an empty map for no candidates and an unavailable reading for an unknown snapshot", async () => {
    expect((await readNoVigClvForCandidates(prisma, [])).size).toBe(0);
    const ok = seeded.get("ok")!;
    const reading = (await readNoVigClvForCandidates(prisma, [{ ...toInput(ok), oddsSnapshotId: "does-not-exist" }])).get("ok")!;
    expect(reading).toMatchObject({ status: "UNAVAILABLE", reason: "CANDIDATE_SET_INCOMPLETE" });
  });

  it("does not write: row counts of every table stay identical across a read", async () => {
    const tables = ["ManualOddsSnapshot", "ManualOddsSelection", "ValueReceipt", "ValueSettlement", "ClosingOddsObservation", "ForecastSnapshot", "SettlementReceipt"];
    const count = async () => Promise.all(tables.map(async (table) => (await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(`SELECT count(*) AS count FROM "${table}"`))[0]!.count));
    const before = await count();
    await readAll();
    expect(await count()).toEqual(before);
  });

  it("issues a constant number of queries regardless of the number of candidates", async () => {
    const base = [...seeded.values()].map((candidate) => toInput(candidate));
    const small = countingClient(prisma);
    await readNoVigClvForCandidates(small.client, base);
    const many = countingClient(prisma);
    const inflated = Array.from({ length: 10 }, (_, copy) => base.map((candidate) => ({ ...candidate, key: `${candidate.key}#${copy}` }))).flat();
    const readings = await readNoVigClvForCandidates(many.client, inflated);
    expect(readings.size).toBe(inflated.length);
    expect(many.calls).toEqual(small.calls);
    expect(many.calls.length).toBeLessThanOrEqual(2);
  });

  it("extends listValueCandidates with clvNoVig while the frozen clv field keeps its meaning", async () => {
    const counter = countingClient(prisma);
    const repository = createPrismaEvaluationRepository(counter.client);
    const page = await repository.listValueCandidates({ modelVersion: "all", competitionId: "all", market: "all", from: "2026-12-01T00:00:00.000Z", to: "2027-01-01T00:00:00.000Z" }, null, 100);
    expect(page.items).toHaveLength(6);
    const byFixture = new Map(page.items.map((item) => [item.id, item]));
    const ok = byFixture.get("value-settlement-ok")!;
    // frozen odds-ratio-clv-v1 from the settlement receipt: 2.4 / 2.2 - 1, labelled with its version.
    expect(ok.clv).toMatchObject({ status: "AVAILABLE", reason: null, policyVersion: "odds-ratio-clv-v1" });
    expect(Number(ok.clv.value)).toBeCloseTo(2.4 / 2.2 - 1, 12);
    expect(ok.clvNoVig).toMatchObject({ status: "AVAILABLE", policyVersion: NO_VIG_CLV_POLICY_VERSION, source: BOOK_A });
    expect(byFixture.get("value-settlement-noclose")!.clv).toMatchObject({ status: "UNAVAILABLE", reason: "CLOSING_OBSERVATION_MISSING", value: null, policyVersion: "odds-ratio-clv-v1" });
    expect(byFixture.get("value-settlement-noclose")!.clvNoVig).toMatchObject({ status: "UNAVAILABLE", reason: "CLOSING_SET_MISSING" });
    expect(byFixture.get("value-settlement-foreign")!.clvNoVig).toMatchObject({ status: "UNAVAILABLE", reason: "SOURCE_CONVENTION_MISMATCH" });
    // one candidate query plus the reader's two: no per-candidate queries.
    expect(counter.calls.filter((call) => call.startsWith("ManualOddsSnapshot.") || call.startsWith("ClosingOddsObservation."))).toEqual(["ManualOddsSnapshot.findMany", "ClosingOddsObservation.findMany"]);
    expect(counter.calls.filter((call) => call.startsWith("ValueSettlement."))).toEqual(["ValueSettlement.findMany"]);
  });
});

/**
 * Phase 14 (D-14): the same read-time layer serves Asian handicap and exact score. A complete candidate set and a complete
 * closing set of one market and source give a value; anything less is a typed reason, never a borrowed neighbour line.
 */
describe("read-time no-vig CLV for Asian handicap and exact score (real PostgreSQL)", () => {
  const SOURCE = "BOOKMAKER_BACK";
  const KICK = "2026-09-10T18:00:00.000Z";
  let extPostgres: TestPostgres;
  let extPrisma: PrismaClient;
  const candidates = new Map<string, { input: NoVigClvCandidate; odds: SeededOdds }>();

  async function candidate(key: string, market: string, selection: string, selections: ReadonlyArray<readonly [string, string]>): Promise<{ fixtureId: string }> {
    const seedRow = await seedExtendedMarketsFixture(extPrisma, { prefix: key, settlementReceipt: false });
    const odds = await seedOddsBook(extPrisma, seedRow, { market, selections, tag: "cand" });
    candidates.set(key, { odds, input: { key, fixtureId: seedRow.fixtureId, market, selection, oddsSnapshotId: odds.oddsSnapshotId, kickoffUtc: new Date(KICK) } });
    return { fixtureId: seedRow.fixtureId };
  }
  const close = (fixtureId: string, market: string, odds: Readonly<Record<string, string>>) => insertClosingBook(extPrisma, { fixtureId, market: market as never, source: SOURCE, observedAt: "2026-09-10T17:00:00.000Z", odds });
  const read = async (key: string) => (await readNoVigClvForCandidates(extPrisma, [candidates.get(key)!.input])).get(key)!;

  beforeAll(async () => {
    extPostgres = startPostgres(`bet-stats-p14-clv-${process.pid}`);
    migrateDeploy(extPostgres.url());
    extPrisma = createPrismaClient(extPostgres.url());
    const handicap = [["HOME", "1.90"], ["AWAY", "1.95"]] as const;

    const ahOk = await candidate("ahok", "ASIAN_HANDICAP:-0.75", "HOME", handicap);
    await close(ahOk.fixtureId, "ASIAN_HANDICAP:-0.75", { HOME: "1.80", AWAY: "2.05" });

    const ahInc = await candidate("ahinc", "ASIAN_HANDICAP:-0.75", "HOME", handicap);
    await close(ahInc.fixtureId, "ASIAN_HANDICAP:-0.75", { HOME: "1.80" });

    // The neighbouring line closed, the candidate's own line did not.
    const ahOther = await candidate("ahother", "ASIAN_HANDICAP:-0.75", "HOME", handicap);
    await close(ahOther.fixtureId, "ASIAN_HANDICAP:-1", { HOME: "2.10", AWAY: "1.75" });

    const exOk = await candidate("exok", "EXACT_SCORE", "1-0", exactScoreSelections("18", { "1-0": "6" }));
    await close(exOk.fixtureId, "EXACT_SCORE", Object.fromEntries(exactScoreSelections("17", { "1-0": "5.5" })));

    const exInc = await candidate("exinc", "EXACT_SCORE", "1-0", exactScoreSelections("18", { "1-0": "6" }));
    await close(exInc.fixtureId, "EXACT_SCORE", Object.fromEntries(exactScoreSelections("17").slice(0, 16)));
  }, 180_000);

  afterAll(async () => {
    await extPrisma?.$disconnect();
    extPostgres?.remove();
  });

  it("reads a handicap line from the complete candidate and closing sets of that line", async () => {
    const reading = await read("ahok");
    expect(reading).toMatchObject({ status: "AVAILABLE", policyVersion: NO_VIG_CLV_POLICY_VERSION, source: SOURCE, closingObservedAt: "2026-09-10T17:00:00.000Z" });
    if (reading.status !== "AVAILABLE") throw new Error("unreachable");
    const fair = (own: number, other: number) => (1 / own) / (1 / own + 1 / other);
    expect(Number(reading.pCandidateFair)).toBeCloseTo(fair(1.9, 1.95), 12);
    expect(Number(reading.pCloseFair)).toBeCloseTo(fair(1.8, 2.05), 12);
    expect(Number(reading.value)).toBeCloseTo(fair(1.8, 2.05) / fair(1.9, 1.95) - 1, 12);
  });

  it("is UNAVAILABLE with a typed reason for an incomplete handicap closing set and never borrows another line", async () => {
    expect(await read("ahinc")).toMatchObject({ status: "UNAVAILABLE", reason: "CLOSING_SET_INCOMPLETE" });
    const other = await read("ahother");
    expect(other).toMatchObject({ status: "UNAVAILABLE", reason: "CLOSING_SET_MISSING" });
    expect(other).not.toHaveProperty("value");
  });

  it("reads exact score only from a closing set covering all 17 selections", async () => {
    const reading = await read("exok");
    expect(reading).toMatchObject({ status: "AVAILABLE", policyVersion: NO_VIG_CLV_POLICY_VERSION });
    if (reading.status !== "AVAILABLE") throw new Error("unreachable");
    const fair = (prices: ReadonlyArray<readonly [string, string]>) => (1 / Number(prices.find(([selection]) => selection === "1-0")![1])) / prices.reduce((sum, [, odds]) => sum + 1 / Number(odds), 0);
    expect(Number(reading.pCandidateFair)).toBeCloseTo(fair(exactScoreSelections("18", { "1-0": "6" })), 12);
    expect(Number(reading.pCloseFair)).toBeCloseTo(fair(exactScoreSelections("17", { "1-0": "5.5" })), 12);
    expect(await read("exinc")).toMatchObject({ status: "UNAVAILABLE", reason: "CLOSING_SET_INCOMPLETE" });
  });
});
