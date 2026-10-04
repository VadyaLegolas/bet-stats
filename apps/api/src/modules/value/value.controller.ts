import { Body, Controller, Get, Header, Param, Post, Res, UseGuards } from "@nestjs/common";

import { EligibilityGuard } from "../eligibility/eligibility.guard.js";
import { ValueService, type ValueReceiptDto } from "./value.service.js";

type HeaderResponse = { header(name: string, value: string): HeaderResponse; send(body: string): unknown };

@Controller("value-receipts")
@UseGuards(EligibilityGuard)
export class ValueController {
  constructor(private readonly value: ValueService) {}

  @Post()
  @Header("Cache-Control", "private, no-store, max-age=0")
  compare(@Body() body: unknown): Promise<ValueReceiptDto> { return this.value.compare(body); }

  @Get(":receiptId")
  @Header("Cache-Control", "private, no-store, max-age=0")
  get(@Param("receiptId") receiptId: string): Promise<ValueReceiptDto> { return this.value.get(receiptId); }

  @Get(":receiptId/download")
  @Header("Cache-Control", "private, no-store, max-age=0")
  async download(@Param("receiptId") receiptId: string, @Res() response: HeaderResponse): Promise<unknown> {
    const download = await this.value.download(receiptId);
    return response.header("Content-Type", download.contentType).header("Content-Disposition", `attachment; filename="${download.filename}"`).send(download.body);
  }
}
