import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { ClosingOddsController } from "../../apps/api/src/modules/closing-odds/closing-odds.controller.js";
import { ClosingOddsService } from "../../apps/api/src/modules/closing-odds/closing-odds.service.js";
import { OperatorGuard } from "../../apps/api/src/modules/reconciliation/operator.guard.js";
import { createPrismaClient, createPrismaClosingOddsRepository, type ClosingOddsRepository, type PrismaClient, type RecordClosingOddsBookResult, type StoredClosingObservation } from "@bet-stats/database";
import { CLOSING_ODDS_REJECTION_COPY, parseRecordArguments, runClosingOddsCommand } from "../../scripts/closing-odds.mjs";

// @nestjs/common is not resolvable from tests/: HTTP exceptions are inspected by duck typing, POST is RequestMethod.POST (1).
const METHOD_POST = 1;
const observedAt = "2026-11-30T11:00:00.000Z";

const body = {
  fixtureId: "fixture-1",
  market: "ONE_X_TWO",
  sourceConvention: "BOOKMAKER_BACK",
  observedAt,
  selections: [
    { selection: "HOME", decimalOdds: "2.10" },
    { selection: "DRAW", decimalOdds: "3.40" },
    { selection: "AWAY", decimalOdds: "3.60" },
  ],
};

function stored(selection: string, decimalOdds: string): StoredClosingObservation {
  return { id: `closing_${selection}`, fixtureId: "fixture-1", market: "ONE_X_TWO", selection: selection as StoredClosingObservation["selection"], decimalOdds, oddsFormat: "DECIMAL", sourceConvention: "BOOKMAKER_BACK", observationKind: "MARKET_CLOSE", observedAt, createdAt: observedAt };
}

const createdResult = (created: boolean): RecordClosingOddsBookResult => ({ created, observations: [stored("HOME", "2.1"), stored("DRAW", "3.4"), stored("AWAY", "3.6")] });

function setup(outcome: (() => Promise<RecordClosingOddsBookResult>) | RecordClosingOddsBookResult = createdResult(true)) {
  const repository: ClosingOddsRepository = {
    recordClosingOddsBook: vi.fn(typeof outcome === "function" ? outcome : async () => outcome),
  };
  return { repository, controller: new ClosingOddsController(new ClosingOddsService(repository)) };
}

type Reply = { status: number; headers: Record<string, string>; body: unknown };

async function post(controller: ClosingOddsController, payload: unknown): Promise<Reply> {
  const headers: Record<string, string> = {};
  let status = 0;
  let json: unknown;
  const response = {
    status(code: number) { status = code; return this; },
    setHeader(name: string, value: string) { headers[name] = value; },
    json(value: unknown) { json = value; return value; },
  };
  await controller.record(payload, response as never);
  return { status, headers, body: json };
}

async function failure(promise: Promise<unknown>): Promise<{ status: number; response: unknown }> {
  try { await promise; } catch (error) {
    const http = error as { getStatus?: () => number; getResponse?: () => unknown };
    if (typeof http.getStatus === "function" && typeof http.getResponse === "function") return { status: http.getStatus(), response: http.getResponse() };
    throw error;
  }
  throw new Error("expected the request to fail");
}

describe("closing odds route: operator boundary", () => {
  it("is POST internal/closing-odds behind OperatorGuard and fails closed with 404", () => {
    expect(Reflect.getMetadata("path", ClosingOddsController)).toBe("internal/closing-odds");
    expect(Reflect.getMetadata("__guards__", ClosingOddsController)).toContain(OperatorGuard);
    expect(Reflect.getMetadata("method", ClosingOddsController.prototype.record)).toBe(METHOD_POST);
    const guard = new OperatorGuard("operator-credential-long-enough");
    expect(() => guard.authorize(undefined)).toThrow("Not found");
    expect(() => guard.authorize("wrong-credential")).toThrow("Not found");
    expect(guard.authorize("operator-credential-long-enough")).toEqual({ actor: "operator" });
    expect(() => new OperatorGuard(undefined).authorize("anything")).toThrow("Not found");
  });

  it("canActivate answers 404 without the credential header and passes with it", () => {
    const guard = new OperatorGuard("operator-credential-long-enough");
    const context = (headers: Record<string, string>) => ({ switchToHttp: () => ({ getRequest: () => ({ headers, originalUrl: "/internal/closing-odds" }) }) }) as never;
    expect(() => guard.canActivate(context({}))).toThrow("Not found");
    expect(() => guard.canActivate(context({ "x-operator-credential": "wrong" }))).toThrow("Not found");
    expect(guard.canActivate(context({ "x-operator-credential": "operator-credential-long-enough" }))).toBe(true);
  });
});

