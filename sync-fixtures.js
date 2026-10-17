"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const database_1 = require("@bet-stats/database");
const index_1 = require("@bet-stats/data-sync/src/queues/index");
const bullmq_1 = require("bullmq");
const fixtures_1 = require("@bet-stats/data-sync/src/jobs/fixtures");
const football_data_1 = require("@bet-stats/football-data");
async function main() {
    const prisma = new database_1.PrismaClient();
    const redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
    const providerFactory = () => new football_data_1.FootballDataOrgClient({
        apiToken: process.env.FOOTBALL_DATA_API_TOKEN ?? '',
    });
    // Example: Premier League (football-data.org IDs)
    // You can adjust these IDs if needed; they correspond to external refs in the DB.
    const leagueId = '4328'; // Premier League
    const seasonId = '220'; // 2025/26 season
    const route = (0, fixtures_1.createFixtureJobRoute)({ competition: 'PL', season: '2025/26' });
    const jobData = {
        database: prisma,
        leagueId,
        seasonId,
        jobKey: `manual-${Date.now()}`,
        allowance: 1000,
        providerFactory,
    };
    const syncCriticalQueue = new bullmq_1.Queue('bet-stats-sync-critical', {
        connection: (0, index_1.redisConnection)(redisUrl),
    });
    await syncCriticalQueue.add('fixtures', jobData, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000, jitter: 0.25 },
        removeOnComplete: { age: 86400, count: 1000 },
        removeOnFail: { age: 604800, count: 5000 },
    });
    console.log('Fixture sync job enqueued. Waiting for worker to process...');
    await syncCriticalQueue.close();
    await prisma.$disconnect();
}
main().catch(err => {
    console.error(err);
    process.exit(1);
});
