// Seeds the canonical league/season catalogue for every football-data.org competition the
// platform is configured for, plus the external refs and FIXTURES/RESULTS capability rows
// that the gated ingestion path requires. Idempotent: safe to run on every boot.
//
// Usage: DATABASE_URL=postgresql://... node scripts/seed-configured-leagues.mjs
import { createPrismaClient } from "../packages/database/dist/client.js";

const PROVIDER = "football-data.org";
// football-data.org competition codes allowed by isConfiguredCompetitionCode (packages/domain
// provider.interface). api-football refs are intentionally not seeded: their numeric IDs are
// only needed for the fallback provider, and a wrong ID would silently poison the route.
const COMPETITIONS = [
  { code: "PL", name: "Premier League", country: "ENG" },
  { code: "PD", name: "La Liga", country: "ESP" },
  { code: "BL1", name: "Bundesliga", country: "GER" },
  { code: "SA", name: "Serie A", country: "ITA" },
  { code: "FL1", name: "Ligue 1", country: "FRA" },
  { code: "CL", name: "UEFA Champions League", country: "EU" },
  { code: "EL", name: "UEFA Europa League", country: "EU" },
];
// football-data.org identifies a season by an opaque numeric ID (e.g. "2502" for 2026/27),
// so no SeasonExternalRef is invented here — the sync maps the real ID on first fetch.
// Both seasons exist so the "current season" (by date containment) is always resolvable.
const SEASONS = [
  { year: 2025, label: "2025/26", startsOn: "2025-08-01", endsOn: "2026-05-31" },
  { year: 2026, label: "2026/27", startsOn: "2026-08-01", endsOn: "2027-05-31" },
];
const CAPABILITY_EXPIRES = new Date(Date.now() + 365 * 86_400_000);

async function main() {
  const db = createPrismaClient(process.env.DATABASE_URL);
  let leagues = 0;
  let seasons = 0;
  let capabilities = 0;
  let resultsCapabilities = 0;
  for (const competition of COMPETITIONS) {
    const league = await db.league.upsert({
      where: { id: `league-${competition.code.toLowerCase()}` },
      update: { name: competition.name },
      create: { id: `league-${competition.code.toLowerCase()}`, name: competition.name, countryCode: competition.country },
    });
    leagues += 1;
    await db.leagueExternalRef.upsert({
      where: { provider_externalId: { provider: PROVIDER, externalId: competition.code } },
      update: { leagueId: league.id },
      create: { leagueId: league.id, provider: PROVIDER, externalId: competition.code },
    });
    for (const season of SEASONS) {
      await db.season.upsert({
        where: { leagueId_label: { leagueId: league.id, label: season.label } },
        update: {},
        create: { id: `season-${competition.code.toLowerCase()}-${season.year}`, leagueId: league.id, label: season.label, startsOn: new Date(season.startsOn), endsOn: new Date(season.endsOn) },
      });
      seasons += 1;
    }
    // FIXTURES capability is anchored to the season that contains today (or the latest one),
    // which is the season the manual sync gates its requests against.
    const today = new Date();
    const rows = await db.season.findMany({ where: { leagueId: league.id } });
    const current = rows.find((row) => row.startsOn <= today && today <= row.endsOn) ?? [...rows].sort((a, b) => b.startsOn.getTime() - a.startsOn.getTime())[0];
    if (current) {
      await db.providerCapability.upsert({
        where: { provider_leagueId_seasonId_endpoint: { provider: PROVIDER, leagueId: league.id, seasonId: current.id, endpoint: "FIXTURES" } },
        update: { supported: true, expiresAt: CAPABILITY_EXPIRES },
        create: { provider: PROVIDER, leagueId: league.id, seasonId: current.id, endpoint: "FIXTURES", supported: true, verifiedAt: new Date(), expiresAt: CAPABILITY_EXPIRES },
      });
      capabilities += 1;
    }
    // RESULTS capability rows cover every configured competition x season (same row shape as
    // FIXTURES) so results-sync can pass its capability gate for any operator window.
    for (const season of rows) {
      await db.providerCapability.upsert({
        where: { provider_leagueId_seasonId_endpoint: { provider: PROVIDER, leagueId: league.id, seasonId: season.id, endpoint: "RESULTS" } },
        update: { supported: true, expiresAt: CAPABILITY_EXPIRES },
        create: { provider: PROVIDER, leagueId: league.id, seasonId: season.id, endpoint: "RESULTS", supported: true, verifiedAt: new Date(), expiresAt: CAPABILITY_EXPIRES },
      });
      resultsCapabilities += 1;
    }
  }
  console.info(`seeded ${leagues} leagues, ${seasons} seasons, ${capabilities} FIXTURES capabilities, ${resultsCapabilities} RESULTS capabilities`);
  await db.$disconnect();
}

main().catch((error) => {
  console.error("league seeding failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
