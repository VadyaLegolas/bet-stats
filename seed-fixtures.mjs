import { createPrismaClient } from "./packages/database/dist/client.js";
import { createHash } from "node:crypto";

const db = createPrismaClient(process.env.DATABASE_URL);

async function main() {
  const league = await db.league.upsert({
    where: { id: "league-premier-league" },
    update: {},
    create: { id: "league-premier-league", name: "Premier League", countryCode: "ENG" },
  });

  const season = await db.season.upsert({
    where: { leagueId_label: { leagueId: league.id, label: "2026/27" } },
    update: {},
    create: {
      id: "season-premier-league-2026",
      leagueId: league.id,
      label: "2026/27",
      startsOn: new Date("2026-08-01"),
      endsOn: new Date("2027-05-31"),
    },
  });

  const teamsData = [
    { id: "team-arsenal", name: "Arsenal", normalizedName: "arsenal", countryCode: "ENG" },
    { id: "team-chelsea", name: "Chelsea", normalizedName: "chelsea", countryCode: "ENG" },
    { id: "team-liverpool", name: "Liverpool", normalizedName: "liverpool", countryCode: "ENG" },
    { id: "team-mancity", name: "Manchester City", normalizedName: "manchester city", countryCode: "ENG" },
    { id: "team-manunited", name: "Manchester United", normalizedName: "manchester united", countryCode: "ENG" },
    { id: "team-tottenham", name: "Tottenham Hotspur", normalizedName: "tottenham hotspur", countryCode: "ENG" },
    { id: "team-newcastle", name: "Newcastle United", normalizedName: "newcastle united", countryCode: "ENG" },
    { id: "team-astonvilla", name: "Aston Villa", normalizedName: "aston villa", countryCode: "ENG" },
  ];

  for (const t of teamsData) {
    await db.team.upsert({
      where: { id: t.id },
      update: {},
      create: t,
    });
  }

  const now = new Date();
  const schedule = [
    { id: "fix-001", homeId: "team-arsenal", awayId: "team-chelsea", hours: 2 },
    { id: "fix-002", homeId: "team-liverpool", awayId: "team-mancity", hours: 4.5 },
    { id: "fix-003", homeId: "team-manunited", awayId: "team-tottenham", hours: 24 },
    { id: "fix-004", homeId: "team-newcastle", awayId: "team-astonvilla", hours: 27 },
  ];

  for (const s of schedule) {
    const kickoffUtc = new Date(now.getTime() + s.hours * 3600000);
    const fix = await db.fixture.upsert({
      where: { id: s.id },
      update: { kickoffUtc, status: "SCHEDULED" },
      create: {
        id: s.id,
        leagueId: league.id,
        seasonId: season.id,
        homeTeamId: s.homeId,
        awayTeamId: s.awayId,
        kickoffUtc,
        status: "SCHEDULED",
      },
    });

    const prov = await db.fixtureProvenance.findFirst({ where: { fixtureId: fix.id } });
    if (!prov) {
      await db.fixtureProvenance.create({
        data: {
          fixtureId: fix.id,
          provider: "football-data.org",
          observedAt: now,
          sourceUpdatedAt: now,
          payloadHash: createHash("sha256").update(fix.id).digest("hex"),
          rawPayload: { fixtureId: fix.id, source: "seed" },
        },
      });
    }
  }

  console.log("Successfully seeded fixtures!");
}

main()
  .catch(console.error)
  .finally(() => db.$disconnect());