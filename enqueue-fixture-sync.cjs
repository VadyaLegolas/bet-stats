const { PrismaClient } = require('@bet-stats/database');
const { Queue } = require('bullmq');
const { redisConnection } = require('./src/queues/index');
const { FootballDataOrgClient } = require('@bet-stats/football-data');

async function main() {
  const prisma = new PrismaClient();
  const redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
  const providerFactory = () => new FootballDataOrgClient({
    apiToken: process.env.FOOTBALL_DATA_API_TOKEN ?? '',
  });

  // We are going to enqueue a replay job for FIXTURES.
  // We need to generate a replay plan ID. Let's use a fixed one that we hope exists.
  // We can look at the default replay policies, but for now let's try to use a simple one.
  // We'll create a replay plan ID: 'replay-v1' (just a guess).
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

  // Determine the queue name for standard sync queue (replay jobs)
  const queueName = 'bet-stats-sync-standard'; // from standardQueue() default prefix

  const queue = new Queue(queueName, {
    connection: redisConnection(redisUrl),
  });

  // The job name is the endpointFamily in lowercase
  await queue.add('fixtures', jobData, {
    // We can use the default job options from createSyncJobOptions for "results" but we don't have that function.
    // Let's use reasonable defaults.
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 1000,
      jitter: 0.25,
    },
    removeOnComplete: { age: 86_400, count: 1_000 }, // 1 day
    removeOnFail: { age: 604_800, count: 5_000 },   // 7 days
  });

  console.log('Enqueued replay job for fixture sync.');

  await queue.close();
  await prisma.$disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
