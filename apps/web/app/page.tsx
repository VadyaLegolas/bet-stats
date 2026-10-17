import Link from "next/link";

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

export default function HomePage() {
  return (
    <>
      <div className="hero-container">
        <div>
          <p className="hero-kicker">Прогнозы на основе доказательств</p>

          <h1 id="home-heading" className="hero-title">
            Достоверные данные о футбольных матчах
          </h1>

          <p className="hero-subtitle">
            Прозрачные вероятностные оценки на основе доказательств для топ-лиг Европы.
            Изучайте историческую форму, сравнивайте прогнозы Пуассон–Эло и измеряйте реальное предсказательное качество.
          </p>

          <div className="hero-actions">
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

        <aside className="hero-ledger" aria-label="Содержание">
          <h2>В этом выпуске</h2>
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

      <section className="principle-grid" aria-label="Как устроен продукт">
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
