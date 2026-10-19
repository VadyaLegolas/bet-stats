import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest, context: { params: Promise<{ teamId: string }> }) {
  const { teamId } = await context.params;
  const upstream = new URL(`/teams/${encodeURIComponent(teamId)}/evidence`, process.env.API_ORIGIN ?? "http://127.0.0.1:3001");
  upstream.search = request.nextUrl.search;
  const response = await fetch(upstream, { headers: { accept: "application/json" }, cache: "no-store" });
  const contentType = response.headers.get("content-type") ?? "";
  const text = await response.text();
  // The evidence page renders human timestamps in the product's display zone.
  // The API payload carries no zone, so this web edge (which owns
  // DISPLAY_TIME_ZONE) annotates the JSON; a zone the API someday provides
  // still wins because the spread runs last.
  let body = text;
  if (response.ok && contentType.includes("json")) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) body = JSON.stringify({ displayTimeZone: process.env.DISPLAY_TIME_ZONE ?? "UTC", ...parsed });
    } catch {
      // Not the JSON we expected — pass the upstream bytes through untouched.
    }
  }
  return new NextResponse(body, {
    status: response.status,
    headers: {
      "content-type": contentType || "application/json",
      "cache-control": "no-store",
    },
  });
}
