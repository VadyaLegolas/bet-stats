import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest, context: { params: Promise<{ fixtureId: string }> }) {
  const { fixtureId } = await context.params;
  const url = new URL(`/fixtures/${encodeURIComponent(fixtureId)}/forecasts/compare`, process.env.API_ORIGIN ?? "http://127.0.0.1:3001");
  for (const key of ["leftId", "rightId"] as const) { const value = request.nextUrl.searchParams.get(key); if (value) url.searchParams.set(key, value); }
  const upstream = await fetch(url, { headers: { accept: "application/json", "x-eligibility-region": process.env.ELIGIBILITY_REGION ?? "", "x-age-acknowledged": process.env.ELIGIBILITY_AGE_ACKNOWLEDGED ?? "", "x-eligibility-checked-at": process.env.ELIGIBILITY_CHECKED_AT ?? "" }, cache: "no-store" });
  return new NextResponse(upstream.body, { status: upstream.status, headers: { "content-type": upstream.headers.get("content-type") ?? "application/json", "cache-control": "private, no-store, max-age=0" } });
}
