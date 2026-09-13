import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { promises as dns } from "node:dns";
import { Inject, Injectable, Optional } from "@nestjs/common";

type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;
type Resolver = (hostname: string) => Promise<readonly string[]>;
const HOSTS = new Set(["www.thesportsdb.com", "r2.thesportsdb.com", "images.thesportsdb.com"]);
const MAX_BYTES = 1_000_000;
const REFERENCE_SECRET = randomBytes(32);

@Injectable()
export class ProviderLogoService {
  readonly #fetcher: Fetcher; readonly #resolve: Resolver; readonly #timeoutMs: number;
  constructor(@Optional() @Inject("PROVIDER_LOGO_OPTIONS") options: { fetcher?: Fetcher; resolve?: Resolver; timeoutMs?: number } = {}) {
    this.#fetcher = options.fetcher ?? fetch;
    this.#resolve = options.resolve ?? (async (host) => (await dns.lookup(host, { all: true })).map((entry) => entry.address));
    this.#timeoutMs = options.timeoutMs ?? 5_000;
  }
  issueReference(candidate: string): string {
    const payload = Buffer.from(candidate, "utf8").toString("base64url");
    const signature = createHmac("sha256", REFERENCE_SECRET).update(payload).digest("base64url");
    return `${payload}.${signature}`;
  }
  async fetchReference(reference: string): Promise<{ mime: string; bytes: Uint8Array } | null> {
    if (reference.length > 3_000) return null;
    const [payload, supplied, extra] = reference.split("."); if (!payload || !supplied || extra) return null;
    const expected = createHmac("sha256", REFERENCE_SECRET).update(payload).digest();
    let actual: Buffer; try { actual = Buffer.from(supplied, "base64url"); } catch { return null; }
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    let candidate: string; try { candidate = Buffer.from(payload, "base64url").toString("utf8"); } catch { return null; }
    return this.#fetchValidated(candidate);
  }
  async validate(candidate: string | null): Promise<{ status: "validated"; logoRef: string } | { status: "placeholder"; reason: "missing" | "rejected" | "broken" }> {
    if (!candidate) return { status: "placeholder", reason: "missing" };
    try {
      const image = await this.#fetchValidated(candidate); if (!image) return { status: "placeholder", reason: "rejected" };
      return { status: "validated", logoRef: `provider-logo:${createHash("sha256").update(image.bytes).digest("hex")}` };
    } catch { return { status: "placeholder", reason: "rejected" }; }
  }
  async #fetchValidated(candidate: string): Promise<{ mime: string; bytes: Uint8Array } | null> {
    try { let url = new URL(candidate);
      for (let redirect = 0; redirect <= 2; redirect += 1) {
        await this.#assertSafe(url);
        const response = await this.#fetcher(url, { redirect: "manual", signal: AbortSignal.timeout(this.#timeoutMs), headers: { accept: "image/png,image/jpeg,image/webp" } });
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get("location"); if (!location || redirect === 2) return null;
          url = new URL(location, url); continue;
        }
        if (!response.ok) return null;
        const mime = response.headers.get("content-type")?.split(";")[0]?.trim();
        if (!mime || !["image/png", "image/jpeg", "image/webp"].includes(mime)) return null;
        const announced = Number(response.headers.get("content-length") ?? 0); if (announced > MAX_BYTES) return null;
        const bytes = new Uint8Array(await response.arrayBuffer()); if (bytes.length > MAX_BYTES || !signatureMatches(mime, bytes)) return null;
        return { mime, bytes };
      }
      return null;
    } catch { return null; }
  }
  async #assertSafe(url: URL): Promise<void> {
    if (url.protocol !== "https:" || url.username || url.password || !HOSTS.has(url.hostname.toLowerCase())) throw new Error();
    const addresses = isIP(url.hostname) ? [url.hostname] : await this.#resolve(url.hostname);
    if (!addresses.length || addresses.some(isPrivate)) throw new Error();
  }
}
function isPrivate(address: string): boolean {
  const lower = address.toLowerCase();
  if (lower === "::1" || lower === "::" || lower.startsWith("fe80:") || lower.startsWith("fc") || lower.startsWith("fd")) return true;
  const parts = address.split(".").map(Number); if (parts.length !== 4) return false;
  const [a = 0, b = 0] = parts; return a === 10 || a === 127 || a === 0 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}
function signatureMatches(mime: string, bytes: Uint8Array): boolean {
  if (mime === "image/png") return bytes.length >= 8 && [0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a].every((value, index) => bytes[index] === value);
  if (mime === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9;
  return bytes.length >= 12 && new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP";
}
