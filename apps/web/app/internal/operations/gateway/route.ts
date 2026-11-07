import { createHmac } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const secret = process.env.OPERATOR_PROXY_SIGNING_SECRET;
  const username = process.env.OPERATOR_BASIC_USERNAME;
  const password = process.env.OPERATOR_BASIC_PASSWORD;
  const gatewayPort = process.env.GATEWAY_PORT || "8080";

  if (!secret || !username || !password) {
    return NextResponse.redirect(new URL("/internal/operations", request.url));
  }

  const token = createHmac("sha256", secret).update(`${username}:${password}`).digest("base64url");
  const hostname = request.nextUrl.hostname || "127.0.0.1";
  const protocol = request.nextUrl.protocol || "http:";

  const search = new URLSearchParams(request.nextUrl.searchParams);
  search.set("operator_token", token);

  const gatewayUrl = `${protocol}//${hostname}:${gatewayPort}/internal/operations?${search.toString()}`;
  return NextResponse.redirect(gatewayUrl);
}

export const dynamic = "force-dynamic";
