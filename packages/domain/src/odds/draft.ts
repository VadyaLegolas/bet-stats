import { MARKET_SELECTIONS, type OddsMarket, type OddsSelection } from "./contract.js";

export interface OddsDraft {
  readonly schemaVersion: "manual-odds-draft-v1";
  readonly analyzable: false;
  readonly fixtureId: string;
  readonly market: OddsMarket;
  readonly sourceLabel: string;
  readonly fields: readonly Readonly<{ selection: OddsSelection; decimalOdds: string }>[];
}

function hasExactKeys(value: object, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return actual.length === sorted.length && actual.every((key, index) => key === sorted[index]);
}

export function parseOddsDraft(serialized: string): OddsDraft {
  let value: unknown;
  try { value = JSON.parse(serialized); } catch { throw new Error("INVALID_ODDS_DRAFT_JSON"); }
  if (!value || typeof value !== "object" || Array.isArray(value) || !hasExactKeys(value, ["schemaVersion", "analyzable", "fixtureId", "market", "sourceLabel", "fields"])) throw new Error("INVALID_ODDS_DRAFT_KEYS");
  const candidate = value as Record<string, unknown>;
  if (candidate.schemaVersion !== "manual-odds-draft-v1" || candidate.analyzable !== false) throw new Error("INVALID_ODDS_DRAFT_VERSION");
  if (typeof candidate.fixtureId !== "string" || !candidate.fixtureId || typeof candidate.sourceLabel !== "string") throw new Error("INVALID_ODDS_DRAFT_IDENTITY");
  if (typeof candidate.market !== "string" || !Object.hasOwn(MARKET_SELECTIONS, candidate.market)) throw new Error("UNSUPPORTED_ODDS_DRAFT_MARKET");
  if (!Array.isArray(candidate.fields)) throw new Error("INVALID_ODDS_DRAFT_FIELDS");
  const allowed = MARKET_SELECTIONS[candidate.market as OddsMarket];
  for (const field of candidate.fields) {
    if (!field || typeof field !== "object" || Array.isArray(field) || !hasExactKeys(field, ["selection", "decimalOdds"])) throw new Error("INVALID_ODDS_DRAFT_FIELD_KEYS");
    const entry = field as Record<string, unknown>;
    if (typeof entry.selection !== "string" || !allowed.includes(entry.selection as OddsSelection) || typeof entry.decimalOdds !== "string") throw new Error("INVALID_ODDS_DRAFT_FIELD");
  }
  return value as OddsDraft;
}

export function serializeOddsDraft(draft: OddsDraft): string {
  return JSON.stringify(parseOddsDraft(JSON.stringify(draft)));
}

export function clearOddsDraftAfterSubmission(
  storage: Pick<Storage, "removeItem">,
  key: string,
  result: Readonly<{ status: "FAILED" } | { status: "SUBMITTED"; oddsSnapshotId: string }>,
): boolean {
  if (result.status !== "SUBMITTED" || !result.oddsSnapshotId) return false;
  storage.removeItem(key);
  return true;
}