describe("closing odds route: response codes", () => {
  it("answers 201 with the stored rows and a private no-store header", async () => {
    const { controller, repository } = setup(createdResult(true));
    const reply = await post(controller, body);
    expect(reply.status).toBe(201);
    expect(reply.headers["Cache-Control"]).toBe("private, no-store, max-age=0");
    expect(reply.body).toEqual(createdResult(true));
    expect(repository.recordClosingOddsBook).toHaveBeenCalledTimes(1);
    expect(repository.recordClosingOddsBook).toHaveBeenCalledWith(body);
  });

  it("answers 200 for an identical replay", async () => {
    const { controller } = setup(createdResult(false));
    const reply = await post(controller, body);
    expect(reply.status).toBe(200);
    expect(reply.body).toEqual(createdResult(false));
  });

  it("answers 409 CLOSING_OBSERVATION_CONFLICT for a changed price", async () => {
    const { controller } = setup(async () => { throw Object.assign(new Error("CLOSING_OBSERVATION_CONFLICT"), { code: "CLOSING_OBSERVATION_CONFLICT" }); });
    expect(await failure(post(controller, body))).toEqual({ status: 409, response: { code: "CLOSING_OBSERVATION_CONFLICT" } });
  });

  it.each([
    "INCOMPLETE_MARKET_SET", "DUPLICATE_SELECTION", "UNSUPPORTED_MARKET", "INVALID_OBSERVED_AT", "OBSERVED_AT_NOT_PRE_KICKOFF", "OBSERVED_AT_IN_FUTURE",
    "RECORDED_AFTER_KICKOFF", "FIXTURE_ALREADY_SETTLED", "INVALID_ODDS", "INVALID_SOURCE_CONVENTION", "FIXTURE_NOT_FOUND", "UNKNOWN_SOURCE_CONVENTION",
  ])("answers 422 with the reason code %s", async (code) => {
    const { controller } = setup(async () => { throw Object.assign(new Error(code), { code }); });
    expect(await failure(post(controller, body))).toEqual({ status: 422, response: { code } });
  });

  it("does not translate unexpected repository failures into a client error", async () => {
    const { controller } = setup(async () => { throw new Error("connection reset"); });
    await expect(post(controller, body)).rejects.toThrow("connection reset");
  });

  it("answers 503 when no database is configured", async () => {
    const previous = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      const controller = new ClosingOddsController(new ClosingOddsService());
      expect((await failure(post(controller, body))).status).toBe(503);
    } finally {
      if (previous !== undefined) process.env.DATABASE_URL = previous;
    }
  });
});

describe("closing odds route: strict body", () => {
  it.each([
    ["an observationKind", { ...body, observationKind: "MARKET_CLOSE" }],
    ["an oddsFormat", { ...body, oddsFormat: "DECIMAL" }],
    ["an unknown key", { ...body, extra: 1 }],
    ["an observationKind inside a selection", { ...body, selections: [{ selection: "HOME", decimalOdds: "2.10", observationKind: "MARKET_OPEN" }, body.selections[1], body.selections[2]] }],
    ["a non-object selection", { ...body, selections: [null, body.selections[1], body.selections[2]] }],
    ["an array body", [body]],
    ["a null body", null],
    ["a string body", "closing"],
  ])("rejects %s with 400 and never calls the repository", async (_name, payload) => {
    const { controller, repository } = setup();
    const result = await failure(post(controller, payload));
    expect(result.status).toBe(400);
    expect((result.response as { code: string }).code).toMatch(/^INVALID_CLOSING_ODDS_/);
    expect(repository.recordClosingOddsBook).not.toHaveBeenCalled();
  });

  it("passes only the five known fields to the repository", async () => {
    const { controller, repository } = setup();
    await post(controller, body);
    const call = vi.mocked(repository.recordClosingOddsBook).mock.calls[0]![0] as unknown as Record<string, unknown>;
    expect(Object.keys(call).sort()).toEqual(["fixtureId", "market", "observedAt", "selections", "sourceConvention"]);
    expect(call).not.toHaveProperty("observationKind");
  });
});

