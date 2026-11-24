import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient, createPrismaClosingOddsRepository, type PrismaClient } from "@bet-stats/database";

import { createPrismaEvaluationRepository, type EvaluationRepository, type ValueCandidateRow } from "../../apps/api/src/modules/evaluation/evaluation.service.js";
import { insertClosingBook, persistValueSettlement, seedCandidate, seedClvLeague, type SeededCandidate } from "../helpers/clv-read-seed.js";
import { migrateDeploy, startPostgres, type TestPostgres } from "../helpers/calibration-db.js";

/**
 * D-05 (b): value candidates and their order are byte-identical with and without closing observations. The only thing that may
 * differ is the read-time `clvNoVig` annotation, which is evaluation output and never feeds the list, its order or its totals.
 */

const KICKOFF = "2026-12-10T18:00:00.000Z";
const NOW = "2026-12-10T12:00:00.000Z";
const SUBMITTED = "2026-12-10T09:00:00.000Z";
const BOOK = "BOOK_A";
const IDENTITY = { modelVersion: "all", competitionId: "all", market: "all", from: "2026-12-01T00:00:00.000Z", to: "2027-01-01T00:00:00.000Z" } as const;
const TABLES_THAT_MUST_NOT_CHANGE = ["ManualOddsSnapshot", "ManualOddsSelection", "ValueReceipt", "ValueSettlement", "ForecastSnapshot", "ForecastMarket", "SettlementReceipt", "ResultVersion", "SourceObservation"] as const;
const MOVED_BOOK = { HOME: "1.4", DRAW: "4.5", AWAY: "9" } as const;

let postgres: TestPostgres;
let prisma: PrismaClient;
let evaluation: EvaluationRepository;
const candidates: SeededCandidate[] = [];

async function seed(key: string, settledAt: string, open = false): Promise<SeededCandidate> {
  const candidate = await seedCandidate(prisma, { key, kickoffUtc: KICKOFF, settledAt, source: BOOK, submittedAt: SUBMITTED, odds: { HOME: "2.4", DRAW: "3", AWAY: "4" }, open });
  candidates.push(candidate);
  return candidate;
}

/** Only c1 and c3 get closing evidence, so the annotation is MIXED across the list (an order that leaked it would show). */
function withEvidence(): SeededCandidate[] {
  return candidates.filter((item) => item.key === "c1" || item.key === "c3");
}

async function countRows(): Promise<Record<string, string>> {
  const counts: Record<string, string> = {};
  for (const table of TABLES_THAT_MUST_NOT_CHANGE) counts[table] = String((await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(`SELECT count(*) AS count FROM "${table}"`))[0]!.count);
  return counts;
}

/** Whole-table, byte-exact dump: any column of any row changing shows up. */
async function dump(table: string): Promise<string> {
  return (await prisma.$queryRawUnsafe<Array<{ dump: string }>>(`SELECT coalesce(json_agg(t ORDER BY t.id), '[]'::json)::text AS dump FROM "${table}" t`))[0]!.dump;
}

async function listAllPages(): Promise<{ pages: ValueCandidateRow[][]; totals: unknown[] }> {
  const pages: ValueCandidateRow[][] = [];
  const totals: unknown[] = [];
  let cursor: { settledAt: string; id: string } | null = null;
  do {
    const page: Awaited<ReturnType<EvaluationRepository["listValueCandidates"]>> = await evaluation.listValueCandidates(IDENTITY, cursor, 2);
    pages.push([...page.items]);
    totals.push(page.pageTotals);
    cursor = page.nextCursor;
  } while (cursor);
  return { pages, totals };
}

/** The ranking-relevant serialization: every candidate field except the read-time annotation. */
function ranking(pages: ValueCandidateRow[][]): string {
  return JSON.stringify(pages.map((page) => page.map(({ clvNoVig: _annotation, ...rest }) => rest)));
}

async function snapshot() {
  const { pages, totals } = await listAllPages();
  return {
    pages,
    ranking: ranking(pages),
    totals: JSON.stringify(totals),
    order: pages.flat().map((row) => row.id),
    frozenClv: JSON.stringify(pages.flat().map((row) => [row.id, row.clv])),
    tables: Object.fromEntries(await Promise.all(["ValueReceipt", "ValueSettlement", "ManualOddsSnapshot", "ManualOddsSelection", "ForecastSnapshot", "ForecastMarket", "SettlementReceipt"].map(async (table) => [table, await dump(table)] as const))),
    counts: await countRows(),
  };
}

