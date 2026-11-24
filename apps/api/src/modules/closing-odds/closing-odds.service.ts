import { Injectable, Optional } from "@nestjs/common";
import type { ClosingOddsRepository, RecordClosingOddsBookResult } from "@bet-stats/database";

@Injectable()
export class ClosingOddsService {
  constructor(@Optional() repository?: ClosingOddsRepository) {
    void repository;
  }

  async record(raw: unknown): Promise<RecordClosingOddsBookResult> {
    void raw;
    return { created: false, observations: [] };
  }
}
