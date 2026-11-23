// Операторская точка входа: сравнение poisson-ensemble-v1 и dixon-coles-ensemble-v1 на rolling-origin бэктестах.
// Подаёт пару планов на одних окнах, ждёт воркер data-sync и печатает квитанцию model-comparison-v2.
// Требуется собранный проект (pnpm build), запущенный воркер, DATABASE_URL и REDIS_URL.
//
// Usage: node scripts/model-comparison.mjs run --from 2026-08-01T00:00:00Z --to 2026-11-01T00:00:00Z
import { createPrismaBacktestReceiptRepository, createPrismaClient, createSettlementPipelineService } from "../packages/database/dist/index.js";
import { runModelComparisonCommand } from "../workers/data-sync/dist/jobs/model-comparison-cli.js";
import { createBacktestQueue } from "../workers/data-sync/dist/queues/index.js";

const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;
if (!databaseUrl || !redisUrl) {
  console.error("Нужны переменные окружения DATABASE_URL и REDIS_URL.");
  process.exit(1);
}
const prefix = process.env.QUEUE_PREFIX?.trim();
const database = createPrismaClient(databaseUrl);
const queue = createBacktestQueue({ redisUrl, ...(prefix ? { prefix } : {}) });
const receipts = createPrismaBacktestReceiptRepository({ database, settlementService: createSettlementPipelineService({ database }) });
let code = 1;
try {
  code = await runModelComparisonCommand(process.argv.slice(2), { database, receipts, queue, out: (line) => process.stdout.write(`${line}\n`) });
} catch (error) {
  console.error(`Ошибка: ${error?.code ?? error?.message ?? error}`);
} finally {
  await queue.close();
  await database.$disconnect();
}
process.exit(code);
