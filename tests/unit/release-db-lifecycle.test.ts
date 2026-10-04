import { describe, expect, it, vi } from "vitest";
import { delimiter, dirname } from "node:path";
import { EventEmitter } from "node:events";

import { runOwnedIntegrationGate } from "../../scripts/verify-release-integration.mjs";
import { armFatalLiveSupervision, runSupervisedLiveOwner, superviseLiveChildren } from "../e2e/live-provider-stack.js";

describe("release integration resource lifecycle", () => {
  it("keeps the owned database and Redis alive until Vitest exits, then cleans them once", async () => {
    const events: string[] = [];
    const stop = vi.fn(async () => { events.push("stop"); });
    const start = vi.fn(async () => {
      events.push("start");
      return { databaseUrl: "postgresql://owned", redisUrl: "redis://owned", stop };
    });
    const run = vi.fn(async (environment: NodeJS.ProcessEnv) => {
      events.push("run");
      expect(environment.DATABASE_URL).toBe("postgresql://owned");
      expect(environment.REDIS_URL).toBe("redis://owned");
      expect(environment.PATH?.split(delimiter)[0]).toBe(dirname(process.execPath));
      expect(stop).not.toHaveBeenCalled();
      return 0;
    });

    await expect(runOwnedIntegrationGate({ start, run, environment: { SENTINEL: "preserved" } })).resolves.toBe(0);
    expect(events).toEqual(["start", "run", "stop"]);
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("still cleans the exact owned resources when Vitest fails", async () => {
    const stop = vi.fn(async () => undefined);
    await expect(runOwnedIntegrationGate({
      start: async () => ({ databaseUrl: "postgresql://owned", redisUrl: "redis://owned", stop }),
      run: async () => 17,
      environment: {},
    })).resolves.toBe(17);
    expect(stop).toHaveBeenCalledTimes(1);
  });
});

describe("live child-process supervision", () => {
  it("terminates the sibling and rejects the owner when a child fails", async () => {
    const api = Object.assign(new EventEmitter(), { pid: 101 });
    const web = Object.assign(new EventEmitter(), { pid: 102 });
    const terminated: number[] = [];
    const supervision = superviseLiveChildren(
      [{ label: "api", child: api }, { label: "web", child: web }],
      async (child) => { terminated.push(child.pid); child.emit("close", null, "SIGTERM"); },
    );

    api.emit("exit", 1, null);

    await expect(supervision.failure).rejects.toThrow("LIVE_CHILD_FAILED:api:exit=1");
    expect(terminated).toEqual([102]);
  });

  it("rejects the awaited owner promptly and surfaces API stderr after readiness", async () => {
    const api = Object.assign(new EventEmitter(), { pid: 201 });
    const web = Object.assign(new EventEmitter(), { pid: 202 });
    const terminated: number[] = [];
    const supervision = superviseLiveChildren(
      [
        { label: "api", child: api, diagnostic: () => "PrismaClientKnownRequestError: connection pool closed" },
        { label: "web", child: web },
      ],
      async (child) => { terminated.push(child.pid); child.emit("close", null, "SIGTERM"); },
    );
    const owner = runSupervisedLiveOwner(
      supervision,
      () => new Promise<never>(() => undefined),
    );

    api.emit("exit", 1, null);

    await expect(owner).rejects.toThrow(/LIVE_CHILD_FAILED:api:exit=1.*PrismaClientKnownRequestError: connection pool closed/);
    expect(terminated).toEqual([202]);
  });

  it("turns an API kill after readiness into a fatal Playwright-owner diagnostic", async () => {
    const api = Object.assign(new EventEmitter(), { pid: 301 });
    const web = Object.assign(new EventEmitter(), { pid: 302 });
    const supervision = superviseLiveChildren(
      [{ label: "api", child: api, diagnostic: () => "bounded api stderr" }, { label: "web", child: web }],
      async (child) => { child.emit("close", null, "SIGTERM"); },
    );
    const failure = new Promise<Error>((resolve) => armFatalLiveSupervision(supervision, resolve));

    api.emit("exit", null, "SIGKILL");

    await expect(failure).resolves.toMatchObject({ message: expect.stringMatching(/LIVE_CHILD_FAILED:api:exit=SIGKILL.*bounded api stderr/) });
  });
});
