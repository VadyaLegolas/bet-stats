import { NextRequest, NextResponse } from "next/server";

const JSON_CONTENT_TYPE = /^application\/json(?:;\s*charset=utf-8)?$/iu;

export async function GET(request: NextRequest, context: { params: Promise<{ receiptId: string }> }) {
  const { receiptId } = await context.params;
  const download = request.nextUrl.searchParams.get("download") === "true";
  const suffix = download ? "/download" : "";
  const response = await fetch(new URL(`/value-receipts/${encodeURIComponent(receiptId)}${suffix}`, process.env.API_ORIGIN ?? "http://127.0.0.1:3001"), {
    method: "GET",
    headers: {
      accept: "application/json",
      "x-eligibility-region": process.env.ELIGIBILITY_REGION ?? "",
      "x-age-acknowledged": process.env.ELIGIBILITY_AGE_ACKNOWLEDGED ?? "",
      "x-eligibility-checked-at": process.env.ELIGIBILITY_CHECKED_AT ?? "",
    },
    cache: "no-store",
  });
  const upstreamType = response.headers.get("content-type") ?? "";
  const headers: Record<string, string> = {
    "content-type": JSON_CONTENT_TYPE.test(upstreamType) ? upstreamType : "application/json",
    "cache-control": "private, no-store, max-age=0",
  };
  const disposition = response.headers.get("content-disposition");
  const safeDisposition = `attachment; filename="value-receipt-${receiptId}.json"`;
  if (download && disposition === safeDisposition && /^[A-Za-z0-9_-]+$/.test(receiptId)) headers["content-disposition"] = disposition;
  return new NextResponse(response.body, { status: response.status, headers });
}
