// Pure module (no "use client", no react/next imports, no side effects) so both
// the Next app and tests/e2e import it. The e2e operator-overview signature must
// cover exactly the parameters this URL builder produces: page and test derive
// the search from one function, so a future parameter addition cannot silently
// drift out of the signed set (round-3 gap: an unsigned alertPage made the web
// proxy answer 404 on digest mismatch).
export function overviewFetchSearch(query: string, alertPage: number): string {
  return `${query}${query.includes("?") ? "&" : "?"}alertPage=${alertPage}`;
}
