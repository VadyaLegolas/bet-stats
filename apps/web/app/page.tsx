import Link from "next/link";
import { ProbBar, PROB_OUTCOME_LABELS } from "../components/prob-bar";

const CONTENTS = [
  { label: "Матчи", href: "/fixtures", detail: "Предстоящие матчи, сгруппированные по местной дате, с честной отметкой состояния данных." },
  { label: "Анализ", href: "/fixtures#match-analysis", detail: "Замороженные прогнозы с доказательствами, допущениями и результатами проверок." },
  { label: "Результаты", href: "/scorecards", detail: "Ведомости, измеряющие калибровку после каждого завершённого матча." },
  { label: "Методология", href: "/methodology", detail: "Входы, исключения, уверенность, ограничения и политика оценки." },
  { label: "FAQ", href: "/faq", detail: "Пошаговая инструкция: как запустить сайт, прочитать прогноз, ввести коэффициенты и проверить результаты." },
] as const;

const PRINCIPLES = [
  { number: "01", title: "Каноническая идентичность", description: "Независимое разрешение сущностей и строго аудитируемое сопоставление истории у нескольких поставщиков спортивных данных." },
  { number: "02", title: "Модели Пуассона и Эло", description: "Строгие математические модели, считающие честные коэффициенты, тотал 2.5 и «обе забьют» без скрытых предубеждений «чёрного ящика»." },
  { number: "03", title: "Откалиброванные исходы", description: "Честные ведомости Brier Score и Log Loss, отслеживающие истинное качество предсказаний после каждого завершённого матча." },
] as const;

// ILLUSTRATIVE ONLY: every number, team and league below is fictional and exists
// to show the interface layout. None of it is a real forecast, real odds or
// real model-quality data; the markup labels it as an example everywhere.
const SAMPLE_FIXTURES = [
  { league: "Лига А", when: "Сб 19:30", home: "Команда А", away: "Команда Б", probs: [58, 22, 20], value: true },
  { league: "Лига Б", when: "Сб 21:00", home: "Команда В", away: "Команда Г", probs: [34, 28, 38], value: false },
  { league: "Лига В", when: "Вс 16:00", home: "Команда Д", away: "Команда Е", probs: [52, 26, 22], value: true },
  { league: "Лига Г", when: "Вс 18:30", home: "Команда Ж", away: "Команда З", probs: [49, 25, 26], value: false },
] as const;

const QUALITY_POINTS = [
  "Бэктесты без утечки данных из будущего",
  "Версия модели и конфигурации в каждом снимке",
  "Предупреждение, когда данных мало",
] as const;

// Illustrative calibration curve points (SVG viewBox coordinates), not model output.
const CALIBRATION_POINTS = [
  [70, 208],
  [120, 176],
  [170, 142],
  [220, 112],
  [270, 92],
  [320, 58],
  [365, 38],
] as const;

