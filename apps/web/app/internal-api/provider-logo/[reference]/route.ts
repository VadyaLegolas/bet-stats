import { NextRequest, NextResponse } from "next/server";
export async function GET(_request: NextRequest, context: { params: Promise<{ reference: string }> }) {
  const credential = process.env.OPERATOR_CREDENTIAL; if (!credential) return NextResponse.json({ message: "Not found" }, { status: 404 });
  const { reference } = await context.params; const upstream = new URL(`/internal/media/provider-logo/${encodeURIComponent(reference)}`, process.env.API_ORIGIN ?? "http://127.0.0.1:3001");
  const response = await fetch(upstream, { headers: { "x-operator-credential": credential }, cache: "no-store" });
  return new NextResponse(response.body, { status: response.status, headers: { "content-type": response.headers.get("content-type") ?? "application/octet-stream", "content-length": response.headers.get("content-length") ?? "0", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox", "referrer-policy": "no-referrer", "cache-control": "private, max-age=300" } });
}
