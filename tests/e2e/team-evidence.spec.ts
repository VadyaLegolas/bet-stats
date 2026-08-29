import { expect, test, type Page } from "@playwright/test";

const kickoff = "2026-08-29T14:00:00.000Z";
const evidenceUrl = `/teams/team-arsenal/evidence?asOf=${encodeURIComponent(kickoff)}&fixtureId=fixture-premier-league-001`;

async function missing(name: string, assertion: () => Promise<unknown>) {
  try {
    await assertion();
  } catch {
    throw new Error(`Missing Phase 2 team-evidence behavior: ${name}`);
  }
}

async function stubEvidence(page: Page, overrides: Record<string, unknown> = {}) {
  await page.route("**/internal-api/teams/team-arsenal/evidence**", (route) =>
    route.fulfill({
      json: {
        team: { id: "team-arsenal", name: "Arsenal" },
        fixture: { id: "fixture-premier-league-001", name: "Arsenal vs Chelsea", kickoff },
        requestedAsOf: kickoff,
        resolvedAsOf: kickoff,
        displayTimeZone: "Europe/Warsaw",
        state: "LIMITED",
        limitationReason: "Only 3 eligible matches existed at this cutoff.",
        summaries: {
          five: { value: 1.8, sampleSize: 3, requestedSampleSize: 5, sourceUpdatedAt: null, limitationReason: "Limited sample: 3 eligible matches" },
          ten: { value: null, sampleSize: 0, requestedSampleSize: 10, sourceUpdatedAt: null, limitationReason: "No eligible matches with complete provenance" },
        },
        trace: [{ fixtureId: "past-1", effectiveAt: "2026-08-20T18:00:00.000Z", observedAt: "2026-08-20T20:00:00.000Z" }],
        receipt: { configVersion: "form-v1", buildId: "build-1", inputIds: ["past-1"] },
        ...overrides,
      },
    }),
  );
}

test.describe("fixture-to-cutoff team evidence contract", () => {
  test.use({ timezoneId: "Europe/Warsaw" });

  test("links a fixture team to kickoff evidence, echoes UTC, and preserves Back navigation", async ({ page }) => {
    await stubEvidence(page);
    await page.goto("/fixtures/fixture-premier-league-001");
    await missing("D-17 fixture team link passes kickoff as asOf", async () => {
      const link = page.getByRole("link", { name: "View Arsenal evidence at kickoff" });
      await expect(link).toHaveAttribute("href", new RegExp(`asOf=${encodeURIComponent(kickoff)}`));
      await link.click();
    });
    await missing("D-17 exact server-resolved UTC cutoff echo", () => expect(page.getByText(kickoff, { exact: true })).toBeVisible());
    await missing("D-17 fixture-origin context and Back to fixture", async () => {
      await expect(page.getByText("Evidence requested for Arsenal vs Chelsea kickoff")).toBeVisible();
      await page.getByRole("link", { name: "Back to fixture" }).click();
      await expect(page).toHaveURL(/\/fixtures\/fixture-premier-league-001/);
    });
  });

  test("renders stable trace, limited samples, null reasons, and reproduction receipt", async ({ page }) => {
    await stubEvidence(page);
    await page.goto(evidenceUrl);
    await missing("D-18 truncated-history LIMITED state with actual sample", async () => {
      await expect(page.getByText("Limited sample: 3 eligible matches", { exact: true })).toBeVisible();
      await expect(page.getByText("3/5", { exact: true })).toBeVisible();
    });
    await missing("D-19 null value renders Not available with adjacent reason", async () => {
      await expect(page.getByText("Not available", { exact: true })).toBeVisible();
      await expect(page.getByText("No eligible matches with complete provenance", { exact: true })).toBeVisible();
      await expect(page.getByText("0", { exact: true })).toHaveCount(0);
    });
    await missing("D-18 chronological trace and D-20 reproduction receipt", async () => {
      await expect(page.getByRole("heading", { name: "Eligible match trace" })).toBeVisible();
      await expect(page.getByText("past-1", { exact: true })).toBeVisible();
      await expect(page.getByText(/Reproduction receipt.*form-v1.*1 input/)).toBeVisible();
    });
  });

  test("fails closed for invalid cutoff, missing freshness, and missing provenance", async ({ page }) => {
    await stubEvidence(page, {
      resolvedAsOf: null,
      state: "UNAVAILABLE",
      limitationReason: "The cutoff is invalid.",
      summaries: { five: { value: null, sourceUpdatedAt: null, limitationReason: "Source capture time is unavailable" } },
      trace: [],
      receipt: null,
    });
    await page.goto("/teams/team-arsenal/evidence?asOf=not-a-date");
    await missing("D-17 invalid cutoff never falls back to latest evidence", async () => {
      await expect(page.getByText("This cutoff could not be used. Enter a valid supported date and time.")).toBeVisible();
      await expect(page.getByText(/latest evidence/i)).toHaveCount(0);
    });
    await missing("D-19 missing sourceUpdatedAt is explicit rather than zero", async () => {
      await expect(page.getByText("Source capture time is unavailable", { exact: true })).toBeVisible();
      await expect(page.getByText(/1 Jan 1970|1970-01-01/)).toHaveCount(0);
    });
    await missing("D-20 missing provenance blocks affected evidence", () =>
      expect(page.getByText(/provenance.*unavailable|cannot be reproduced/i)).toBeVisible(),
    );
  });

  test("contains only historical evidence language", async ({ page }) => {
    await stubEvidence(page);
    await page.goto(evidenceUrl);
    await missing("D-20 responsible historical-evidence copy", async () => {
      await expect(page.getByText("What the system could know at the selected time.")).toBeVisible();
      await expect(page.getByText(/forecast probability|odds|value bet|recommendation|confidence score|guaranteed|risk-free|bet now/i)).toHaveCount(0);
    });
  });
});
