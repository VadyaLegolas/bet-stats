import type { ScannerResponse } from "@bet-stats/domain";

import { RiskDisclosure } from "../../components/risk-disclosure";

// Request-time data: the page must never be rendered at build time and frozen.
export const dynamic = "force-dynamic";

const TOP_LINE = "Кандидаты value — это оценка модели, а не рекомендация и не обещание прибыли.";

const eligibilityHeaders = () => ({
  "x-eligibility-region": process.env.ELIGIBILITY_REGION ?? "",
  "x-age-acknowledged": process.env.ELIGIBILITY_AGE_ACKNOWLEDGED ?? "",
  "x-eligibility-checked-at": process.env.ELIGIBILITY_CHECKED_AT || new Date().toISOString(),
});

async function fetchScanner(): Promise<ScannerResponse | null> {
  try {
    const response = await fetch(`${process.env.API_ORIGIN ?? "http://127.0.0.1:3001"}/value/scanner`, {
      headers: { accept: "application/json", ...eligibilityHeaders() },
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as ScannerResponse;
    return body && body.state === "AVAILABLE" && Array.isArray(body.items) ? body : null;
  } catch {
    return null;
  }
}

// Tracer body: Plan 15-03 replaces the markup with the full view and keeps the export name, force-dynamic and the no-store fetch.
export default async function ScannerPage() {
  const scanner = await fetchScanner();
  if (!scanner) {
    return (
      <section>
        <h1>Сканер value</h1>
        <p role="alert">Список кандидатов сейчас недоступен.</p>
      </section>
    );
  }
  return (
    <section>
      <h1>Сканер value</h1>
      <p>{TOP_LINE}</p>
      <RiskDisclosure />
      <ul>
        {scanner.items.map((item) => (
          <li key={item.receiptId} id={`receipt-${item.receiptId}`}>
            <span>{item.homeTeam} — {item.awayTeam}</span>
            <dl>
              <dt>Edge</dt>
              <dd>{item.edge}</dd>
              <dt>Ожидаемое value</dt>
              <dd>{item.expectedValue}</dd>
            </dl>
            <a href={`/fixtures/${item.fixtureId}`}>Страница матча</a>
          </li>
        ))}
      </ul>
    </section>
  );
}
