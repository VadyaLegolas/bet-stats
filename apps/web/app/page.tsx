import Link from "next/link";

export default function HomePage() {
  return (
    <section aria-labelledby="home-heading" style={{ maxWidth: 720 }}>
      <h1 id="home-heading" style={{ margin: 0, fontSize: 28, lineHeight: 1.2, fontWeight: 600 }}>
        Trustworthy football fixture data
      </h1>
      <p style={{ margin: "16px 0 0", fontSize: 16, lineHeight: 1.5 }}>
        Browse upcoming fixtures with clear source and freshness information.
      </p>
      <Link href="/fixtures" style={{ color: "#1D4ED8", display: "inline-flex", alignItems: "center", minHeight: 48, marginTop: 24 }}>
        View fixtures
      </Link>
    </section>
  );
}