const validArguments = ["record", "--fixture", "fixture-1", "--market", "ONE_X_TWO", "--source", "BOOKMAKER_BACK", "--observed-at", observedAt, "--odds", "HOME=2.10,DRAW=3.40,AWAY=3.60"];
const withOdds = (odds: string) => validArguments.map((value) => (value.startsWith("HOME=") ? odds : value));

describe("closing odds CLI: argument parsing", () => {
  it("parses a complete record command into the same input the route accepts", () => {
    expect(parseRecordArguments(validArguments)).toEqual({ ok: true, input: body });
  });

  it("keeps duplicate selections so the domain validator can reject them", () => {
    expect(parseRecordArguments(withOdds("HOME=2.10,HOME=2.20,AWAY=3.60"))).toMatchObject({ ok: true, input: { selections: [{ selection: "HOME" }, { selection: "HOME" }, { selection: "AWAY" }] } });
  });

  it.each([
    ["no command", [], "UNKNOWN_COMMAND"],
    ["a different command", ["delete", ...validArguments.slice(1)], "UNKNOWN_COMMAND"],
    ["an unknown option", [...validArguments, "--kind", "MARKET_CLOSE"], "INVALID_ARGUMENTS"],
    ["a missing --fixture", validArguments.filter((_, index) => index !== 1 && index !== 2), "MISSING_ARGUMENT"],
    ["a blank --source", validArguments.map((value) => (value === "BOOKMAKER_BACK" ? " " : value)), "MISSING_ARGUMENT"],
    ["an option without a value", ["record", "--fixture"], "INVALID_ARGUMENTS"],
    ["an odds pair without a value", withOdds("HOME=,DRAW=3.40,AWAY=3.60"), "INVALID_ODDS_ARGUMENT"],
    ["an odds pair without a name", withOdds("=2.10,DRAW=3.40,AWAY=3.60"), "INVALID_ODDS_ARGUMENT"],
    ["an odds pair with two equals signs", withOdds("HOME=2.10=3,DRAW=3.40,AWAY=3.60"), "INVALID_ODDS_ARGUMENT"],
    ["an empty odds list", withOdds(","), "INVALID_ODDS_ARGUMENT"],
  ])("rejects %s with a Russian message", (_name, argv, code) => {
    const parsed = parseRecordArguments(argv);
    expect(parsed.ok).toBe(false);
    expect(parsed).toMatchObject({ code });
    expect((parsed as { message: string }).message).toMatch(/[А-Яа-я]/);
  });

  it("has a Russian explanation for every repository rejection code", () => {
    const codes = [
      "INCOMPLETE_MARKET_SET", "DUPLICATE_SELECTION", "UNSUPPORTED_MARKET", "INVALID_OBSERVED_AT", "OBSERVED_AT_NOT_PRE_KICKOFF", "OBSERVED_AT_IN_FUTURE",
      "RECORDED_AFTER_KICKOFF", "FIXTURE_ALREADY_SETTLED", "INVALID_ODDS", "INVALID_SOURCE_CONVENTION", "FIXTURE_NOT_FOUND", "UNKNOWN_SOURCE_CONVENTION", "CLOSING_OBSERVATION_CONFLICT",
    ];
    for (const code of codes) expect((CLOSING_ODDS_REJECTION_COPY as Record<string, string>)[code]).toMatch(/[А-Яа-я]/);
  });

  it("answers usage errors and --help without touching a repository", async () => {
    const lines: string[] = [];
    const out = (line: string) => { lines.push(line); };
    expect(await runClosingOddsCommand([], { repository: null, out })).toBe(2);
    expect(await runClosingOddsCommand(["--help"], { repository: null, out })).toBe(0);
    expect(await runClosingOddsCommand(["record", "--fixture"], { repository: null, out })).toBe(2);
    expect(lines.join("\n")).toContain("Использование");
    expect(lines.join("\n")).toContain("Ошибка");
  });
});

const EXACT_SCORE_ODDS = "0-0=9.5,0-1=12,0-2=26,0-3=70,1-0=7,1-1=6.5,1-2=13,1-3=40,2-0=9,2-1=9.5,2-2=19,2-3=60,3-0=18,3-1=20,3-2=40,3-3=100,OTHER=30";
const withMarket = (market: string, odds: string) => validArguments.map((value, index) => (index === 4 ? market : value.startsWith("HOME=") ? odds : value));

