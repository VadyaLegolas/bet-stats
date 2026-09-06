import { NextRequest, NextResponse } from "next/server";

const PRIVATE_NO_STORE = "private, no-store, max-age=0";
const BODY_FIELDS = ["oddsSnapshotId", "market", "sourceLabel", "capturedAt", "selections", "replacementOfOddsSnapshotId"] as const;

function eligibilityHeaders(): Record<string, string> {
  return { "x-eligibility-region": process.env.ELIGIBILITY_REGION ?? "", "x-age-acknowledged": process.env.ELIGIBILITY_AGE_ACKNOWLEDGED ?? "", "x-eligibility-checked-at": process.env.ELIGIBILITY_CHECKED_AT ?? "" };
}

function responseFrom(upstream: Response): NextResponse {
  return new NextResponse(upstream.body, { status: upstream.status, headers: { "content-type": upstream.headers.get("content-type") ?? "application/json", "cache-control": PRIVATE_NO_STORE } });
}

export async function GET(request: NextRequest, context: { params: Promise<{ fixtureId: string }> }) {
  const { fixtureId } = await context.params;
  const snapshotId = request.nextUrl.searchParams.get("oddsSnapshotId") ?? "";
  const url = new URL(`/fixtures/${encodeURIComponent(fixtureId)}/odds/${encodeURIComponent(snapshotId)}`, process.env.API_ORIGIN ?? "http://127.0.0.1:3001");
  return responseFrom(await fetch(url, { method: "GET", headers: { accept: "application/json", ...eligibilityHeaders() }, cache: "no-store" }));
}

export async function POST(request: NextRequest, context: { params: Promise<{ fixtureId: string }> }) {
  const { fixtureId } = await context.params;
  const raw = await request.json() as Record<string, unknown>;
  const body = Object.fromEntries(BODY_FIELDS.filter((field) => field in raw).map((field) => [field, raw[field]]));
  const url = new URL(`/fixtures/${encodeURIComponent(fixtureId)}/odds`, process.env.API_ORIGIN ?? "http://127.0.0.1:3001");
  return responseFrom(await fetch(url, { method: "POST", headers: { accept: "application/json", "content-type": "application/json", ...eligibilityHeaders() }, body: JSON.stringify(body), cache: "no-store" }));
}
