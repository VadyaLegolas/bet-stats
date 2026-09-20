import { Controller, Get, Header, Post, Req } from "@nestjs/common";

import { PrivacyService } from "./privacy.service.js";

@Controller("privacy")
export class PrivacyController {
  constructor(private readonly privacy: PrivacyService) {}

  @Get("status")
  @Header("Cache-Control", "private, no-store")
  status(@Req() request: unknown) { return this.privacy.status(request); }

  @Post("consent")
  @Header("Cache-Control", "private, no-store")
  consent(@Req() request: unknown) { return this.privacy.consent(request); }

  @Post("withdrawal")
  @Header("Cache-Control", "private, no-store")
  withdrawal(@Req() request: unknown) { return this.privacy.withdraw(request); }
}
