import { BadRequestException, Controller, Get, Header, Query, UseGuards } from "@nestjs/common";
import type { ScannerResponse } from "@bet-stats/domain";

import { EligibilityGuard } from "../eligibility/eligibility.guard.js";
import { ScannerService } from "./scanner.service.js";

/** The window, the cap and the order are server constants: the endpoint accepts no parameters at all. */
@Controller("value")
@UseGuards(EligibilityGuard)
export class ScannerController {
  constructor(private readonly scanner: ScannerService) {}

  @Get("scanner")
  @Header("Cache-Control", "private, no-store, max-age=0")
  get(@Query() query: Record<string, unknown>): Promise<ScannerResponse> {
    if (Object.keys(query).length > 0) throw new BadRequestException({ code: "INVALID_SCANNER_QUERY" });
    return this.scanner.get();
  }
}
