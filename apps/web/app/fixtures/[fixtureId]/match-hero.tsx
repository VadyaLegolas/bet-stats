import Link from "next/link";

import { formatInstant } from "../../../components/time-format";
import { statusLabel } from "../status-labels";

/** Структурный тип: компонент не зависит от локального типа Fixture страницы. */
type HeroFixture = {
  competition: { name: string; season: string };
  teams: { home: { id: string; name: string }; away: { id: string; name: string } };
  kickoff: string;
  status: string;
};

/** Ссылка «Назад к матчам»: шеврон слева, текст и href не меняются. */
export function BackLink({ href }: { href: string }) {
  return (
    <Link className="back-link" href={href}>
      <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
        <path d="M15 5l-7 7 7 7" />
      </svg>
      Назад к матчам
    </Link>
  );
}

/** Карточка матча: заголовок и реальные факты плитками. Прогноза здесь нет намеренно. */
export function MatchHero({ fixture, timeZone, evidenceHref }: { fixture: HeroFixture; timeZone: string; evidenceHref: (teamId: string) => string }) {
  const { home, away } = fixture.teams;
  return (
    <header className="match-hero">
      <h1 className="match-title">
        {home.name} <span className="match-vs">против</span> {away.name}
      </h1>
      <dl className="facts-grid">
        <div>
          <dt>Соревнование</dt>
          <dd>{fixture.competition.name}</dd>
        </div>
        <div>
          <dt>Сезон</dt>
          <dd>{fixture.competition.season}</dd>
        </div>
        <div>
          <dt>Начало ({timeZone})</dt>
          <dd>
            <time dateTime={fixture.kickoff} title={fixture.kickoff}>{formatInstant(fixture.kickoff, timeZone)}</time>
          </dd>
        </div>
        <div>
          <dt>Статус</dt>
          <dd>{statusLabel(fixture.status)}</dd>
        </div>
        <div className="facts-wide">
          <dt>Исторические доказательства</dt>
          <dd className="detail-links">
            <Link className="link-touch" href={evidenceHref(home.id)}>Доказательства {home.name} на момент начала</Link>
            <Link className="link-touch" href={evidenceHref(away.id)}>Доказательства {away.name} на момент начала</Link>
          </dd>
        </div>
      </dl>
    </header>
  );
}
