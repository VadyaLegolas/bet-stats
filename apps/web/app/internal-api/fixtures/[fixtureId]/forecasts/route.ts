import { NextRequest, NextResponse } from "next/server";

const PRIVATE_NO_STORE = "private, no-store, max-age=0";
const BODY_FIELDS = ["kind", "cutoff"] as const;

function eligibilityHeaders(): Record<string, string> {
  return {
    "x-eligibility-region": process.env.ELIGIBILITY_REGION ?? "",
    "x-age-acknowledged": process.env.ELIGIBILITY_AGE_ACKNOWLEDGED ?? "",
    "x-eligibility-checked-at": process.env.ELIGIBILITY_CHECKED_AT ?? "",
  };
}

function responseFrom(upstream: Response): NextResponse {
  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "application/json",
      "cache-control": PRIVATE_NO_STORE,
    },
  });
}

async function requestBody(request: NextRequest): Promise<string> {
  const raw = await request.json() as Record<string, unknown>;
  return JSON.stringify(Object.fromEntries(BODY_FIELDS.filter((field) => field in raw).map((field) => [field, raw[field]])));
}

export async function GET(request: NextRequest, context: { params: Promise<{ fixtureId: string }> }) {
  const { fixtureId } = await context.params;
  const url = new URL(`/fixtures/${encodeURIComponent(fixtureId)}/forecasts`, process.env.API_ORIGIN ?? "http://127.0.0.1:3001");
  for (const field of ["kind", "cutoff"] as const) {
    const value = request.nextUrl.searchParams.get(field);
    if (value !== null) url.searchParams.set(field, value);
  }
  return responseFrom(await fetch(url, { method: "GET", headers: { accept: "application/json", ...eligibilityHeaders() }, cache: "no-store" }));
}

export async function POST(request: NextRequest, context: { params: Promise<{ fixtureId: string }> }) {
  const { fixtureId } = await context.params;
  const url = new URL(`/fixtures/${encodeURIComponent(fixtureId)}/forecasts`, process.env.API_ORIGIN ?? "http://127.0.0.1:3001");
  return responseFrom(await fetch(url, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json", ...eligibilityHeaders() },
    body: await requestBody(request),
    cache: "no-store",
  }));
}
