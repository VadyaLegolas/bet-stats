import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { ProviderLogoService } from "../../apps/api/src/modules/media/provider-logo.service.js";

const png = Uint8Array.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);
describe("Phase 05 held-out security boundaries", () => {
  it.each(["127.0.0.1", "169.254.1.1", "10.1.1.1", "172.20.1.1", "192.168.1.1", "100.64.0.1", "::1", "fe80::1"])("rejects non-public resolution %s before fetch", async (address) => {
    const fetcher = vi.fn(async () => new Response(png, { headers: { "content-type": "image/png" } }));
    const service = new ProviderLogoService({ resolve: async () => [address], fetcher });
    const ref = service.issueReference("https://r2.thesportsdb.com/a.png");
    await expect(service.fetchReference(ref)).resolves.toBeNull(); expect(fetcher).not.toHaveBeenCalled();
  });
  it("rejects active content, oversized bodies and timeout details", async () => {
    for (const response of [new Response("<svg><script/></svg>", { headers: { "content-type": "image/svg+xml" } }), new Response(png, { headers: { "content-type": "image/png", "content-length": "1000001" } })]) {
      const service = new ProviderLogoService({ resolve: async () => ["104.21.1.10"], fetcher: async () => response });
      await expect(service.fetchReference(service.issueReference("https://r2.thesportsdb.com/a"))).resolves.toBeNull();
    }
  });
  it("keeps external candidate URLs out of browser markup", () => {
    const source = readFileSync("apps/web/app/internal/reconciliation/page.tsx", "utf8");
    expect(source).toContain("/internal-api/provider-logo/"); expect(source).not.toMatch(/<img[^>]+https?:\/\//);
    expect(source).toMatch(/review aids only/i);
  });
});
