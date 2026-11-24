import { MODEL_CARD } from "@bet-stats/domain";
import Link from "next/link";
import type { ReactNode } from "react";

import { RiskDisclosure } from "../../components/risk-disclosure";
import { formatInstant } from "../../components/time-format";


function TechnicalDetails({ id, children }: { id: string; children: ReactNode }) {
  return <details id={id} className="well"><summary>Технические подробности</summary>{children}</details>;
}

export default function MethodologyPage() {
  const card = MODEL_CARD;
  const timeZone = process.env.DISPLAY_TIME_ZONE ?? "UTC";
  const minimums = card.forecast.minimumSamples;
  return <article className="page-column">
    <h1>Как работают прогнозы</h1>
    <p className="page-deck">Мы оцениваем вероятности событий футбольных матчей на основе исторических темпов забиваемых голов и ограниченных доказательств силы команд, недавней формы, поля, отдыха и необязательных личных встреч. Результат — оценка вероятности с неизменяемой квитанцией доказательств, а не прогноз с гарантией.</p>
    <p className="page-deck">Ручные коэффициенты букмекеров можно сравнивать с точно выбранным замороженным прогнозом. Результат называется кандидатом value, только если пройдены все проверки: идентичность, время, качество данных, уверенность, край и ожидаемое value.</p>

    <dl aria-label="Метаданные текущей карточки модели" className="panel panel--stack facts-grid">
      <div><dt>Версия карточки модели</dt><dd><strong>{card.version}</strong></dd></div>
      <div><dt>Дата вступления в силу</dt><dd><time dateTime={card.effectiveDate} title={card.effectiveDate}>{formatInstant(card.effectiveDate, timeZone)}</time></dd></div>
      <div><dt>Текущая модель/конфиг</dt><dd>{card.currentModel.modelVersion} / {card.currentModel.configVersion}</dd></div>
      <div><dt>Хеш текущего конфига</dt><dd><code>{card.currentModel.configHash}</code></dd></div>
      <div><dt>Доступная альтернативная модель</dt><dd>{card.alternatives.map((alternative) => `${alternative.modelVersion} / ${alternative.configVersion} (${alternative.role})`).join("; ")}</dd></div>
    </dl>
    <RiskDisclosure />

    <div className="card-grid card-grid--lg">
      <section id="inputs" className="panel">
        <h2>Входы</h2>
        <p>Модель использует ограниченные по времени темпы забиваемых голов команд, силу Эло, недавнюю форму, результаты на своём поле и отдых. Доказательства личных встреч необязательны и строго ограничены. Каждый источник должен быть набран не позднее отсечки прогноза.</p>
        <TechnicalDetails id="inputs-technical">
          <p>{card.forecast.scoreGrid}</p>
          <p><strong>Ожидаемые голы:</strong> {card.forecast.expectedGoals}</p>
          <p>Минимальные выборки: темпы голов {minimums.goalRates}; Эло {minimums.elo}; форма {minimums.form5}; поле {minimums.venue}; отдых {minimums.restDays}; личные встречи {minimums.h2h}.</p>
          <p><Link href="/fixtures#forecast-receipts">Подробности квитанции прогноза</Link> показывают точную отсечку, ID сборок доказательств и наблюдения по источникам.</p>
        </TechnicalDetails>
      </section>

      <section id="dixon-coles" className="panel">
        <h2>Поправка на низкие счета</h2>
        <p>Мы применяем поправку Диксона-Колза к четырём низким счетам (0-0, 1-0, 0-1, 1-1) поверх уже рассчитанных ожидаемых голов. Это гибридная интеграция: силы атаки и защиты не переоцениваются, домашний фактор учитывается один раз.</p>
        <TechnicalDetails id="dixon-coles-technical">
          <p><strong>Конвенция:</strong> <code>{card.forecast.dixonColes.convention}</code></p>
          <p><strong>Формулы:</strong> <code>{card.forecast.dixonColes.tau}</code></p>
          <p><strong>Границы ρ:</strong> <code>{card.forecast.dixonColes.rhoBounds}</code></p>
          <p><strong>Политика ρ:</strong> метод <code>{card.forecast.dixonColes.rhoPolicy.method}</code>; окно {card.forecast.dixonColes.rhoPolicy.windowDays} дней; минимум {card.forecast.dixonColes.rhoPolicy.minLeagueMatches} матчей лиги; объединённый минимум {card.forecast.dixonColes.rhoPolicy.minPooledMatches}; при недостатке истории — fallback <code>{card.forecast.dixonColes.rhoPolicy.fallback}</code>.</p>
          <p><strong>Эффекты:</strong></p>
          <ul>{card.forecast.dixonColes.effects.map((effect) => <li key={effect}>{effect}</li>)}</ul>
          <p><strong>Ограничения:</strong></p>
          <ul>{card.forecast.dixonColes.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul>
          <p>Рынок тотала 2.5 при фиксированных ожидаемых голах λh и λa нейтрален по построению.</p>
          <p>Версия V1 остаётся доступной для отката и сравнения. Сравнение выполняется оператором по воспроизводимой процедуре бэктестов на одинаковых окнах; публичного сравнения моделей пока нет. Точные идентификаторы формул и политик — в <Link href="/scorecards#formula-policy-receipts">квитанциях формул ведомостей результатов</Link>.</p>
        </TechnicalDetails>
      </section>

      <section id="what-is-excluded" className="panel">
        <h2>Что исключается</h2>
        <p>Модель не использует платные ленты букмекеров, функции отправки ставок, сигналы live/в игре, персонализированное распределение банка, неофициальную информацию о будущем и доказательства, набранные после отсечки прогноза.</p>
        <TechnicalDetails id="what-is-excluded-technical">
          <p>Защита от утечки требует, чтобы каждая метка времени источника доказательств и граница квитанции были на отсечке или раньше. Тесты со скользящим началом держат окна обучения до отсечек прогноза, а знание результата — на более позднее отдельное время оценки.</p>
          <p>Политика бэктестов: <code>{card.policies.backtest}</code>.</p>
        </TechnicalDetails>
      </section>

      <section id="confidence" className="panel">
        <h2>Уверенность</h2>
        <p>Уверенность описывает полноту и качество доказательств. Это не вероятность того, что решение о ставке выиграет. Отсутствующие, устаревшие или несогласованные доказательства заставляют систему воздерживаться, а не заполнять пробелы выдуманными значениями.</p>
        <TechnicalDetails id="confidence-technical">
          <p>Темпы голов требуют минимум 5 матчей; форма и поле требуют {minimums.form5} и {minimums.venue}. Проверка value требует уверенность ≥ {card.forecast.valueThresholds.minimumConfidence}, край ≥ {card.forecast.valueThresholds.minimumEdge} и ожидаемое value ≥ {card.forecast.valueThresholds.minimumExpectedValue}.</p>
          <p>Политика value: <code>{card.policies.value}</code>. Масса хвоста сетки выше {card.forecast.tailWarningThreshold} раскрывается явно.</p>
        </TechnicalDetails>
      </section>

      <section id="limitations" className="panel">
        <h2>Ограничения</h2>
        <p>Исходы футбола неопределённы. Малые выборки, устаревшие доказательства, травмы или составы, не отражённые до отсечки, сбои поставщиков, неверная спецификация модели и меняющееся поведение команд могут делать оценки менее надёжными. Положительное ожидаемое value остаётся оценкой, а не обещанием прибыли.</p>
        <TechnicalDetails id="limitations-technical">
          <p>Известные режимы отказов выходят в отказоустойчивое состояние: недостаточно доказательств, недоступные данные поставщика, несовпадение отсечки, неопределённая каноническая идентичность или ограниченные доказательства когорты. Отсутствующие значения никогда не считаются нулём.</p>
          <p>{card.forecast.valueFormulas.join("; ")}.</p>
        </TechnicalDetails>
      </section>

      <section id="evaluation" className="panel">
        <h2>Оценка</h2>
        <p>Завершённые матчи оцениваются против замороженных прематч-вероятностей. Корректные очки, корзины надёжности и точные знаменатели показывают качество вероятностей; плоские единицы и сравнение с закрывающей линией — вторичные описательные виды.</p>
        <TechnicalDetails id="evaluation-technical">
          <div role="region" aria-label="Формулы корректных очков" className="wrap-anywhere">
            <p><code>{card.evaluation.brier}</code></p>
            <p><code>{card.evaluation.logLoss}</code></p>
          </div>
          <p>Формула: <code>{card.policies.scoreFormula}</code> · <code>{card.policies.scoreFormulaHash}</code></p>
          <p>Расчёт: <code>{card.policies.settlement}</code>. Надёжность: <code>{card.policies.reliability}</code>. Здоровье когорты: <code>{card.policies.cohortHealth}</code>.</p>
          <p>Квалифицированные доказательства требуют минимум {card.evaluation.cohortMinimums.fixtures} матчей и {card.evaluation.cohortMinimums.populatedBucketEvents} событий в каждой заполненной корзине. Пустые корзины остаются видимыми как недостаточные.</p>
          <p><Link href="/scorecards#formula-policy-receipts">Квитанции формул и политик ведомостей результатов</Link> раскрывают точные идентификаторы когорты и формул.</p>
        </TechnicalDetails>
      </section>

      <section id="calibration" className="panel">
        <h2>Калибровка вероятностей</h2>
        <p>Калибровка — отдельный слой поверх сырого прогноза: по завершённым матчам подбирается поправка, которая сопоставляет сырым вероятностям калиброванные. Сырой прогноз остаётся основным и неизменным, а калиброванные вероятности показываются рядом с подписью версии калибратора и размером отложенной выборки. Расчёт value по-прежнему использует сырые вероятности.</p>
        <p>Пока исходов недостаточно, интерфейс прямо сообщает, сколько их нужно и сколько есть. Калибратор проверяется по более поздним данным и автоматически откатывается, если несколько оценок подряд оказываются хуже сырого прогноза.</p>
        <ul>{card.calibration.effects.map((effect) => <li key={effect}>{effect}</li>)}</ul>
        <p><strong>Ограничения:</strong></p>
        <ul>{card.calibration.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul>
        <TechnicalDetails id="calibration-technical">
          <p>Конфиг: <code>{card.calibration.configVersion}</code> · <code>{card.calibration.configHash}</code></p>
          <p>Рынки: {card.calibration.markets.join(", ")}. Виды прогнозов для подбора: {card.calibration.fit.kinds.join(", ")}; виды, для которых показывается калибровка: {card.calibration.fit.servedKinds.join(", ")}.</p>
          <p>Минимальные выборки: Platt {card.calibration.minimumSamples.platt}; изотоническая регрессия {card.calibration.minimumSamples.isotonic}; отложенная выборка {card.calibration.minimumSamples.holdout}. Доля отложенной выборки: {card.calibration.holdoutFraction}.</p>
          <p>Порог существенности (Brier): {card.calibration.materiality}. Откат: {card.calibration.rollback.consecutiveWorse} подряд оценок хуже сырого, каждая не меньше {card.calibration.rollback.minimumEvaluationSample} исходов. Отсечение вероятностей: {card.calibration.probabilityClipEpsilon}. Подбор: раз в {card.calibration.cadence.intervalHours} ч.</p>
        </TechnicalDetails>
      </section>

    </div>

    <section id="responsible-use" className="panel panel--stack panel--band">
      <h2>Ответственное использование</h2>
      <p>Используйте эти оценки только как прозрачные аналитические доказательства. Не рассматривайте их как инструкции, не ставьте больше, чем можете позволить себе потерять, и не делайте ставки там, где это незаконно или не соответствует вашему возрасту.</p>
      <TechnicalDetails id="responsible-use-technical">
        <p>Продукт никогда не отправляет ставки и не поддерживает персонализированное распределение банка. Финансовые доказательства используют <code>{card.policies.financial}</code> и определяют ROI/Yield как <code>{card.evaluation.financialRate}</code>. Сравнение с закрывающей линией использует <code>{card.policies.clv}</code>.</p>
      </TechnicalDetails>
    </section>

    <section id="change-history" className="panel panel--stack">
      <h2>История изменений</h2>
      {card.changeHistory.map((change) => <article key={change.version} className="history-entry">
        <h3>{change.version}</h3>
        <p><strong>Вступил в силу:</strong> <time dateTime={change.effectiveDate} title={change.effectiveDate}>{formatInstant(change.effectiveDate, timeZone)}</time></p>
        <p>{change.summary}</p>
        <p><strong>Затронутые политики/модели:</strong> {change.affected}</p>
        <p><strong>Миграция/интерпретация:</strong> {change.interpretation}</p>
      </article>)}
    </section>
  </article>;
}
