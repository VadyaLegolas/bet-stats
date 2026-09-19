import { Module } from "../../apps/api/node_modules/@nestjs/common/index.js";
import { NestFactory } from "../../apps/api/node_modules/@nestjs/core/index.js";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { AppModule } from "../../apps/api/src/app.module.js";
import { MediaModule } from "../../apps/api/src/modules/media/media.module.js";
import { ProviderLogoController } from "../../apps/api/src/modules/media/provider-logo.controller.js";
import { ProviderLogoService } from "../../apps/api/src/modules/media/provider-logo.service.js";
import { OperatorGuard } from "../../apps/api/src/modules/reconciliation/operator.guard.js";

const png = Uint8Array.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);
let app: any; let origin = ""; let ref = ""; let service: ProviderLogoService;
class TestMediaApp {}
Module({ controllers: [ProviderLogoController], providers: [{ provide: ProviderLogoService, useFactory: () => service }, { provide: "OPERATOR_CREDENTIAL", useValue: "logo-secret" }, OperatorGuard] })(TestMediaApp);

describe("provider logo HTTP boundary", () => {
  beforeAll(async () => {
    service = new ProviderLogoService({ resolve: async () => ["104.21.1.10"], fetcher: async () => new Response(png, { headers: { "content-type": "image/png", "content-length": "8" } }) });
    ref = service.issueReference("https://r2.thesportsdb.com/logo.png");
    app = await NestFactory.create(TestMediaApp, { logger: false }); await app.listen(0, "127.0.0.1"); origin = `http://127.0.0.1:${app.getHttpServer().address().port}`;
  });
  afterAll(async () => app?.close());

  it("is registered from the production AppModule", () => {
    expect(Reflect.getMetadata("imports", AppModule)).toContain(MediaModule);
  });
  it("rejects unauthenticated access and serves one bounded validated image", async () => {
    expect((await fetch(`${origin}/internal/media/provider-logo/${encodeURIComponent(ref)}`)).status).toBe(404);
    const response = await fetch(`${origin}/internal/media/provider-logo/${encodeURIComponent(ref)}`, { headers: { "x-operator-credential": "logo-secret" } });
    expect(response.status).toBe(200); expect(response.headers.get("content-type")).toBe("image/png"); expect(response.headers.get("content-length")).toBe("8");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff"); expect(response.headers.get("referrer-policy")).toBe("no-referrer"); expect(response.headers.get("cache-control")).toBe("private, max-age=300");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(png);
  });
  it("rejects a forged opaque reference without exposing fetch details", async () => {
    const response = await fetch(`${origin}/internal/media/provider-logo/forged.reference`, { headers: { "x-operator-credential": "logo-secret" } });
    expect(response.status).toBe(404); expect(await response.json()).toEqual({ message: "Not found", error: "Not Found", statusCode: 404 });
  });

  it("pins the validated address and aborts chunked bodies above the byte limit", async () => {
    let pinned = "";
    const oversized = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(750_000)); controller.enqueue(new Uint8Array(750_000)); controller.close(); },
    });
    const bounded = new ProviderLogoService({
      resolve: async () => ["104.21.1.10"],
      fetcher: async (_url, init) => { pinned = init.pinnedAddress; return new Response(oversized, { headers: { "content-type": "image/png" } }); },
    });
    const result = await bounded.fetchReference(bounded.issueReference("https://r2.thesportsdb.com/large.png"));
    expect(pinned).toBe("104.21.1.10");
    expect(result).toBeNull();
  });
});
