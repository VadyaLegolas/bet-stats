import { NextRequest, NextResponse } from "next/server";

async function proxy(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  const credential = process.env.OPERATOR_CREDENTIAL;
  if (!credential) return NextResponse.json({ message: "Not found" }, { status: 404 });
  const { path = [] } = await context.params; const upstream = new URL(`/internal/reconciliation/${path.map(encodeURIComponent).join("/")}`, process.env.API_ORIGIN ?? "http://127.0.0.1:3001"); upstream.search = request.nextUrl.search;
  const response = await fetch(upstream, { method: request.method, headers: { "content-type": "application/json", "x-operator-credential": credential }, ...(request.method === "POST" ? { body: await request.text() } : {}), cache: "no-store" });
  return new NextResponse(response.body, { status: response.status, headers: { "content-type": response.headers.get("content-type") ?? "application/json", "cache-control": "private, no-store, max-age=0" } });
}
export const GET = proxy; export const POST = proxy;