export default function HomePage() {
  const curve = CALIBRATION_POINTS.map(([x, y]) => `${x},${y}`).join(" ");
  return (
    <div className="home">
      <div className="home-inner home-hero">
        <div className="home-copy">
          <p className="home-badge">Прогнозы на основе доказательств</p>

          <h1 id="home-heading" className="home-title">
            Достоверные данные о футбольных матчах
          </h1>

          <p className="home-lead">
            Прозрачные вероятностные оценки на основе доказательств для топ-лиг Европы.
            Изучайте историческую форму, сравнивайте прогнозы Пуассон–Эло и измеряйте реальное предсказательное качество.
          </p>

          <div className="home-actions">
            <Link href="/fixtures" className="btn-primary">
              Предстоящие матчи
            </Link>
            <Link href="/methodology" className="btn-secondary">
              Как работают прогнозы
            </Link>
            <Link href="/scorecards" className="btn-secondary">
              Результаты прогнозов
            </Link>
          </div>
        </div>

        <aside className="sample-card" aria-label="Пример карточки матча">
          <div className="sample-card-head">
            <span className="sample-tag">Пример</span>
            <span className="sample-meta">Лига А · тур 14</span>
            <span className="sample-meta">Сб, 19:30</span>
          </div>
          <p className="sample-teams">
            <span>Команда А</span>
            <span className="sample-vs">vs</span>
            <span>Команда Б</span>
          </p>
          <ProbBar probs={[58, 22, 20]} />
          <dl className="prob-legend">
            <div>
              <dt>Победа хозяев</dt>
              <dd>58%</dd>
            </div>
            <div>
              <dt>Ничья</dt>
              <dd>22%</dd>
            </div>
            <div>
              <dt>Победа гостей</dt>
              <dd>20%</dd>
            </div>
          </dl>
          <div className="sample-odds">
            <span>Ваш коэффициент на победу хозяев: 1.95</span>
            <span className="ev-chip" aria-label="Ожидаемая ценность плюс 13 процентов, пример">EV +13%</span>
          </div>
          <p className="sample-caption">
            Пример расчёта на вымышленных данных. Оценка вероятности, а не гарантия исхода.
          </p>
        </aside>
      </div>

      <section className="home-inner home-section" aria-labelledby="home-fixtures-heading">
        <div className="home-section-head">
          <div>
            <h2 id="home-fixtures-heading">Так выглядит список матчей</h2>
            <p className="home-deck">
              Вероятности исходов и отметка, где введённый вами коэффициент выше справедливого.
            </p>
          </div>
          <div className="home-section-side">
            <span className="sample-tag">Пример</span>
            <Link href="/fixtures" className="btn-secondary">
              Все предстоящие матчи
            </Link>
          </div>
        </div>
        <ul className="sample-fixtures">
          {SAMPLE_FIXTURES.map((fixture) => (
            <li className="sample-row" key={`${fixture.home}-${fixture.away}`}>
              <div className="sample-row-when">
                <span>{fixture.league}</span>
                <span>{fixture.when}</span>
              </div>
              <p className="sample-row-teams">
                {fixture.home} — {fixture.away}
              </p>
              <div className="sample-row-probs">
                <ProbBar probs={fixture.probs} small />
                <p className="sample-row-numbers">
                  {fixture.probs.map((value, index) => (
                    <span key={PROB_OUTCOME_LABELS[index]}>
                      <span className="sr-only">{PROB_OUTCOME_LABELS[index]} </span>
                      {value}%
                    </span>
                  ))}
                </p>
              </div>
              <span className={fixture.value ? "pill-value" : "pill-novalue"}>
                {fixture.value ? "Есть value" : "Без value"}
              </span>
            </li>
          ))}
        </ul>
        <p className="sample-caption">
          Иллюстрация интерфейса: команды и вероятности вымышлены и не являются прогнозом. Настоящие матчи и прогнозы — в разделе «Матчи».
        </p>
      </section>

      <section className="home-band" aria-labelledby="home-quality-heading">
        <div className="home-inner">
          <div className="home-band-copy">
            <h2 id="home-quality-heading">Качество, которое можно проверить</h2>
            <p className="home-deck">
              Каждый прогноз сохраняется как неизменяемый снимок. После матча мы считаем Brier score, log loss и калибровку — а не только долю угаданных исходов.
            </p>
            <ul className="home-bullets">
              {QUALITY_POINTS.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
          </div>
          <div className="calib-card">
            <div className="calib-card-head">
              <h3>Схема калибровки</h3>
              <span className="sample-note">Пример, не данные модели</span>
            </div>
            <svg
              viewBox="0 0 400 260"
              width="100%"
              role="img"
              aria-label="Схематичный график калибровки: диагональ идеальной калибровки и пример кривой. Иллюстрация, а не данные модели."
            >
              <line className="calib-axis" x1="40" y1="20" x2="40" y2="220" />
              <line className="calib-axis" x1="40" y1="220" x2="380" y2="220" />
              <line className="calib-grid" x1="40" y1="120" x2="380" y2="120" />
              <line className="calib-grid" x1="210" y1="20" x2="210" y2="220" />
              <line className="calib-ideal" x1="40" y1="220" x2="380" y2="20" />
              <polyline className="calib-curve" fill="none" points={curve} />
              {CALIBRATION_POINTS.map(([x, y]) => (
                <circle className="calib-dot" key={`${x}-${y}`} cx={x} cy={y} r="5" />
              ))}
              <text className="calib-label" x="40" y="238" textAnchor="middle">0%</text>
              <text className="calib-label" x="210" y="238" textAnchor="middle">50%</text>
              <text className="calib-label" x="380" y="238" textAnchor="middle">100%</text>
              <text className="calib-label" x="32" y="224" textAnchor="end">0%</text>
              <text className="calib-label" x="32" y="124" textAnchor="end">50%</text>
              <text className="calib-label" x="32" y="24" textAnchor="end">100%</text>
            </svg>
            <ul className="calib-legend">
              <li><span className="calib-swatch calib-swatch--curve" aria-hidden="true" />Пример кривой</li>
              <li><span className="calib-swatch calib-swatch--ideal" aria-hidden="true" />Идеал</li>
            </ul>
            <Link href="/scorecards">Реальные ведомости калибровки</Link>
          </div>
        </div>
      </section>

      <section className="home-inner home-section" aria-labelledby="home-contents-heading">
        <h2 id="home-contents-heading">В этом выпуске</h2>
        <div className="home-card-grid">
          {CONTENTS.map((item) => (
            <article className="home-card" key={item.label}>
              <h3><Link href={item.href}>{item.label}</Link></h3>
              <p>{item.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="home-inner home-section home-section--last" aria-labelledby="home-principles-heading">
        <h2 id="home-principles-heading">Как устроен продукт</h2>
        <p className="home-deck">Три принципа, на которых построены прогнозы.</p>
        <div className="home-card-grid">
          {PRINCIPLES.map((principle) => (
            <article className="home-card" key={principle.number}>
              <span className="home-card-number" aria-hidden="true">{principle.number}</span>
              <h3>{principle.title}</h3>
              <p>{principle.description}</p>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
