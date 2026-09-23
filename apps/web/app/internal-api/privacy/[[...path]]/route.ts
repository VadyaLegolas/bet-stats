import { NextRequest, NextResponse } from "next/server";

const privateHeaders = { "cache-control": "private, no-store, max-age=0" };
const forwarded = ["x-privacy-subject", "x-privacy-timestamp", "x-privacy-signature"] as const;

async function proxy(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  const { path = [] } = await context.params;
  if (path.some((segment) => !/^[A-Za-z0-9_-]{1,64}$/.test(segment))) return NextResponse.json({ code: "NOT_FOUND" }, { status: 404, headers: privateHeaders });
  const headers = new Headers({ "content-type": "application/json" });
  for (const name of forwarded) { const value = request.headers.get(name); if (value) headers.set(name, value); }
  const upstream = new URL(`/privacy/${path.map(encodeURIComponent).join("/")}`, process.env.API_ORIGIN ?? "http://127.0.0.1:3001");
  const response = await fetch(upstream, { method: request.method, headers, ...(request.method === "POST" ? { body: await request.text() } : {}), cache: "no-store" });
  return new NextResponse(response.body, { status: response.status, headers: { "content-type": response.headers.get("content-type") ?? "application/json", ...privateHeaders } });
}

export const GET = proxy;
export const POST = proxy;
