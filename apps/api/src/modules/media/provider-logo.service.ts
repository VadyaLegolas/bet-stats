import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { promises as dns } from "node:dns";
import { request as httpsRequest } from "node:https";
import { Inject, Injectable, Optional } from "@nestjs/common";
import ipaddr from "ipaddr.js";

type Fetcher = (input: URL, init: RequestInit & { pinnedAddress: string }) => Promise<Response>;
type Resolver = (hostname: string) => Promise<readonly string[]>;
const HOSTS = new Set(["www.thesportsdb.com", "r2.thesportsdb.com", "images.thesportsdb.com"]);
const MAX_BYTES = 1_000_000;
const REFERENCE_SECRET = randomBytes(32);

@Injectable()
export class ProviderLogoService {
  readonly #fetcher: Fetcher; readonly #resolve: Resolver; readonly #timeoutMs: number;
  constructor(@Optional() @Inject("PROVIDER_LOGO_OPTIONS") options: { fetcher?: Fetcher; resolve?: Resolver; timeoutMs?: number } = {}) {
    this.#fetcher = options.fetcher ?? pinnedHttpsFetch;
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
        const pinnedAddress = await this.#assertSafe(url);
        const response = await this.#fetcher(url, { pinnedAddress, redirect: "manual", signal: AbortSignal.timeout(this.#timeoutMs), headers: { accept: "image/png,image/jpeg,image/webp" } });
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get("location"); if (!location || redirect === 2) return null;
          url = new URL(location, url); continue;
        }
        if (!response.ok) return null;
        const mime = response.headers.get("content-type")?.split(";")[0]?.trim();
        if (!mime || !["image/png", "image/jpeg", "image/webp"].includes(mime)) return null;
        const announced = Number(response.headers.get("content-length") ?? 0); if (announced > MAX_BYTES) return null;
        const bytes = await readBounded(response, MAX_BYTES); if (!bytes || !signatureMatches(mime, bytes)) return null;
        return { mime, bytes };
      }
      return null;
    } catch { return null; }
  }
  async #assertSafe(url: URL): Promise<string> {
    if (url.protocol !== "https:" || url.username || url.password || !HOSTS.has(url.hostname.toLowerCase())) throw new Error();
    const addresses = isIP(url.hostname) ? [url.hostname] : await this.#resolve(url.hostname);
    if (!addresses.length || addresses.some((address) => !isGlobalUnicast(address))) throw new Error();
    return addresses[0]!;
  }
}
async function readBounded(response: Response, limit: number): Promise<Uint8Array | null> {
  if (!response.body) return null;
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let length = 0;
  try { for (;;) { const { done, value } = await reader.read(); if (done) break; if (!value) continue; length += value.byteLength; if (length > limit) { await reader.cancel(); return null; } chunks.push(value); } }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; } return bytes;
}
function pinnedHttpsFetch(url: URL, init: RequestInit & { pinnedAddress: string }): Promise<Response> {
  return new Promise((resolve, reject) => {
    const request = httpsRequest(url, {
      method: "GET", headers: init.headers as Record<string, string>, servername: url.hostname,
      lookup: (_hostname, _options, callback) => callback(null, init.pinnedAddress, isIP(init.pinnedAddress)),
    }, (incoming) => {
      const headers = new Headers(); for (const [key, value] of Object.entries(incoming.headers)) if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
      resolve(new Response(incoming as unknown as BodyInit, { status: incoming.statusCode ?? 500, statusText: incoming.statusMessage ?? "", headers }));
    });
    const abort = () => request.destroy(new Error("ABORTED")); init.signal?.addEventListener("abort", abort, { once: true });
    request.once("error", reject); request.once("close", () => init.signal?.removeEventListener("abort", abort)); request.end();
  });
}
function isGlobalUnicast(address: string): boolean {
  try {
    const parsed = ipaddr.process(address);
    if (parsed.range() !== "unicast") return false;
    if (parsed.kind() !== "ipv4") return true;
    const [a, b, c] = parsed.toByteArray();
    return !(a === 192 && b === 0 && c === 0)
      && !(a === 192 && b === 88 && c === 99)
      && !(a === 198 && (b === 18 || b === 19));
  } catch {
    return false;
  }
}
function signatureMatches(mime: string, bytes: Uint8Array): boolean {
  if (mime === "image/png") return bytes.length >= 8 && [0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a].every((value, index) => bytes[index] === value);
  if (mime === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9;
  return bytes.length >= 12 && new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP";
}
