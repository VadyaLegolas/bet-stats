import { describe, expect, it, vi } from "vitest";

import { ClosingOddsController } from "../../apps/api/src/modules/closing-odds/closing-odds.controller.js";
import { ClosingOddsService } from "../../apps/api/src/modules/closing-odds/closing-odds.service.js";
import { OperatorGuard } from "../../apps/api/src/modules/reconciliation/operator.guard.js";
import type { ClosingOddsRepository, RecordClosingOddsBookResult, StoredClosingObservation } from "@bet-stats/database";

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
