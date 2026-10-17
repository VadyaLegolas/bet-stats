import { describe, expect, it, vi } from "vitest";

import { parseEvidenceProjection, type EvidenceProjection } from "../../packages/domain/src/index.js";

import {
  attachEvidenceDisplay,
  collectEvidenceFixtureIds,
  composeFixtureDisplay,
  loadEvidenceDisplay,
  loadEvidenceFixtureLabels,
  resolveTeamEvidence,
} from "../../apps/api/src/modules/evidence/evidence.service.js";

const AS_OF = "2026-08-29T14:00:00.000Z";

async function baseProjection() {
  return resolveTeamEvidence({ teamId: "team-arsenal", asOf: AS_OF });
}

describe("attachEvidenceDisplay", () => {
  it("adds team and fixture nulls without mutating the base projection", async () => {
    const base = await baseProjection();
    const baseKeys = Object.keys(base).sort();
    const result = await attachEvidenceDisplay(base, null, null);
    expect(result).toEqual({ ...base, team: null, fixture: null, fixtureLabels: {} });
    expect(Object.keys(result).sort()).toEqual([...baseKeys, "fixture", "fixtureLabels", "team"].sort());
    expect(Object.keys(base).sort()).toEqual(baseKeys);
    expect(Object.hasOwn(base, "team")).toBe(false);
    expect(Object.hasOwn(base, "fixture")).toBe(false);
  });

  it("attaches display entities verbatim while every projection field stays deep-equal", async () => {
    const base = await baseProjection();
    const team = { id: "team-arsenal", name: "Arsenal" };
    const fixture = { id: "fix-1", name: "Arsenal против Chelsea", kickoff: "2026-08-29T18:00:00.000Z" };
    const result = await attachEvidenceDisplay(base, team, fixture);
    expect(result.team).toEqual(team);
    expect(result.fixture).toEqual(fixture);
    expect(result.teamId).toEqual(base.teamId);
    expect(result.state).toEqual(base.state);
    expect(result.resolvedAsOfUtc).toEqual(base.resolvedAsOfUtc);
    expect(result.components).toEqual(base.components);
    const { team: resultTeam, fixture: resultFixture, fixtureLabels, ...projectionPart } = result;
    expect(projectionPart).toEqual(base);
    expect(resultTeam).toBe(team);
    expect(resultFixture).toBe(fixture);
    expect(fixtureLabels).toEqual({});
  });
});

describe("loadEvidenceDisplay", () => {
  it("short-circuits to both nulls when the lookup is null", async () => {
    await expect(loadEvidenceDisplay(null, "team-1", "fix-1")).resolves.toEqual({ team: null, fixture: null });
  });

  it("attaches a found team row and yields team null without throwing for an unknown team", async () => {
    const found = { findTeam: vi.fn().mockResolvedValueOnce({ id: "team-1", name: "Arsenal" }).mockResolvedValueOnce(null), findFixture: vi.fn() };
    const hit = await loadEvidenceDisplay(found, "team-1");
    expect(hit.team).toEqual({ id: "team-1", name: "Arsenal" });
    expect(hit.fixture).toBeNull();
    expect(found.findTeam).toHaveBeenCalledWith("team-1");
    const miss = await loadEvidenceDisplay(found, "team-unknown");
    expect(miss.team).toBeNull();
    expect(miss.fixture).toBeNull();
  });

  it("never touches findFixture when fixtureId is absent, empty or whitespace-only", async () => {
    const lookup = { findTeam: vi.fn().mockResolvedValue(null), findFixture: vi.fn() };
    await loadEvidenceDisplay(lookup, "team-1");
    await loadEvidenceDisplay(lookup, "team-1", "");
    await loadEvidenceDisplay(lookup, "team-1", "   ");
    expect(lookup.findFixture).not.toHaveBeenCalled();
  });

  it("maps a Prisma-shaped fixture row through composeFixtureDisplay", async () => {
    const row = {
      id: "fix-1",
      kickoffUtc: new Date("2026-08-29T18:00:00.000Z"),
      homeTeam: { name: "Arsenal" },
      awayTeam: { name: "Chelsea" },
    };
    const lookup = { findTeam: vi.fn().mockResolvedValue(null), findFixture: vi.fn().mockResolvedValueOnce(row) };
    const hit = await loadEvidenceDisplay(lookup, "team-1", "  fix-1  ");
    expect(lookup.findFixture).toHaveBeenCalledWith("fix-1");
    expect(hit.fixture).toEqual({ id: "fix-1", name: "Arsenal против Chelsea", kickoff: "2026-08-29T18:00:00.000Z" });
    expect(hit.team).toBeNull();
    const miss = await loadEvidenceDisplay({ findTeam: vi.fn().mockResolvedValue(null), findFixture: vi.fn().mockResolvedValue(null) }, "team-1", "fix-missing");
    expect(miss.fixture).toBeNull();
  });

  it("degrades a rejecting lookup to nulls and never rejects itself", async () => {
    const rejecting = {
      findTeam: vi.fn().mockRejectedValue(new Error("db down")),
      findFixture: vi.fn().mockRejectedValue(new Error("db down")),
    };
    await expect(loadEvidenceDisplay(rejecting, "team-1", "fix-1")).resolves.toEqual({ team: null, fixture: null });
    const halfBroken = {
      findTeam: vi.fn().mockResolvedValue({ id: "team-1", name: "Arsenal" }),
      findFixture: vi.fn().mockRejectedValue(new Error("db down")),
    };
    await expect(loadEvidenceDisplay(halfBroken, "team-1", "fix-1")).resolves.toEqual({ team: { id: "team-1", name: "Arsenal" }, fixture: null });
  });

  it("keeps the attached response parseable by the domain contract", async () => {
    const base = await baseProjection();
    const attached = attachEvidenceDisplay(base, { id: "team-arsenal", name: "Arsenal" }, { id: "fix-1", name: "Arsenal против Chelsea", kickoff: "2026-08-29T18:00:00.000Z" });
    expect(() => parseEvidenceProjection(attached)).not.toThrow();
    expect(parseEvidenceProjection(attached)).toMatchObject({ team: { id: "team-arsenal", name: "Arsenal" }, fixture: { id: "fix-1" } });
  });
});

