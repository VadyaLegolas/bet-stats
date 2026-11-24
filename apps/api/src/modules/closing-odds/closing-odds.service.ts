import { BadRequestException, ConflictException, Injectable, Optional, ServiceUnavailableException, UnprocessableEntityException, type OnModuleDestroy } from "@nestjs/common";
import { createPrismaClient, createPrismaClosingOddsRepository, type ClosingOddsRepository, type PrismaClient, type RecordClosingOddsBookResult } from "@bet-stats/database";
import type { ClosingOddsBookInput } from "@bet-stats/domain";

const BODY_KEYS = new Set(["fixtureId", "market", "sourceConvention", "observedAt", "selections"]);
const SELECTION_KEYS = new Set(["selection", "decimalOdds"]);

/** Reason codes the repository may raise for a request the server refuses (HTTP 422). Anything else is a server fault. */
const REJECTION_CODES = new Set([
  "INCOMPLETE_MARKET_SET", "DUPLICATE_SELECTION", "UNSUPPORTED_MARKET", "INVALID_OBSERVED_AT", "OBSERVED_AT_NOT_PRE_KICKOFF", "OBSERVED_AT_IN_FUTURE",
  "RECORDED_AFTER_KICKOFF", "FIXTURE_ALREADY_SETTLED", "INVALID_ODDS", "INVALID_SOURCE_CONVENTION", "FIXTURE_NOT_FOUND", "UNKNOWN_SOURCE_CONVENTION",
]);

function malformed(code: string, field?: string): BadRequestException {
  return new BadRequestException({ code, ...(field ? { field } : {}) });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Structural parse only: the body must be an object with exactly the known keys. observationKind and oddsFormat are never
 * accepted from the client (always MARKET_CLOSE / DECIMAL on the server). Every semantic check belongs to the domain validator.
 */
export function parseClosingOddsBody(raw: unknown): ClosingOddsBookInput {
  if (!isPlainObject(raw)) throw malformed("INVALID_CLOSING_ODDS_BODY");
  if (Object.keys(raw).some((key) => !BODY_KEYS.has(key))) throw malformed("INVALID_CLOSING_ODDS_KEYS");
  const selections = raw.selections;
  if (Array.isArray(selections)) {
    for (const item of selections) {
      if (!isPlainObject(item) || Object.keys(item).some((key) => !SELECTION_KEYS.has(key))) throw malformed("INVALID_CLOSING_ODDS_SELECTIONS", "selections");
    }
  }
  return { fixtureId: raw.fixtureId, market: raw.market, sourceConvention: raw.sourceConvention, observedAt: raw.observedAt, selections } as unknown as ClosingOddsBookInput;
}

@Injectable()
export class ClosingOddsService implements OnModuleDestroy {
  private readonly client: PrismaClient | null;
  private readonly repository: ClosingOddsRepository | null;

  constructor(@Optional() repository?: ClosingOddsRepository) {
    this.client = repository ? null : process.env.DATABASE_URL ? createPrismaClient(process.env.DATABASE_URL) : null;
    this.repository = repository ?? (this.client ? createPrismaClosingOddsRepository({ database: this.client }) : null);
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.$disconnect();
  }

  async record(raw: unknown): Promise<RecordClosingOddsBookResult> {
    const input = parseClosingOddsBody(raw);
    if (!this.repository) throw new ServiceUnavailableException({ code: "CLOSING_ODDS_UNAVAILABLE" });
    try {
      return await this.repository.recordClosingOddsBook(input);
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      if (code === "CLOSING_OBSERVATION_CONFLICT") throw new ConflictException({ code });
      if (typeof code === "string" && REJECTION_CODES.has(code)) throw new UnprocessableEntityException({ code });
      throw error;
    }
  }
}
