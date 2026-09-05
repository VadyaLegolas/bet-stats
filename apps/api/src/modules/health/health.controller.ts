import { Controller, Get, Headers } from "@nestjs/common";

import { dependencyReadiness } from "@bet-stats/config";

type DependencyState = { postgres: boolean; redis: boolean };

export function projectHealth(state: DependencyState, correlationId: string, _diagnostic?: unknown) {
  const readiness = dependencyReadiness(state);
  return {
    status: readiness.ready ? "ready" as const : "not-ready" as const,
    correlationId,
    dependencies: readiness.dependencies,
  };
}

@Controller("health")
export class HealthController {
  @Get("live")
  liveness() {
    return { status: "alive" as const };
  }

  @Get("ready")
  readiness(@Headers("x-correlation-id") correlationId = "not-provided") {
    return projectHealth({
      postgres: process.env.POSTGRES_READY === "true",
      redis: process.env.REDIS_READY === "true",
    }, correlationId);
  }
}