describe("composeFixtureDisplay", () => {
  it("joins the team names with the product convention and serializes kickoff as ISO", () => {
    const composed = composeFixtureDisplay({
      id: "fix-9",
      kickoffUtc: new Date("2026-10-17T19:45:00.000Z"),
      homeTeam: { name: "Ливерпуль" },
      awayTeam: { name: "Манчестер Сити" },
    });
    expect(composed).toEqual({ id: "fix-9", name: "Ливерпуль против Манчестер Сити", kickoff: "2026-10-17T19:45:00.000Z" });
  });
});

describe("evidence fixture labels", () => {
  const ref = (fixtureId: string) => ({ fixtureId, effectiveAt: AS_OF, observedAt: AS_OF, sourceUpdatedAt: null, payloadHash: `h-${fixtureId}`, payloadBytes: 8 });
  const projection = (inputs: readonly string[], refs: readonly string[]) => ({
    receipt: { inputs: inputs.map(ref) },
    components: { form5: { sourceRefs: refs.map(ref) } },
  }) as unknown as EvidenceProjection;

  it("collects distinct fixture ids from receipt inputs and component source refs", () => {
    expect(collectEvidenceFixtureIds(projection(["fix-a", "fix-b"], ["fix-b", "fix-c"]))).toEqual(["fix-a", "fix-b", "fix-c"]);
  });

  it("returns no ids for an empty projection", () => {
    expect(collectEvidenceFixtureIds(projection([], []))).toEqual([]);
  });

  it("maps fixture ids to composed team labels through the lookup", async () => {
    const rows = [
      { id: "fix-a", kickoffUtc: new Date("2026-08-22T16:30:00.000Z"), homeTeam: { name: "Bologna" }, awayTeam: { name: "Inter" } },
      { id: "fix-b", kickoffUtc: new Date("2026-08-30T18:45:00.000Z"), homeTeam: { name: "Roma" }, awayTeam: { name: "Napoli" } },
    ];
    const findFixtures = vi.fn().mockResolvedValue(rows);
    const labels = await loadEvidenceFixtureLabels({ findTeam: vi.fn(), findFixture: vi.fn(), findFixtures }, projection(["fix-a", "fix-b", "fix-c"], ["fix-b"]));
    expect(findFixtures).toHaveBeenCalledWith(["fix-a", "fix-b", "fix-c"]);
    expect(labels).toEqual({ "fix-a": "Bologna против Inter", "fix-b": "Roma против Napoli" });
  });

  it("degrades to an empty map for null lookups, empty projections and failures", async () => {
    await expect(loadEvidenceFixtureLabels(null, projection(["fix-a"], []))).resolves.toEqual({});
    const findFixtures = vi.fn();
    await expect(loadEvidenceFixtureLabels({ findTeam: vi.fn(), findFixture: vi.fn(), findFixtures }, projection([], []))).resolves.toEqual({});
    expect(findFixtures).not.toHaveBeenCalled();
    const rejecting = vi.fn().mockRejectedValue(new Error("db down"));
    await expect(loadEvidenceFixtureLabels({ findTeam: vi.fn(), findFixture: vi.fn(), findFixtures: rejecting }, projection(["fix-a"], []))).resolves.toEqual({});
  });

  it("attaches an explicit labels map through attachEvidenceDisplay", async () => {
    const attached = await attachEvidenceDisplay(await baseProjection(), null, null, { "fix-a": "Bologna против Inter" });
    expect(attached.fixtureLabels).toEqual({ "fix-a": "Bologna против Inter" });
  });
});
