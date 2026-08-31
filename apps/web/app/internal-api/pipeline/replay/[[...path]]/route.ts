import { NextRequest, NextResponse } from "next/server";

import { verifyIngressReplayRequest } from "../../../../../src/security/operator-proxy-authorization.js";

const privateHeaders = { "cache-control": "private, no-store, max-age=0" };

async function proxy(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  const authorization = verifyIngressReplayRequest(request);
  if (!authorization) return NextResponse.json({ message: "Not found" }, { status: 404, headers: privateHeaders });
  const credential = process.env.OPERATOR_CREDENTIAL;
  if (!credential) return NextResponse.json({ message: "Not found" }, { status: 404, headers: privateHeaders });
  const { path = [] } = await context.params;
  const upstream = new URL(`/internal/pipeline/replay/${path.map(encodeURIComponent).join("/")}`, process.env.API_ORIGIN ?? "http://127.0.0.1:3001");
  upstream.search = request.nextUrl.search;
  const response = await fetch(upstream, {
    method: request.method,
    headers: { "content-type": "application/json", "x-operator-credential": credential, "x-operator-actor": authorization.subject },
    ...(request.method === "POST" ? { body: await request.text() } : {}),
    cache: "no-store",
  });
  return new NextResponse(response.body, { status: response.status, headers: { "content-type": response.headers.get("content-type") ?? "application/json", ...privateHeaders } });
}

export const GET = proxy;
export const POST = proxy;
