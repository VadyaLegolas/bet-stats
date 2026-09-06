import { createHash } from "node:crypto";
import { BadRequestException, ConflictException, Injectable, NotFoundException, type OnModuleDestroy } from "@nestjs/common";
import { createPrismaClient, type PrismaClient } from "@bet-stats/database";
import { normalizeOddsBook, type NormalizedOddsBook, type OddsBookInput } from "@bet-stats/domain";

export interface ManualOddsSubmission extends OddsBookInput {
  readonly replacementOfOddsSnapshotId?: string;
}

export interface ManualOddsSnapshotDto extends NormalizedOddsBook {
  readonly replacementOfOddsSnapshotId: string | null;
  readonly submittedAt: string;
}

export interface ManualOddsRepository {
  find?(id: string): Promise<{ fixtureId: string; market: string } | null>;
  append(book: ManualOddsSnapshotDto & { inputHash: string }): Promise<ManualOddsSnapshotDto>;
}

function failure(code: string, field?: string): Error & { code: string } {
  const exception = code === "ODDS_REPLACEMENT_MISMATCH"
    ? new ConflictException({ code, ...(field ? { field } : {}) })
    : new BadRequestException({ code, ...(field ? { field } : {}) });
  return Object.assign(exception, { code });
}

function splitSubmission(raw: unknown): { book: OddsBookInput; replacementOfOddsSnapshotId: string | null } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw failure("INVALID_ODDS_BOOK_KEYS");
  const candidate = raw as Record<string, unknown>;
  const allowed = new Set(["fixtureId", "oddsSnapshotId", "market", "sourceLabel", "capturedAt", "selections", "replacementOfOddsSnapshotId"]);
  if (Object.keys(candidate).some((key) => !allowed.has(key))) throw failure("INVALID_ODDS_BOOK_KEYS");
  const replacement = candidate.replacementOfOddsSnapshotId;
  if (replacement !== undefined && (typeof replacement !== "string" || replacement.trim() === "")) throw failure("INVALID_ODDS_REPLACEMENT_ID", "replacementOfOddsSnapshotId");
  const { replacementOfOddsSnapshotId: _replacement, ...book } = candidate;
  return { book: book as unknown as OddsBookInput, replacementOfOddsSnapshotId: replacement as string | undefined ?? null };
}

export async function submitManualOdds(raw: unknown, repository: ManualOddsRepository): Promise<ManualOddsSnapshotDto> {
  let normalized: NormalizedOddsBook;
  let replacementOfOddsSnapshotId: string | null;
  try {
    const parsed = splitSubmission(raw);
    replacementOfOddsSnapshotId = parsed.replacementOfOddsSnapshotId;
    normalized = normalizeOddsBook(parsed.book);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) throw error;
    const code = error instanceof Error ? error.message : "INVALID_ODDS_BOOK";
    throw failure(code, code === "INVALID_DECIMAL_ODDS" ? "selections.decimalOdds" : code.includes("SELECTION") || code === "INCOMPLETE_ODDS_BOOK" ? "selections" : undefined);
  }
  if (replacementOfOddsSnapshotId) {
    const prior = await repository.find?.(replacementOfOddsSnapshotId) ?? null;
    if (!prior || prior.fixtureId !== normalized.fixtureId || prior.market !== normalized.market) throw failure("ODDS_REPLACEMENT_MISMATCH", "replacementOfOddsSnapshotId");
  }
  const submittedAt = new Date().toISOString();
  const snapshot: ManualOddsSnapshotDto = { ...normalized, replacementOfOddsSnapshotId, submittedAt };
  const inputHash = createHash("sha256").update(JSON.stringify({ fixtureId: normalized.fixtureId, market: normalized.market, capturedAt: normalized.capturedAt, selections: normalized.selections.map(({ selection, decimalOdds }) => ({ selection, decimalOdds })) })).digest("hex");
  return repository.append({ ...snapshot, inputHash });
}

function toDto(row: { id: string; fixtureId: string; market: string; source: string; replacesOddsId: string | null; receipt: unknown; submittedAt: Date }): ManualOddsSnapshotDto {
  const receipt = row.receipt as NormalizedOddsBook;
  return { ...receipt, oddsSnapshotId: row.id, fixtureId: row.fixtureId, market: row.market as NormalizedOddsBook["market"], sourceLabel: row.source, replacementOfOddsSnapshotId: row.replacesOddsId, submittedAt: row.submittedAt.toISOString() };
}

export function createPrismaManualOddsRepository(client: PrismaClient): ManualOddsRepository & { get(id: string): Promise<ManualOddsSnapshotDto | null> } {
  return {
    find: (id) => client.manualOddsSnapshot.findUnique({ where: { id }, select: { fixtureId: true, market: true } }),
    get: async (id) => {
      const row = await client.manualOddsSnapshot.findUnique({ where: { id } });
      return row ? toDto(row) : null;
    },
    append: async (book) => client.$transaction(async (tx) => {
      const existing = await tx.manualOddsSnapshot.findUnique({ where: { id: book.oddsSnapshotId } });
      if (existing) {
        if (existing.inputHash !== book.inputHash) throw failure("ODDS_SNAPSHOT_ID_CONFLICT");
        return toDto(existing);
      }
      const row = await tx.manualOddsSnapshot.create({ data: {
        id: book.oddsSnapshotId, fixtureId: book.fixtureId, market: book.market, inputHash: book.inputHash, source: book.sourceLabel,
        replacesOddsId: book.replacementOfOddsSnapshotId, receipt: book as never, submittedAt: new Date(book.submittedAt),
        selections: { create: book.selections.map(({ selection, decimalOdds }) => ({ selection, decimalOdds })) },
      } });
      return toDto(row);
    }).catch(async (error) => {
      const collision = await client.manualOddsSnapshot.findUnique({ where: { id: book.oddsSnapshotId } });
      if (collision?.inputHash === book.inputHash) return toDto(collision);
      throw error;
    }),
  };
}

@Injectable()
export class OddsService implements OnModuleDestroy {
  private readonly client = createPrismaClient();
  private readonly repository = createPrismaManualOddsRepository(this.client);
  submit(input: unknown): Promise<ManualOddsSnapshotDto> { return submitManualOdds(input, this.repository); }
  async get(id: string): Promise<ManualOddsSnapshotDto> { const value = await this.repository.get(id); if (!value) throw new NotFoundException({ code: "ODDS_SNAPSHOT_NOT_FOUND" }); return value; }
  async onModuleDestroy(): Promise<void> { await this.client.$disconnect(); }
}