describe("closing odds CLI: Asian handicap and exact score (Phase 14)", () => {
  it("parses a handicap line and the 17 exact-score selections without judging them", () => {
    expect(parseRecordArguments(withMarket("ASIAN_HANDICAP:-0.75", "HOME=1.90,AWAY=1.95"))).toEqual({
      ok: true,
      input: { ...body, market: "ASIAN_HANDICAP:-0.75", selections: [{ selection: "HOME", decimalOdds: "1.90" }, { selection: "AWAY", decimalOdds: "1.95" }] },
    });
    const exact = parseRecordArguments(withMarket("EXACT_SCORE", EXACT_SCORE_ODDS));
    expect(exact).toMatchObject({ ok: true, input: { market: "EXACT_SCORE" } });
    expect((exact as { input: { selections: unknown[] } }).input.selections).toHaveLength(17);
    // Syntax only: an unknown line and a foreign selection are passed through for the domain validator to refuse.
    expect(parseRecordArguments(withMarket("ASIAN_HANDICAP:-0.80", "HOME=1.90,DRAW=3.0"))).toMatchObject({ ok: true, input: { market: "ASIAN_HANDICAP:-0.80" } });
  });

  it("pins the help text and the UNSUPPORTED_MARKET explanation to the five market families", async () => {
    const lines: string[] = [];
    expect(await runClosingOddsCommand(["--help"], { repository: null, out: (line) => { lines.push(line); } })).toBe(0);
    const help = lines.join("\n");
    expect(help).toContain("ONE_X_TWO | OVER_UNDER_2_5 | BTTS | EXACT_SCORE | ASIAN_HANDICAP:<линия>");
    expect(help).toContain("--market ASIAN_HANDICAP:-0.75 --odds HOME=1.90,AWAY=1.95");
    expect(help).toContain("--market EXACT_SCORE --odds 0-0=9.5");
    expect(help).toContain("OTHER=30");
    expect(help).toContain("отдельно для каждой линии");
    expect(help).toContain("Набор записывается целиком одной транзакцией и только до начала матча и до расчёта.");
    const copy = CLOSING_ODDS_REJECTION_COPY.UNSUPPORTED_MARKET;
    for (const family of ["ONE_X_TWO", "OVER_UNDER_2_5", "BTTS", "EXACT_SCORE", "ASIAN_HANDICAP:<линия>"]) expect(copy).toContain(family);
    expect(copy).toContain("от -2.5 до +2.5 шагом 0.25");
    // The texts of the other codes are unchanged.
    expect(CLOSING_ODDS_REJECTION_COPY.INCOMPLETE_MARKET_SET).toBe("набор неполный: нужны все выборы рынка, ровно по одному разу");
    expect(CLOSING_ODDS_REJECTION_COPY.RECORDED_AFTER_KICKOFF).toBe("матч уже начался: запись закрывающих коэффициентов закрыта");
  });
});

const root = resolve(import.meta.dirname, "../..");
const databaseRoot = resolve(root, "packages/database");
const prismaCli = resolve(databaseRoot, "node_modules/prisma/build/index.js");
const typescriptCli = resolve(root, "node_modules/typescript/bin/tsc");
const cliScript = resolve(root, "scripts/closing-odds.mjs");
const container = `bet-stats-closing-odds-cli-${process.pid}`;

function docker(...args: string[]): string {
  return execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function waitForPostgres(): void {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { docker("exec", container, "pg_isready", "-h", "127.0.0.1", "-U", "postgres", "-d", "bet_stats"); return; }
    catch { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500); }
  }
  throw new Error("PostgreSQL did not become ready");
}

