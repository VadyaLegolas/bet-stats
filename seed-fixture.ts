import { PrismaClient } from '@bet-stats/database';

async function main() {
  const prisma = new PrismaClient();

  try {
    // Create League
    const league = await prisma.league.create({
      data: {
        name: 'Premier League',
        countryCode: 'ENG',
      },
    });
    console.log(`Created league: ${league.id}`);

    // Create Season
    const season = await prisma.season.create({
      data: {
        label: '2025/26',
        startsOn: new Date('2025-08-01'),
        endsOn: new Date('2026-05-31'),
        leagueId: league.id,
      },
    });
    console.log(`Created season: ${season.id}`);

    // Create two teams
    const homeTeam = await prisma.team.create({
      data: {
        name: 'Team Home',
        normalizedName: 'team home',
        countryCode: 'ENG',
      },
    });
    const awayTeam = await prisma.team.create({
      data: {
        name: 'Team Away',
        normalizedName: 'team away',
        countryCode: 'ENG',
      },
    });
    console.log(`Created teams: ${homeTeam.id}, ${awayTeam.id}`);

    // Create Fixture
    const kickoff = new Date();
    kickoff.setHours(kickoff.getHours() + 2); // 2 hours from now
    const fixture = await prisma.fixture.create({
      data: {
        leagueId: league.id,
        seasonId: season.id,
        homeTeamId: homeTeam.id,
        awayTeamId: awayTeam.id,
        kickoffUtc: kickoff,
        status: 'SCHEDULED',
      },
    });
    console.log(`Created fixture: ${fixture.id}`);

    console.log('Seeding completed successfully.');
  } catch (error) {
    console.error('Error seeding:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
