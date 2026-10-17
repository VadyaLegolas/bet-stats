// sync-fixture.js
// Script to enqueue a fixture sync job in the BullMQ queue.
// Run with: node sync-fixture.js
// Make sure to have the following installed in your project:
//   - dotenv (to load environment variables)
//   - @bet-stats/database
//   - @bet-stats/data-sync
//   - @bet-stats/football-data
//   - bullmq
// You can install them with:
//   pnpm add -D dotenv
//   (the other packages are already workspace dependencies)

require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const { createPrismaClient } = require('@bet-stats/database');
const { Queue } = require('bullmq');
const { redisConnection } = require('@bet-stats/data-sync/dist/queues/index');
const { FootballDataOrgClient } = require('@bet-stats/football-data');

async function main() {
  const prisma = createPrismaClient();
  const redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
  const providerFactory = () => new FootballDataOrgClient({
    apiToken: process.env.FOOTBALL_DATA_API_TOKEN ?? '',
  });

  // Use a default replay plan ID; you may need to adjust this.
  const replayPlanId = 'replay-v1';
  const syncRunId = `sync-${Date.now()}`;
  const logicalId = `logic-${Date.now()}`;
  const revision = 1;

  const jobData = {
    syncRunId,
    replayPlanId,
    logicalId,
    revision: revision,
    input: {
      provider: 'football-data.org',
      competitionId: 'PL', // Premier League
      seasonId: '2025/26',
      endpointFamily: 'FIXTURES',
      from: '2026-10-09',
      to: '2026-10-11',
    },
    unit: {
      logicalId: logicalId,
      from: '2026-10-09',
      to: '2026-10-11',
    },
  };

  const queueName = 'bet-stats-sync-standard';
  const queue = new Queue(queueName, {
    connection: redisConnection(redisUrl),
  });

  await queue.add('fixtures', jobData, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000, jitter: 0.25 },
    removeOnComplete: { age: 86_400, count: 1_000 },
    removeOnFail: { age: 604_800, count: 5_000 },
  });

  console.log('Enqueued replay job for fixture sync.');

  await queue.close();
  await prisma.$disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
