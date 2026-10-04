import { Controller, Get, Header, Query, UseGuards } from "@nestjs/common";

import { OperatorGuard } from "../reconciliation/operator.guard.js";
import { OperationsService, type OperationsQuery } from "./operations.service.js";

function optionalInteger(value: string | undefined): number | undefined { return value === undefined ? undefined : Number(value); }

@Controller("internal/operations")
@UseGuards(OperatorGuard)
export class OperationsController {
  constructor(private readonly operations: OperationsService) {}

  @Get("overview")
  @Header("Cache-Control", "private, no-store, max-age=0")
  overview(@Query() query: Record<string, string | undefined>) {
    return this.operations.overview({
      ...Object.fromEntries(Object.keys(query).map((key) => [key, query[key]])),
      page: optionalInteger(query.page), pageSize: optionalInteger(query.pageSize), windowHours: optionalInteger(query.windowHours),
    } as OperationsQuery);
  }
}