describe("closing odds CLI against a throwaway PostgreSQL", () => {
  let prisma: PrismaClient;
  let databaseUrl: string;
  const kickoffUtc = new Date(Date.now() + 7 * 24 * 3_600_000).toISOString();
  const observedHourAgo = new Date(Date.now() - 3_600_000).toISOString();
  const observedTwoHoursAgo = new Date(Date.now() - 2 * 3_600_000).toISOString();
  const cliArguments = (at: string, odds = "HOME=2.10,DRAW=3.40,AWAY=3.60", fixture = "cli-fixture") => ["record", "--fixture", fixture, "--market", "ONE_X_TWO", "--source", "CLI_SOURCE", "--observed-at", at, "--odds", odds];

  beforeAll(async () => {
    docker("run", "--detach", "--name", container, "--env", "POSTGRES_PASSWORD=postgres", "--env", "POSTGRES_DB=bet_stats", "--publish", "127.0.0.1::5432", "postgres:18-alpine");
    waitForPostgres();
    const port = docker("port", container, "5432/tcp").split(":").at(-1)!;
    databaseUrl = `postgresql://postgres:postgres@127.0.0.1:${port}/bet_stats`;
    execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], { cwd: databaseRoot, env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: "pipe" });
    // The spawned script loads the compiled packages: refresh them so the test never runs against stale output.
    for (const project of ["packages/domain", "packages/database"]) execFileSync(process.execPath, [typescriptCli, "-p", "tsconfig.json"], { cwd: resolve(root, project), stdio: "pipe" });
    prisma = createPrismaClient(databaseUrl);
    await prisma.$executeRawUnsafe(`
      INSERT INTO "League" (id,name,"countryCode","updatedAt") VALUES ('cli-league','League','GB',now());
      INSERT INTO "Season" (id,"leagueId",label,"startsOn","endsOn","updatedAt") VALUES ('cli-season','cli-league','2026','2026-01-01','2027-12-31',now());
      INSERT INTO "Team" (id,name,"normalizedName","countryCode","updatedAt") VALUES ('cli-home','Home','home','GB',now()),('cli-away','Away','away','GB',now());
      INSERT INTO "Fixture" (id,"leagueId","seasonId","homeTeamId","awayTeamId","kickoffUtc",status,"updatedAt") VALUES ('cli-fixture','cli-league','cli-season','cli-home','cli-away','${kickoffUtc}','SCHEDULED',now());
      INSERT INTO "ManualOddsSnapshot" (id,"fixtureId",market,"inputHash",source,receipt,"submittedAt") VALUES ('cli-odds','cli-fixture','ONE_X_TWO','cli-odds-hash','CLI_SOURCE','{}',now());
    `);
  }, 240_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    try { docker("rm", "--force", "--volumes", container); } catch { /* owned cleanup */ }
  });

  const rowCount = async (): Promise<number> => Number((await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(`SELECT count(*) AS count FROM "ClosingOddsObservation" WHERE "fixtureId"='cli-fixture'`))[0]!.count);

  it("records a set through the shared repository, answers 'already recorded' on replay and refuses a changed price", async () => {
    const repository = createPrismaClosingOddsRepository({ database: prisma });
    const lines: string[] = [];
    const out = (line: string) => { lines.push(line); };
    expect(await runClosingOddsCommand(cliArguments(observedHourAgo), { repository, out })).toBe(0);
    expect(lines[0]).toMatch(/^Записано: 3 наблюдений/);
    expect(await rowCount()).toBe(3);

    lines.length = 0;
    expect(await runClosingOddsCommand(cliArguments(observedHourAgo), { repository, out })).toBe(0);
    expect(lines[0]).toMatch(/^Уже записано/);
    expect(await rowCount()).toBe(3);

    lines.length = 0;
    expect(await runClosingOddsCommand(cliArguments(observedHourAgo, "HOME=2.10,DRAW=3.40,AWAY=3.70"), { repository, out })).toBe(1);
    expect(lines[0]).toContain("CLOSING_OBSERVATION_CONFLICT");
    expect(await rowCount()).toBe(3);

    lines.length = 0;
    expect(await runClosingOddsCommand(cliArguments(observedHourAgo, "HOME=2.10,DRAW=3.40,AWAY=3.60", "cli-missing"), { repository, out })).toBe(1);
    expect(lines[0]).toContain("FIXTURE_NOT_FOUND");
  });

  it("records full Asian handicap and exact-score sets through the CLI, replays safely and refuses an unknown line", async () => {
    const repository = createPrismaClosingOddsRepository({ database: prisma });
    const lines: string[] = [];
    const out = (line: string) => { lines.push(line); };
    const argumentsFor = (market: string, odds: string) => ["record", "--fixture", "cli-fixture", "--market", market, "--source", "CLI_SOURCE", "--observed-at", observedHourAgo, "--odds", odds];
    const count = async (market: string) => Number((await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(`SELECT count(*) AS count FROM "ClosingOddsObservation" WHERE "fixtureId"='cli-fixture' AND market=$1`, market))[0]!.count);

    expect(await runClosingOddsCommand(argumentsFor("ASIAN_HANDICAP:-0.75", "HOME=1.90,AWAY=1.95"), { repository, out })).toBe(0);
    expect(lines[0]).toMatch(/^Записано: 2 наблюдений/);
    expect(await count("ASIAN_HANDICAP:-0.75")).toBe(2);
    lines.length = 0;
    expect(await runClosingOddsCommand(argumentsFor("ASIAN_HANDICAP:-0.75", "HOME=1.90,AWAY=1.95"), { repository, out })).toBe(0);
    expect(lines[0]).toMatch(/^Уже записано/);
    expect(await count("ASIAN_HANDICAP:-0.75")).toBe(2);

    lines.length = 0;
    expect(await runClosingOddsCommand(argumentsFor("EXACT_SCORE", EXACT_SCORE_ODDS), { repository, out })).toBe(0);
    expect(lines[0]).toMatch(/^Записано: 17 наблюдений/);
    expect(await count("EXACT_SCORE")).toBe(17);
    lines.length = 0;
    expect(await runClosingOddsCommand(argumentsFor("EXACT_SCORE", EXACT_SCORE_ODDS), { repository, out })).toBe(0);
    expect(lines[0]).toMatch(/^Уже записано/);

    // An unknown line and an incomplete set are domain refusals with nothing written.
    lines.length = 0;
    expect(await runClosingOddsCommand(argumentsFor("ASIAN_HANDICAP:-0.80", "HOME=1.90,AWAY=1.95"), { repository, out })).toBe(1);
    expect(lines[0]).toContain("UNSUPPORTED_MARKET");
    for (const family of ["EXACT_SCORE", "ASIAN_HANDICAP:<линия>", "от -2.5 до +2.5 шагом 0.25"]) expect(lines[0]).toContain(family);
    expect(await count("ASIAN_HANDICAP:-0.80")).toBe(0);
    lines.length = 0;
    expect(await runClosingOddsCommand(argumentsFor("EXACT_SCORE", EXACT_SCORE_ODDS.split(",").slice(0, 16).join(",")), { repository, out })).toBe(1);
    expect(lines[0]).toContain("INCOMPLETE_MARKET_SET");
    expect(await count("EXACT_SCORE")).toBe(17);
  });

  it("the internal route writes the same sets and answers 201, 200 on replay and 422 UNSUPPORTED_MARKET", async () => {
    const controller = new ClosingOddsController(new ClosingOddsService(createPrismaClosingOddsRepository({ database: prisma })));
    const handicap = { fixtureId: "cli-fixture", market: "ASIAN_HANDICAP:+0.25", sourceConvention: "CLI_SOURCE", observedAt: observedHourAgo, selections: [{ selection: "HOME", decimalOdds: "2.00" }, { selection: "AWAY", decimalOdds: "1.85" }] };
    const first = await post(controller, handicap);
    expect(first.status).toBe(201);
    expect((first.body as RecordClosingOddsBookResult).observations).toHaveLength(2);
    expect((await post(controller, handicap)).status).toBe(200);
    expect(await failure(post(controller, { ...handicap, market: "ASIAN_HANDICAP:+1.00" }))).toEqual({ status: 422, response: { code: "UNSUPPORTED_MARKET" } });
    expect(await failure(post(controller, { ...handicap, market: "CORRECT_SCORE" }))).toEqual({ status: 422, response: { code: "UNSUPPORTED_MARKET" } });
    // The phase 13 pre-kickoff rule still holds for the new markets.
    expect(await failure(post(controller, { ...handicap, observedAt: new Date(Date.parse(kickoffUtc) + 1_000).toISOString() }))).toMatchObject({ status: 422 });
  });

  it("runs end to end as a spawned process: records, then reports 'already recorded'", () => {
    const run = (args: string[], env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: databaseUrl }) => {
      try { return { code: 0, stdout: execFileSync(process.execPath, [cliScript, ...args], { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) }; }
      catch (error) { const failed = error as { status: number; stdout: string; stderr: string }; return { code: failed.status, stdout: `${failed.stdout}${failed.stderr}` }; }
    };
    const first = run(cliArguments(observedTwoHoursAgo));
    expect(first.code).toBe(0);
    expect(first.stdout).toContain("Записано: 3 наблюдений");
    expect(first.stdout).not.toContain("Уже записано");
    const replay = run(cliArguments(observedTwoHoursAgo));
    expect(replay.code).toBe(0);
    expect(replay.stdout).toContain("Уже записано");
    const missingDatabase = run(cliArguments(observedTwoHoursAgo), { ...process.env, DATABASE_URL: "" });
    expect(missingDatabase.code).toBe(1);
    expect(missingDatabase.stdout).toContain("DATABASE_URL");
    const help = run(["--help"], { ...process.env, DATABASE_URL: "" });
    expect(help.code).toBe(0);
    expect(help.stdout).toContain("Использование");
  }, 60_000);
});
