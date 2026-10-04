import { Controller, Get, NotFoundException, Param, Res, UseGuards } from "@nestjs/common";
import { OperatorGuard } from "../reconciliation/operator.guard.js";
import { ProviderLogoService } from "./provider-logo.service.js";

@Controller("internal/media/provider-logo")
@UseGuards(OperatorGuard)
export class ProviderLogoController {
  constructor(private readonly logos: ProviderLogoService) {}
  @Get(":reference")
  async get(@Param("reference") reference: string, @Res() response: any) {
    const image = await this.logos.fetchReference(reference); if (!image) throw new NotFoundException("Not found");
    response.setHeader("Content-Type", image.mime); response.setHeader("Content-Length", String(image.bytes.length));
    response.setHeader("X-Content-Type-Options", "nosniff"); response.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
    response.setHeader("Referrer-Policy", "no-referrer"); response.setHeader("Cache-Control", "private, max-age=300"); response.send(Buffer.from(image.bytes));
  }
}