describe("closing observations never change value candidates or their order", () => {
  beforeAll(async () => {
    postgres = startPostgres(`bet-stats-clv-invariance-${process.pid}`);
    migrateDeploy(postgres.url());
    prisma = createPrismaClient(postgres.url());
    evaluation = createPrismaEvaluationRepository(prisma);
    await seedClvLeague(prisma);
    // Four settled candidates (two share a settledAt so the id tie-break is exercised) and one open candidate.
    for (const [key, settledAt] of [["c1", "2026-12-10T20:00:00.000Z"], ["c2", "2026-12-10T21:00:00.000Z"], ["c3", "2026-12-10T21:00:00.000Z"], ["c4", "2026-12-10T19:30:00.000Z"]] as const) {
      await persistValueSettlement(prisma, await seed(key, settledAt));
    }
    await seed("open", "2026-12-10T22:00:00.000Z", true);
  }, 180_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    postgres?.remove();
  });

  it("serializes the candidate list, order, totals and every guarded table byte-for-byte the same after a strongly moving market is recorded", async () => {
    const before = await snapshot();
    expect(before.order).toEqual(["value-settlement-c3", "value-settlement-c2", "value-settlement-c1", "value-settlement-c4"]);
    expect(before.pages.flat().every((row) => row.clvNoVig.status === "UNAVAILABLE")).toBe(true);
    const closingBefore = (await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(`SELECT count(*) AS count FROM "ClosingOddsObservation"`))[0]!.count;

    // The market moves hard towards HOME (2.4 -> 1.4), then is corrected later; first through the operator path for the open
    // fixture, then as late evidence around the settled ones (the operator path refuses settled fixtures by design).
    const closing = createPrismaClosingOddsRepository({ database: prisma, clock: () => new Date(NOW) });
    const open = candidates.find((candidate) => candidate.key === "open")!;
    await closing.recordClosingOddsBook({ fixtureId: open.fixtureId, market: "ONE_X_TWO", sourceConvention: BOOK, observedAt: "2026-12-10T11:00:00.000Z", selections: Object.entries(MOVED_BOOK).map(([selection, decimalOdds]) => ({ selection: selection as never, decimalOdds })) });
    for (const candidate of withEvidence()) {
      await insertClosingBook(prisma, { fixtureId: candidate.fixtureId, market: "ONE_X_TWO", source: BOOK, observedAt: "2026-12-10T16:00:00.000Z", odds: { HOME: "2.0", DRAW: "3.4", AWAY: "4.5" } });
      await insertClosingBook(prisma, { fixtureId: candidate.fixtureId, market: "ONE_X_TWO", source: BOOK, observedAt: "2026-12-10T17:45:00.000Z", odds: MOVED_BOOK });
    }

    const after = await snapshot();
    const closingAfter = (await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(`SELECT count(*) AS count FROM "ClosingOddsObservation"`))[0]!.count;
    expect(Number(closingAfter - closingBefore)).toBe(3 + 2 * 6);

    // The annotation did change: the evidence is visible to evaluation ...
    expect(after.pages.flat().filter((row) => row.clvNoVig.status === "AVAILABLE")).toHaveLength(2);
    // ... and nothing else did.
    expect(after.ranking).toBe(before.ranking);
    expect(after.order).toEqual(before.order);
    expect(after.totals).toBe(before.totals);
    expect(after.frozenClv).toBe(before.frozenClv);
    expect(after.tables).toEqual(before.tables);
    expect(after.counts).toEqual(before.counts);
  });

  it("keeps ordering independent of the annotation: moving the market the other way yields the same list again", async () => {
    const first = await snapshot();
    for (const candidate of withEvidence()) {
      await insertClosingBook(prisma, { fixtureId: candidate.fixtureId, market: "ONE_X_TWO", source: BOOK, observedAt: "2026-12-10T17:55:00.000Z", odds: { HOME: "6", DRAW: "2.5", AWAY: "2.2" } });
    }
    const second = await snapshot();
    expect(second.ranking).toBe(first.ranking);
    expect(second.order).toEqual(first.order);
    // the later set wins and flips the sign of the read-time CLV, which proves the annotation reacts while the list does not
    const sign = (snapshotOf: typeof first) => snapshotOf.pages.flat().filter((row) => row.clvNoVig.status === "AVAILABLE").map((row) => Math.sign(Number(row.clvNoVig.status === "AVAILABLE" ? row.clvNoVig.value : 0)));
    expect(sign(first)).toEqual([1, 1]);
    expect(sign(second)).toEqual([-1, -1]);
  });
});
