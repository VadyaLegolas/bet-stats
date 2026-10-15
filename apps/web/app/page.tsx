import Link from "next/link";

const CONTENTS = [
  { label: "Fixtures", href: "/fixtures", detail: "Upcoming matches grouped by local date, each with an honest data-state label." },
  { label: "Analysis", href: "/fixtures#match-analysis", detail: "Frozen forecasts with evidence receipts, assumptions and gate outcomes." },
  { label: "Results", href: "/scorecards", detail: "Scorecards that measure calibration after every completed match." },
  { label: "Methodology", href: "/methodology", detail: "Inputs, exclusions, confidence, limitations and evaluation policy." },
] as const;

const PRINCIPLES = [
  { number: "01", title: "Canonical identity", description: "Independent entity resolution and strictly audited historical matching across multiple sports data providers." },
  { number: "02", title: "Poisson & Elo models", description: "Rigorous mathematical models calculating fair odds, Over/Under 2.5, and BTTS without black-box bias." },
  { number: "03", title: "Calibrated outcomes", description: "Honest Brier Score and Log Loss scorecards tracking true predictive quality after every completed match." },
] as const;

export default function HomePage() {
  return (
    <>
      <div className="hero-container">
        <div>
          <p className="hero-kicker">Evidence-first football forecasting</p>

          <h1 id="home-heading" className="hero-title">
            Trustworthy football fixture data
          </h1>

          <p className="hero-subtitle">
            Transparent, evidence-based probability estimates for top European leagues.
            Inspect historical form, compare Poisson-Elo forecasts, and measure real predictive quality.
          </p>

          <div className="hero-actions">
            <Link href="/fixtures" className="btn-primary">
              View upcoming fixtures
            </Link>
            <Link href="/methodology" className="btn-secondary">
              How forecasts work
            </Link>
            <Link href="/scorecards" className="btn-secondary">
              Forecast scorecards
            </Link>
          </div>
        </div>

        <aside className="hero-ledger" aria-label="Contents">
          <h2>In this edition</h2>
          <dl>
            {CONTENTS.map((item) => (
              <div className="ledger-row" key={item.label}>
                <dt><Link href={item.href}>{item.label}</Link></dt>
                <dd>{item.detail}</dd>
              </div>
            ))}
          </dl>
        </aside>
      </div>

      <section className="principle-grid" aria-label="How this product works">
        {PRINCIPLES.map((principle) => (
          <article className="principle" key={principle.number}>
            <span className="principle-number" aria-hidden="true">{principle.number}</span>
            <h2>{principle.title}</h2>
            <p>{principle.description}</p>
          </article>
        ))}
      </section>
    </>
  );
}
