import { describe, expect, it, vi } from "vitest";
import { createLiveProviderFactories, resolveReplayProviderFactories } from "../../workers/data-sync/src/main.js";

describe("live provider harness composition smoke", () => {
  it("uses injected deterministic factories without constructing live credentialed clients", () => {
    const deterministic = { "football-data.org": vi.fn(() => ({ id: "fd" })), "api-football": vi.fn(() => ({ id: "api" })) } as any;
    const resolved = resolveReplayProviderFactories({ footballDataApiToken: "secret-a", apiFootballApiKey: "secret-b", providerFactories: deterministic });
    expect(resolved).toBe(deterministic);
    expect(deterministic["football-data.org"]).not.toHaveBeenCalled(); expect(deterministic["api-football"]).not.toHaveBeenCalled();
  });
  it("keeps live factories lazy and provider-specific", () => { const factories = createLiveProviderFactories({ footballDataApiToken: "a", apiFootballApiKey: "b" }); expect(Object.keys(factories)).toEqual(["football-data.org", "api-football"]); });
});
