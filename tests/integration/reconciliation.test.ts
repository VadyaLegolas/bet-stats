import { describe, expect, it } from "vitest";

import {
  appendReconciliationDecision,
  reconcileFixture,
  type ReconciliationDecision,
} from "../../packages/domain/src/reconciliation.js";

const incoming = {
  provider: "football-data",
  externalId: "fixture-101",
  homeTeamExternalId: "arsenal",
  awayTeamExternalId: "chelsea",
  kickoffUtc: "2026-09-01T18:00:00.000Z",
};

describe("fixture reconciliation", () => {
  it("resolves an exact provider reference idempotently", () => {
    const result = reconcileFixture(incoming, {
      externalReference: { canonicalFixtureId: "fx-1", provider: "football-data", externalId: "fixture-101" },
      candidates: [],
    });

    expect(result).toMatchObject({ disposition: "resolved", canonicalFixtureId: "fx-1", method: "EXACT_EXTERNAL_REF" });
  });

  it("auto-resolves only one conservative team-pair candidate", () => {
    const result = reconcileFixture(incoming, {
      candidates: [
        {
          canonicalFixtureId: "fx-2",
          kickoffUtc: "2026-09-02T00:00:00.000Z",
          teamPairExact: true,
          identityConfidence: "strong",
        },
      ],
    });

    expect(result).toMatchObject({ disposition: "resolved", canonicalFixtureId: "fx-2", method: "UNIQUE_CONSERVATIVE_MATCH" });
  });

  it("quarantines ambiguous, fuzzy, and time-window-only candidates", () => {
    const strong = {
      kickoffUtc: "2026-09-01T20:00:00.000Z",
      teamPairExact: true,
      identityConfidence: "strong" as const,
    };

    expect(
      reconcileFixture(incoming, {
        candidates: [
          { ...strong, canonicalFixtureId: "fx-1" },
          { ...strong, canonicalFixtureId: "fx-2" },
        ],
      }),
    ).toMatchObject({ disposition: "review", reason: "AMBIGUOUS_CANDIDATES" });

    expect(
      reconcileFixture(incoming, {
        candidates: [{ ...strong, canonicalFixtureId: "fx-3", identityConfidence: "fuzzy" }],
      }),
    ).toMatchObject({ disposition: "review", reason: "INSUFFICIENT_IDENTITY_EVIDENCE" });

    expect(
      reconcileFixture(incoming, {
        candidates: [{ ...strong, canonicalFixtureId: "fx-4", teamPairExact: false }],
      }),
    ).toMatchObject({ disposition: "review", reason: "INSUFFICIENT_IDENTITY_EVIDENCE" });
  });

  it("uses the ±36 hour window for candidate generation but never as merge proof", () => {
    const result = reconcileFixture(incoming, {
      candidates: [
        {
          canonicalFixtureId: "fx-near",
          kickoffUtc: "2026-09-03T05:59:59.000Z",
          teamPairExact: false,
          identityConfidence: "fuzzy",
        },
        {
          canonicalFixtureId: "fx-far",
          kickoffUtc: "2026-09-03T06:00:01.000Z",
          teamPairExact: true,
          identityConfidence: "strong",
        },
      ],
    });

    expect(result).toMatchObject({ disposition: "review", candidateFixtureIds: ["fx-near"] });
  });

  it("continues a postponement only through existing external-reference lineage", () => {
    const withLineage = reconcileFixture(
      { ...incoming, kickoffUtc: "2026-09-04T18:00:00.000Z" },
      {
        externalReference: { canonicalFixtureId: "fx-1", provider: "football-data", externalId: "fixture-101" },
        candidates: [],
      },
    );
    const withoutLineage = reconcileFixture(
      { ...incoming, externalId: "fixture-new", kickoffUtc: "2026-09-04T18:00:00.000Z" },
      {
        candidates: [
          {
            canonicalFixtureId: "fx-1",
            kickoffUtc: incoming.kickoffUtc,
            teamPairExact: true,
            identityConfidence: "strong",
          },
        ],
        suspectedPostponement: true,
      },
    );

    expect(withLineage).toMatchObject({ disposition: "resolved", canonicalFixtureId: "fx-1", updateKickoff: true });
    expect(withoutLineage).toMatchObject({ disposition: "review", reason: "POSTPONEMENT_WITHOUT_LINEAGE" });
  });
});

describe("append-only reconciliation decisions", () => {
  it("appends evidence and supersession without mutating history", () => {
    const first: ReconciliationDecision = {
      id: "decision-1",
      action: "QUARANTINE",
      method: "MANUAL_REVIEW",
      evidence: { reason: "ambiguous" },
      confidence: 0.4,
      actor: "system",
      decidedAt: "2026-08-28T08:00:00.000Z",
    };
    const history = Object.freeze([Object.freeze(first)]);

    const next = appendReconciliationDecision(history, {
      id: "decision-2",
      action: "LINK",
      method: "OPERATOR_CONFIRMED",
      evidence: { externalReference: "fixture-101" },
      confidence: 1,
      actor: "operator:vlad",
      decidedAt: "2026-08-28T09:00:00.000Z",
      supersedesDecisionId: "decision-1",
    });

    expect(history).toHaveLength(1);
    expect(next).toHaveLength(2);
    expect(next[0]).toEqual(first);
    expect(next[1]?.supersedesDecisionId).toBe("decision-1");
  });
});
