import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest, context: { params: Promise<{ teamId: string }> }) {
  const { teamId } = await context.params;
  const upstream = new URL(`/teams/${encodeURIComponent(teamId)}/evidence`, process.env.API_ORIGIN ?? "http://127.0.0.1:3001");
  upstream.search = request.nextUrl.search;
  const response = await fetch(upstream, { headers: { accept: "application/json" }, cache: "no-store" });
  return new NextResponse(response.body, {
    status: response.status,
    headers: {
      "content-type": response.headers.get("content-type") ?? "application/json",
      "cache-control": "no-store",
    },
  });
}
