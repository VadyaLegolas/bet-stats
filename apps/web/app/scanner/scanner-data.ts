import { parseScannerResponse, type ScannerPayload } from "./scanner-types";

const API_ORIGIN_DEFAULT = "http://127.0.0.1:3001";
const REQUEST_TIMEOUT_MS = 10_000;

/* Same header shape as the scorecards page; the environment is read at call time, never at import time. */
const eligibilityHeaders = () => ({
  "x-eligibility-region": process.env.ELIGIBILITY_REGION ?? "",
  "x-age-acknowledged": process.env.ELIGIBILITY_AGE_ACKNOWLEDGED ?? "",
  "x-eligibility-checked-at": process.env.ELIGIBILITY_CHECKED_AT || new Date().toISOString(),
});

/**
 * Server read of `GET /value/scanner`. Returns the parsed payload, or null for every failure: a thrown error or timeout, any
 * non-2xx status (a redirect included), a body that is not valid JSON, or a payload the fail-closed parser does not
 * recognise. The page renders null as UNAVAILABLE. No cause is invented and no response body is logged.
 */
export async function readScanner(fetchImpl: typeof fetch = fetch): Promise<ScannerPayload | null> {
  try {
    const response = await fetchImpl(`${process.env.API_ORIGIN ?? API_ORIGIN_DEFAULT}/value/scanner`, {
      headers: { accept: "application/json", ...eligibilityHeaders() },
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return parseScannerResponse(await response.json());
  } catch {
    return null;
  }
}
