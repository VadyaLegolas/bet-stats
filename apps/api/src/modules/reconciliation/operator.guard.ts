import { createHash, timingSafeEqual } from "node:crypto";
import { CanActivate, ExecutionContext, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

@Injectable()
export class OperatorGuard implements CanActivate {
  private readonly credential: string | undefined;
  constructor(@Optional() @Inject("OPERATOR_CREDENTIAL") credential?: string) { this.credential = credential ?? process.env.OPERATOR_CREDENTIAL; }

  authorize(presented: string | undefined): { actor: "operator" } {
    if (!this.credential || !presented || !timingSafeEqual(digest(this.credential), digest(presented))) {
      throw new NotFoundException("Not found");
    }
    return { actor: "operator" };
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ headers: Record<string, string | string[] | undefined>; path?: string; originalUrl?: string; url?: string; operator?: { actor: string } }>();
    const raw = request.headers["x-operator-credential"];
    this.authorize(typeof raw === "string" ? raw : undefined);
    const routePath = (request.originalUrl ?? request.path ?? request.url ?? "").split("?", 1)[0] ?? "";
    const rawActor = request.headers["x-operator-actor"];
    const actor = typeof rawActor === "string" && /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/.test(rawActor) ? rawActor : null;
    if (routePath.startsWith("/internal/pipeline/replay/") && !actor) throw new NotFoundException("Not found");
    request.operator = { actor: actor ?? "operator" };
    return true;
  }
}
