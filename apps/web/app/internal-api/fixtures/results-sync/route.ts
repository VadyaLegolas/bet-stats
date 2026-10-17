import { NextRequest, NextResponse } from "next/server";

/** Server-side proxy for the operator-guarded manual results publication. The browser never
 * holds the operator credential; without it the route answers the same fail-closed 404 as the API. */
async function proxy(request: NextRequest) {
  const credential = process.env.OPERATOR_CREDENTIAL;
  if (!credential) return NextResponse.json({ message: "Not found" }, { status: 404 });
  const upstream = new URL("/internal/fixtures/results-sync", process.env.API_ORIGIN ?? "http://127.0.0.1:3001");
  const response = await fetch(upstream, { method: "POST", headers: { "content-type": "application/json", "x-operator-credential": credential }, body: await request.text(), cache: "no-store" });
  return new NextResponse(response.body, { status: response.status, headers: { "content-type": response.headers.get("content-type") ?? "application/json", "cache-control": "private, no-store, max-age=0" } });
}

export const POST = proxy;
