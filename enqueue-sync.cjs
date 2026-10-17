const { createPrismaClient } = require('@bet-stats/database');
const { Queue } = require('bullmq');
const { redisConnection } = require('@bet-stats/data-sync/dist/queues/index');
const { createFixtureJobRoute } = require('@bet-stats/data-sync/dist/jobs/fixtures');
const { FootballDataOrgClient } = require('@bet-stats/football-data');
const { readFileSync } = require('fs');
const path = require('path');

// Load environment variables from .env file
function loadEnv() {
  const envPath = path.resolve(__dirname, '.env');
  try {
    const data = readFileSync(envPath, 'utf8');
    const lines = data.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === '' || trimmed.startsWith('#')) continue;
      const [key, value] = trimmed.split('=');
      if (key !== undefined && value !== undefined) {
        process.env[key.trim()] = value.trim();
      }
    }
  } catch (err) {
    console.warn('Could not load .env file:', err);
  }
}
loadEnv();

async function main() {
  const prisma = createPrismaClient();
  const redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
  const providerFactory = () => new FootballDataOrgClient({
    apiToken: process.env.FOOTBALL_DATA_API_TOKEN ?? '',
  });

  // We are going to enqueue a replay job for FIXTURES.
  // We need a replay plan ID. Let's try to use one of the default policies.
  // We can look at the DEFAULT_REPLAY_PROVIDER_POLICIES, but we don't have easy access.
  // Let's try to use a replay plan ID of 'replay-v1' (common default).
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
