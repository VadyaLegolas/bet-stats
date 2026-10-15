/** Shared request-budget facts for football-data.org fixture ingestion, used by both the
 * manual sync service (enforcement) and the public quota read (header counter) so the
 * displayed numbers can never drift from the enforced ones.
 *
 * Provider reality, measured live on 2026-10-15 from response headers
 * (`X-RequestCounter-Reset: 60`, `x-requests-available-minute: 9`): the free tier allows
 * 10 requests per minute in a rolling 60-second window and exposes no daily counter.
 * The daily guard rail below is our own policy; reservations are keyed by UTC date, so it
 * resets at 00:00 UTC. */
export const PROVIDER = "football-data.org";
/** Provider-wide allowance per UTC day; headroom keeps critical ingestion viable. */
export const DAILY_ALLOWANCE = 100;
export const CRITICAL_HEADROOM = 20;
/** Free-tier per-minute limit observed from the provider's response headers. */
export const PROVIDER_MINUTE_LIMIT = 10;
export const PROVIDER_MINUTE_WINDOW_SECONDS = 60;
