import { NextRequest, NextResponse } from "next/server";

const PRIVATE_NO_STORE = "private, no-store, max-age=0";
const ALLOWED = new Set(["modelVersion", "competitionId", "market", "from", "to", "cursor", "limit", "view"]);

function eligibilityHeaders(): Record<string, string> {
  return {
    "x-eligibility-region": process.env.ELIGIBILITY_REGION ?? "",
    "x-age-acknowledged": process.env.ELIGIBILITY_AGE_ACKNOWLEDGED ?? "",
    "x-eligibility-checked-at": process.env.ELIGIBILITY_CHECKED_AT ?? "",
  };
}

export async function GET(request: NextRequest) {
  const target = request.nextUrl.searchParams.get("view") === "candidates" ? "value-candidates" : "scorecard";
  const url = new URL(`/evaluation/${target}`, process.env.API_ORIGIN ?? "http://127.0.0.1:3001");
  for (const [key, value] of request.nextUrl.searchParams) if (ALLOWED.has(key) && key !== "view") url.searchParams.append(key, value);
  const upstream = await fetch(url, { headers: { accept: "application/json", ...eligibilityHeaders() }, cache: "no-store", redirect: "manual" });
  const headers: Record<string, string> = { "content-type": upstream.headers.get("content-type") ?? "application/json", "cache-control": PRIVATE_NO_STORE };
  const location = upstream.headers.get("location");
  if (location) headers.location = location;
  return new NextResponse(upstream.body, { status: upstream.status, headers });
}
