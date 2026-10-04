import { createHash } from "node:crypto";
import { ConflictException, Injectable, NotFoundException, Optional, type OnModuleDestroy } from "@nestjs/common";
import { createPrismaClient, type PrismaClient } from "@bet-stats/database";
import { TheSportsDbSuggestionClient } from "@bet-stats/football-data";
import { ProviderLogoService } from "../media/provider-logo.service.js";

type DecisionKind = "approve" | "manual-link" | "reject-create" | "correction";
type Command = { caseId: string; expectedVersion: number; idempotencyKey: string; note: string; candidateId?: string; canonicalEntityId?: string; canonicalName?: string; countryCode?: string; supersedesDecisionId?: string };

function decisionId(command: Command, kind: DecisionKind): string {
  return `review_${createHash("sha256").update(`${command.caseId}\0${kind}\0${command.idempotencyKey}`).digest("hex").slice(0, 24)}`;
}
function projection(row: any): any {
  return { ...row, openedAt: row.openedAt.toISOString(), resolvedAt: row.resolvedAt?.toISOString() ?? null, candidates: row.candidates.map((candidate: any) => ({ ...candidate, confidence: Number(candidate.confidence), createdAt: candidate.createdAt.toISOString() })), decisions: row.decisions.map((decision: any) => ({ ...decision, confidence: Number(decision.confidence), decidedAt: decision.decidedAt.toISOString() })) };
}

@Injectable()
export class ReconciliationService implements OnModuleDestroy {
  private readonly ownsDatabase: boolean;
  private readonly database: PrismaClient | null;
  private readonly suggestions: TheSportsDbSuggestionClient;
  private readonly logos: ProviderLogoService;
  constructor(@Optional() database?: PrismaClient, @Optional() suggestions?: TheSportsDbSuggestionClient, @Optional() logos?: ProviderLogoService) {
    this.database = database ?? (process.env.DATABASE_URL ? createPrismaClient(process.env.DATABASE_URL) : null);
    this.ownsDatabase = database === undefined && this.database !== null;
    this.suggestions = suggestions ?? new TheSportsDbSuggestionClient();
    this.logos = logos ?? new ProviderLogoService();
  }
  async onModuleDestroy(): Promise<void> { if (this.ownsDatabase) await this.database?.$disconnect(); }

  private db(): PrismaClient { if (!this.database) throw new NotFoundException("Not found"); return this.database; }

  async listOpen(input: { cursor?: string; limit?: number }) {
    const limit = Math.min(Math.max(input.limit ?? 20, 1), 50);
    const rows = await this.db().reconciliationCase.findMany({ where: { status: "OPEN" }, orderBy: [{ openedAt: "asc" }, { id: "asc" }], take: limit, ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}), include: { candidates: { orderBy: [{ confidence: "desc" }, { id: "asc" }] }, decisions: { orderBy: [{ decidedAt: "asc" }, { id: "asc" }] } } });
    return { items: rows.map(projection), nextCursor: rows.length === limit ? rows.at(-1)?.id ?? null : null };
  }

  async get(caseId: string) {
    const row = await this.db().reconciliationCase.findUnique({ where: { id: caseId }, include: { candidates: { orderBy: [{ confidence: "desc" }, { id: "asc" }] }, decisions: { orderBy: [{ decidedAt: "asc" }, { id: "asc" }] } } });
    if (!row) throw new NotFoundException("Not found");
    return projection(row);
  }

  async getSuggestions(caseId: string) {
    const reviewCase = await this.get(caseId);
    if (reviewCase.entityType !== "TEAM") return { items: [] };
    const incoming = reviewCase.incomingSnapshot as Record<string, unknown> | null;
    const query = incoming && typeof incoming.name === "string" ? incoming.name : reviewCase.externalId;
    return { items: (await this.suggestions.searchTeams(query)).map(({ logoCandidate, ...item }) => ({ ...item, logoRef: logoCandidate ? this.logos.issueReference(logoCandidate) : null })) };
  }

  async decide(kind: DecisionKind, command: Command, actor: string) {
    if (!command.note || command.note.trim().length < 10 || !command.idempotencyKey || command.idempotencyKey.length > 100) throw new NotFoundException("Invalid review command");
    const id = decisionId(command, kind);
    const database = this.db(); const prior = await database.reconciliationDecision.findUnique({ where: { id } });
    if (prior) return { decision: projectionDecision(prior), version: command.expectedVersion + 1 };
    return database.$transaction(async (tx) => {
      const current = await tx.reconciliationCase.findUnique({ where: { id: command.caseId }, include: { candidates: true, decisions: true } });
      if (!current) throw new NotFoundException("Not found");
      if (current.version !== command.expectedVersion) throw new ConflictException("Review case changed");
      let canonicalEntityId = command.canonicalEntityId;
      if (kind === "approve") canonicalEntityId = current.candidates.find((candidate) => candidate.id === command.candidateId)?.canonicalEntityId;
      if (kind === "reject-create") {
        if (current.entityType !== "TEAM" || !command.canonicalName?.trim() || !command.countryCode?.match(/^[A-Z]{2}$/)) throw new NotFoundException("Invalid review command");
        canonicalEntityId = (await tx.team.create({ data: { name: command.canonicalName.trim(), normalizedName: command.canonicalName.trim().toLocaleLowerCase("en"), countryCode: command.countryCode } })).id;
      }
      if (!canonicalEntityId) throw new NotFoundException("Invalid review command");
      if (kind === "correction" && (!command.supersedesDecisionId || !current.decisions.some((decision) => decision.id === command.supersedesDecisionId))) throw new NotFoundException("Invalid review command");
      const updated = await tx.reconciliationCase.updateMany({ where: { id: command.caseId, version: command.expectedVersion }, data: { version: { increment: 1 }, status: "RESOLVED", resolvedAt: new Date() } });
      if (updated.count !== 1) throw new ConflictException("Review case changed");
      const decision = await tx.reconciliationDecision.create({ data: { id, caseId: command.caseId, action: kind === "reject-create" ? "CREATE" : "LINK", method: "OPERATOR_CONFIRMED", canonicalEntityId, evidence: { note: command.note.trim(), kind, target: canonicalEntityId }, confidence: 1, actor, ...(command.supersedesDecisionId ? { supersedesDecisionId: command.supersedesDecisionId } : {}) } });
      return { decision: projectionDecision(decision), version: command.expectedVersion + 1 };
    });
  }
}
function projectionDecision(decision: any) { return { ...decision, confidence: Number(decision.confidence), decidedAt: decision.decidedAt.toISOString() }; }
