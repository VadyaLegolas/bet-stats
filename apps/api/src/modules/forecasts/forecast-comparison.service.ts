import { BadRequestException, Injectable, Optional, type OnModuleDestroy } from "@nestjs/common";
import { createPrismaClient, createPrismaForecastRepository, type PrismaClient } from "@bet-stats/database";
import { FORECAST_KINDS, compareForecastPair, parseForecastAvailability, parseForecastComparisonRequest, projectForecastAvailability, type ForecastAbsenceReason, type ForecastKind, type ForecastResponseDto } from "@bet-stats/domain";

export interface ForecastComparisonRepository {
  findExact(id: string): Promise<(ForecastResponseDto & { state?: string }) | null>;
  listIssued(fixtureId: string): Promise<readonly ForecastResponseDto[]>;
  absenceReason(fixtureId: string, kind: ForecastKind): Promise<ForecastAbsenceReason>;
}

@Injectable()
export class ForecastComparisonService implements OnModuleDestroy {
  private readonly client: PrismaClient | null;
  private readonly repository: ForecastComparisonRepository;

  constructor(@Optional() repository?: ForecastComparisonRepository) {
    this.client = repository || !process.env.DATABASE_URL ? null : createPrismaClient(process.env.DATABASE_URL);
    this.repository = repository ?? createProductionRepository(this.client!);
  }

  async compare(fixtureId: string, raw: unknown) {
    const request = parseForecastComparisonRequest(raw);
    const [left, right] = await Promise.all([this.repository.findExact(request.leftId), this.repository.findExact(request.rightId)]);
    validateExact(left, "LEFT", fixtureId);
    validateExact(right, "RIGHT", fixtureId);
    const { state: _leftState, ...leftForecast } = left;
    const { state: _rightState, ...rightForecast } = right;
    return compareForecastPair(leftForecast, rightForecast);
  }

  async availability(fixtureId: string) {
    if (!fixtureId) throw safe("INVALID_FIXTURE_ID");
    const snapshots = await this.repository.listIssued(fixtureId);
    const absence = Object.fromEntries(await Promise.all(FORECAST_KINDS.map(async (kind) => [kind, await this.repository.absenceReason(fixtureId, kind)]))) as Record<ForecastKind, ForecastAbsenceReason>;
    return parseForecastAvailability(projectForecastAvailability(snapshots, absence));
  }

  async onModuleDestroy(): Promise<void> { await this.client?.$disconnect(); }
}

export function createProductionRepository(client: PrismaClient): ForecastComparisonRepository {
  const forecasts = createPrismaForecastRepository(client);
  return {
    findExact: async (id) => {
      const row = await client.forecastSnapshot.findUnique({ where: { id }, select: { state: true, receipt: true } });
      return row ? { ...(row.receipt as unknown as ForecastResponseDto), state: row.state } : null;
    },
    listIssued: async (fixtureId) => forecasts.listIssued?.(fixtureId) ?? [],
    absenceReason: async (fixtureId, kind) => {
      if (kind !== "LINEUP_CONFIRMED") return "INSUFFICIENT_EVIDENCE";
      const lineup = await client.lineupObservation.findFirst({
        where: { fixtureId, status: "OFFICIAL_CONFIRMED" },
        select: {
          id: true,
          observation: { select: { provider: true, observedAt: true } },
          fixture: { select: { leagueId: true, seasonId: true, kickoffUtc: true } },
        },
      });
      if (lineup) return "INSUFFICIENT_EVIDENCE";
      const fixture = await client.fixture.findUnique({ where: { id: fixtureId }, select: { kickoffUtc: true } });
      if (!fixture) return "INSUFFICIENT_EVIDENCE";
      const decision = await client.enrichmentDecisionReceipt.findFirst({
        where: {
          fixtureId,
          provider: "api-football",
          endpoint: "LINEUPS",
          cutoff: { lte: fixture.kickoffUtc },
        },
        orderBy: { cutoff: "desc" },
      });
      const reason = decision?.reason;
      if (reason?.includes("CAPABILITY")) return "CAPABILITY_DENIED";
      if (reason === "CRITICAL_HEADROOM" || reason === "ALLOWANCE_EXHAUSTED") return "BUDGET_PROTECTED";
      if (reason === "CIRCUIT_OPEN" || reason === "PROVIDER_UNAVAILABLE") return "PROVIDER_UNAVAILABLE";
      return decision?.outcome === "ADMITTED" ? "NO_CONFIRMED_LINEUP" : "INSUFFICIENT_EVIDENCE";
    },
  };
}

function validateExact(value: (ForecastResponseDto & { state?: string }) | null, side: "LEFT" | "RIGHT", fixtureId: string): asserts value is ForecastResponseDto {
  if (!value) throw safe(`FORECAST_${side}_NOT_FOUND`);
  if (value.fixtureId !== fixtureId) throw safe("FORECAST_FIXTURE_MISMATCH");
  if (value.state && value.state !== "ISSUED") throw safe(`FORECAST_${side}_NOT_ISSUED`);
}
function safe(code: string) { return new BadRequestException({ code }); }
