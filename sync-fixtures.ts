import { PrismaClient } from '@bet-stats/database';
import { redisConnection } from '@bet-stats/data-sync/src/queues/index';
import { Queue } from 'bullmq';
import { createFixtureJobRoute, FixtureSyncJobInput } from '@bet-stats/data-sync/src/jobs/fixtures';
import { FootballDataOrgClient } from '@bet-stats/football-data';

async function main() {
  const prisma = new PrismaClient();
  const redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
  const providerFactory = () => new FootballDataOrgClient({
    apiToken: process.env.FOOTBALL_DATA_API_TOKEN ?? '',
  });

  // Example: Premier League (football-data.org IDs)
  // You can adjust these IDs if needed; they correspond to external refs in the DB.
  const leagueId = '4328'; // Premier League
  const seasonId = '220'; // 2025/26 season

  const route = createFixtureJobRoute({ competition: 'PL', season: '2025/26' });

  const jobData: FixtureSyncJobInput = {
    database: prisma,
    leagueId,
    seasonId,
    jobKey: `manual-${Date.now()}`,
    allowance: 1000,
    providerFactory,
  };

  const syncCriticalQueue = new Queue('bet-stats-sync-critical', {
    connection: redisConnection(redisUrl),
  });

  await syncCriticalQueue.add('fixtures', jobData, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000, jitter: 0.25 },
    removeOnComplete: { age: 86_400, count: 1_000 },
    removeOnFail: { age: 604_800, count: 5_000 },
  });

  console.log('Fixture sync job enqueued. Waiting for worker to process...');

  await syncCriticalQueue.close();
  await prisma.$disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
