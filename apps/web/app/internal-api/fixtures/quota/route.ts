import { NextResponse } from "next/server";

/** Server-side proxy for the public fixture-sync quota read. The browser talks to Next only;
 * upstream failures answer 503 so the header counter can show its honest unavailable state. */
async function proxy() {
  try {
    const upstream = new URL("/fixtures/quota", process.env.API_ORIGIN ?? "http://127.0.0.1:3001");
    const response = await fetch(upstream, { cache: "no-store" });
    return new NextResponse(response.body, { status: response.status, headers: { "content-type": response.headers.get("content-type") ?? "application/json", "cache-control": "private, no-store, max-age=0" } });
  } catch {
    return NextResponse.json({ message: "Счётчик лимитов недоступен" }, { status: 503 });
  }
}

export const GET = proxy;
