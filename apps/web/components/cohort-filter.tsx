"use client";

import Form from "next/form";
import { useState } from "react";

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

/** Instant from the URL identity → whole UTC day for the picker. `to` walks back one
 * millisecond before flooring, because the API's end bound is exclusive and without that
 * step the inclusive last day of a cohort (say 2026-02-01T00:00:00.000Z) would round up to
 * 2026-02-02 and silently widen the cohort by a day. */
const toUtcDay = (instant: string, end: boolean): string => {
  if (DATE_ONLY.test(instant)) return instant;
  const parsed = new Date(instant);
  if (Number.isNaN(parsed.getTime())) return "";
  return new Date(end ? parsed.getTime() - 1 : parsed.getTime()).toISOString().slice(0, 10);
};

type CohortIdentity = { modelVersion: string; competitionId: string; market: string; from: string; to: string };

/** Exact-cohort filter. The URL identity keeps the precise instants the API demands, while
 * the form speaks in Russian and in whole UTC days — a date picker cannot hold an instant. */
export function CohortFilter({ identity }: { identity: CohortIdentity }) {
  const [dayFrom, setDayFrom] = useState(() => toUtcDay(identity.from, false));
  const [dayTo, setDayTo] = useState(() => toUtcDay(identity.to, true));

  /* `<Form>` with a string action is Next 16's GET form: client-side navigation on submit
   * (no full reload) with a native GET fallback when JS is off. The visible fields carry whole
   * UTC days and the server page converts them to the exact instants the API demands. An
   * emptied date field is simply absent from the query, so the server derives the missing
   * bound — never a rejected value. `noValidate` matters here: the date controls are filled
   * from the cohort identity, which can hold an off-form value, and a controlled date input
   * with an invalid value submits an empty string. Without it the browser would block the
   * request outright instead of letting the server derive. */
  return (
    <Form action="/scorecards" noValidate className="filter-grid">
      <label className="field field--filter">
        <span>Период с (по UTC)</span>
        <input type="date" name="from" value={dayFrom} max={dayTo || undefined} onChange={(event) => setDayFrom(event.target.value)} className="input-fill" />
      </label>
      <label className="field field--filter">
        <span>Период по (включительно, по UTC)</span>
        <input type="date" name="to" value={dayTo} min={dayFrom || undefined} onChange={(event) => setDayTo(event.target.value)} className="input-fill" />
      </label>
      <label className="field field--filter">
        <span>Версия модели</span>
        <input name="modelVersion" defaultValue={identity.modelVersion} className="input-fill" />
      </label>
      <label className="field field--filter">
        <span>Соревнование</span>
        <input name="competitionId" defaultValue={identity.competitionId} className="input-fill" />
      </label>
      <label className="field field--filter">
        <span>Рынок</span>
        <input name="market" defaultValue={identity.market} className="input-fill" />
      </label>
      <button type="submit" className="btn-primary btn-compact">
        Применить точную когорту
      </button>
      <p className="filter-hint filter-hint--full">
        Выберите период календарём — он считается по UTC, и выбранный день «По» включается целиком.
        Пустая дата означает период по умолчанию: последние 365 дней. Строки «Версия модели»,
        «Соревнование» и «Рынок» — точные идентификаторы когорты: оставьте их пустыми, чтобы не
        ограничивать выборку.
      </p>
    </Form>
  );
}
