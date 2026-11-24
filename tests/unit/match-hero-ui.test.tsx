import { createElement } from "../../apps/web/node_modules/react/index.js";
import { renderToStaticMarkup } from "../../apps/web/node_modules/react-dom/server.js";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { BackLink, MatchHero } from "../../apps/web/app/fixtures/[fixtureId]/match-hero.js";
import { formatInstant } from "../../apps/web/components/time-format.js";

const KICKOFF = "2026-10-17T13:00:00.000Z";
const fixture = {
  competition: { name: "Premier League", season: "2026" },
  teams: { home: { id: "t-1", name: "Arsenal" }, away: { id: "t-2", name: "Chelsea" } },
  kickoff: KICKOFF,
  status: "SCHEDULED",
};
const evidenceHref = (teamId: string) => `/teams/${teamId}/evidence?asOf=${encodeURIComponent(KICKOFF)}`;
const renderHero = (overrides: Partial<typeof fixture> = {}) =>
  renderToStaticMarkup(createElement(MatchHero, { fixture: { ...fixture, ...overrides }, timeZone: "Europe/Warsaw", evidenceHref }));
const stripTags = (value: string) => value.replace(/<[^>]*>/g, "");

describe("BackLink", () => {
  it("renders an anchor with an aria-hidden chevron before the unchanged text", () => {
    const markup = renderToStaticMarkup(createElement(BackLink, { href: "/fixtures?from=2026-10-17" }));
    expect(markup.startsWith('<a class="back-link" href="/fixtures?from=2026-10-17">')).toBe(true);
    expect(markup).toMatch(/<svg aria-hidden="true" viewBox="0 0 24 24"[^>]*><path d="[^"]+"><\/path><\/svg>Назад к матчам<\/a>$/);
    expect(markup).not.toContain("<title");
    expect(stripTags(markup)).toBe("Назад к матчам");
  });
});

describe("MatchHero", () => {
  const markup = renderHero();

  it("renders the h1 with a muted 'против' and the exact title text", () => {
    expect(markup.startsWith('<header class="match-hero"><h1 class="match-title">')).toBe(true);
    expect(markup).toContain('<span class="match-vs">против</span>');
    const title = markup.match(/<h1 class="match-title">(.*?)<\/h1>/);
    expect(title).not.toBeNull();
    expect(stripTags(title![1]!)).toBe("Arsenal против Chelsea");
  });

  it("renders the five dt texts in order inside the facts grid, each pair in its own div", () => {
    expect(markup).toContain('<dl class="facts-grid">');
    const dts = [...markup.matchAll(/<dt>(.*?)<\/dt>/g)].map((match) => match[1]);
    expect(dts).toEqual(["Соревнование", "Сезон", "Начало (Europe/Warsaw)", "Статус", "Исторические доказательства"]);
    const groups = [...markup.matchAll(/<div(?: class="[^"]*")?><dt>/g)];
    expect(groups.length).toBe(5);
    expect(markup).toContain('<div class="facts-wide"><dt>Исторические доказательства</dt>');
    expect(markup.match(/facts-wide/g)?.length).toBe(1);
  });

  it("keeps the kickoff time element, status label and two evidence links", () => {
    expect(markup).toContain(`<time dateTime="${KICKOFF}" title="${KICKOFF}">`);
    expect(markup).toContain(`${formatInstant(KICKOFF, "Europe/Warsaw")}</time>`);
    expect(markup).toContain("<dd>запланирован</dd>");
    expect(markup).toContain('<dd class="detail-links">');
    const links = [...markup.matchAll(/<a class="link-touch" href="([^"]*)">(.*?)<\/a>/g)].map((match) => [match[1], match[2]]);
    expect(links).toEqual([
      ["/teams/t-1/evidence?asOf=2026-10-17T13%3A00%3A00.000Z", "Доказательства Arsenal на момент начала"],
      ["/teams/t-2/evidence?asOf=2026-10-17T13%3A00%3A00.000Z", "Доказательства Chelsea на момент начала"],
    ]);
  });

  it("renders the competition and status labels exactly once in visible text", () => {
    const visible = stripTags(markup);
    expect(visible.match(/Premier League/g)?.length).toBe(1);
    expect(visible.match(/запланирован/g)?.length).toBe(1);
    expect(markup).not.toContain("chip");
    expect(markup).not.toContain("prob-bar");
  });

  it("escapes untrusted names as text", () => {
    const hostile = renderHero({ teams: { home: { id: "t-1", name: "<img src=x>" }, away: { id: "t-2", name: "A&B" } } });
    expect(hostile).not.toContain("<img");
    expect(hostile).toContain("&lt;img src=x&gt;");
    expect(hostile).toContain("A&amp;B");
  });
});

describe("match hero stylesheet contract", () => {
  const raw = readFileSync(resolve(import.meta.dirname, "../../apps/web/app/globals.css"), "utf8");
  const css = raw.replace(/\/\*[\s\S]*?\*\//g, "");
  const markup = renderToStaticMarkup(createElement(BackLink, { href: "/fixtures" })) + renderHero();

  it("has a selector for every class the hero emits", () => {
    const classes = new Set<string>();
    for (const match of markup.matchAll(/class="([^"]*)"/g)) for (const token of match[1]!.split(/\s+/)) classes.add(token);
    expect(classes.size).toBeGreaterThan(5);
    for (const token of classes) expect(css, `missing .${token}`).toMatch(new RegExp(`\\.${token}(?![\\w-])`));
  });

  it("keeps the back link at least 44px tall", () => {
    const rule = css.match(/\.back-link\s*\{[^}]*\}/);
    expect(rule).not.toBeNull();
    expect(rule![0]).toMatch(/min-height:\s*44px/);
  });

  it("uses only design tokens for colour in the hero rules", () => {
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([, selector]) => /(^|[\s,])\.(back-link|match-|facts-)/.test(selector!));
    expect(rules.length).toBeGreaterThan(8);
    for (const [, selector, body] of rules) {
      expect(body, selector!.trim()).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(body, selector!.trim()).not.toMatch(/rgba?\(/);
    }
  });

  it("no longer caps the page column at 960px", () => {
    const rule = css.match(/\.release-main \.page-column\s*\{[^}]*\}/);
    expect(rule).not.toBeNull();
    expect(rule![0]).not.toMatch(/960px/);
    expect(rule![0]).toMatch(/max-width:\s*none/);
  });
});
