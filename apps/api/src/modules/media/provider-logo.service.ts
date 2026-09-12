import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { promises as dns } from "node:dns";

type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;
type Resolver = (hostname: string) => Promise<readonly string[]>;
const HOSTS = new Set(["www.thesportsdb.com", "r2.thesportsdb.com", "images.thesportsdb.com"]);
const MAX_BYTES = 1_000_000;

export class ProviderLogoService {
  readonly #fetcher: Fetcher; readonly #resolve: Resolver; readonly #timeoutMs: number;
  constructor(options: { fetcher?: Fetcher; resolve?: Resolver; timeoutMs?: number } = {}) {
    this.#fetcher = options.fetcher ?? fetch;
    this.#resolve = options.resolve ?? (async (host) => (await dns.lookup(host, { all: true })).map((entry) => entry.address));
    this.#timeoutMs = options.timeoutMs ?? 5_000;
  }
  async validate(candidate: string | null): Promise<{ status: "validated"; logoRef: string } | { status: "placeholder"; reason: "missing" | "rejected" | "broken" }> {
    if (!candidate) return { status: "placeholder", reason: "missing" };
    try {
      let url = new URL(candidate);
      for (let redirect = 0; redirect <= 2; redirect += 1) {
        await this.#assertSafe(url);
        const response = await this.#fetcher(url, { redirect: "manual", signal: AbortSignal.timeout(this.#timeoutMs), headers: { accept: "image/png,image/jpeg,image/webp" } });
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get("location"); if (!location || redirect === 2) return { status: "placeholder", reason: "rejected" };
          url = new URL(location, url); continue;
        }
        if (!response.ok) return { status: "placeholder", reason: "broken" };
        const mime = response.headers.get("content-type")?.split(";")[0]?.trim();
        if (!mime || !["image/png", "image/jpeg", "image/webp"].includes(mime)) return { status: "placeholder", reason: "rejected" };
        const announced = Number(response.headers.get("content-length") ?? 0); if (announced > MAX_BYTES) return { status: "placeholder", reason: "rejected" };
        const bytes = new Uint8Array(await response.arrayBuffer()); if (bytes.length > MAX_BYTES || !signatureMatches(mime, bytes)) return { status: "placeholder", reason: "rejected" };
        return { status: "validated", logoRef: `provider-logo:${createHash("sha256").update(bytes).digest("hex")}` };
      }
      return { status: "placeholder", reason: "rejected" };
    } catch { return { status: "placeholder", reason: "rejected" }; }
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
  const [a = 0, b = 0] = parts; return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}
function signatureMatches(mime: string, bytes: Uint8Array): boolean {
  if (mime === "image/png") return bytes.length >= 8 && [0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a].every((value, index) => bytes[index] === value);
  if (mime === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9;
  return bytes.length >= 12 && new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP";
}
