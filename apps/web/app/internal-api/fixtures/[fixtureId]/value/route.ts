import { NextRequest, NextResponse } from "next/server";

const BODY_FIELDS = ["forecastSnapshotId", "oddsSnapshotId", "market", "selection"] as const;

export async function POST(request: NextRequest, context: { params: Promise<{ fixtureId: string }> }) {
  const { fixtureId } = await context.params;
  const raw = await request.json() as Record<string, unknown>;
  const body = { fixtureId, ...Object.fromEntries(BODY_FIELDS.filter((field) => field in raw).map((field) => [field, raw[field]])) };
  const response = await fetch(new URL("/value-receipts", process.env.API_ORIGIN ?? "http://127.0.0.1:3001"), {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-eligibility-region": process.env.ELIGIBILITY_REGION ?? "",
      "x-age-acknowledged": process.env.ELIGIBILITY_AGE_ACKNOWLEDGED ?? "",
      "x-eligibility-checked-at": process.env.ELIGIBILITY_CHECKED_AT ?? "",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  return new NextResponse(response.body, { status: response.status, headers: { "content-type": response.headers.get("content-type") ?? "application/json", "cache-control": "private, no-store, max-age=0" } });
}
