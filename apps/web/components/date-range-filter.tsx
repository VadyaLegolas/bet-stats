"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

/** Instants from the URL → whole UTC day for the date inputs. The end bound is exclusive
 * in the API contract, so `to` walks back one millisecond before flooring to a day. */
const toDateInput = (value: string | undefined, end: boolean): string => {
  if (!value) return "";
  if (DATE_ONLY.test(value)) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  const instant = end ? parsed.getTime() - 1 : parsed.getTime();
  return new Date(instant).toISOString().slice(0, 10);
};

/** Picked day → API instants: `from` starts the day (inclusive), `to` ends it
 * (next-day start is the exclusive bound, so the picked end day stays whole). */
const startOfUtcDay = (day: string) => `${day}T00:00:00.000Z`;
const endOfUtcDay = (day: string) => new Date(new Date(`${day}T00:00:00.000Z`).getTime() + DAY_MS).toISOString();
const utcDay = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY_MS).toISOString().slice(0, 10);

type Preset = { label: string; range: () => { from: string; to: string } | null };

const PRESETS: readonly Preset[] = [
  { label: "Ближайшие 48 часов", range: () => null },
  { label: "Сегодня", range: () => ({ from: utcDay(0), to: utcDay(0) }) },
  { label: "Завтра", range: () => ({ from: utcDay(1), to: utcDay(1) }) },
  { label: "Ближайшие 3 дня", range: () => ({ from: utcDay(0), to: utcDay(2) }) },
  { label: "Ближайшая неделя", range: () => ({ from: utcDay(0), to: utcDay(6) }) },
];

export function DateRangeFilter({ from, to, competition }: { from?: string | undefined; to?: string | undefined; competition: string }) {
  const router = useRouter();
  const [dayFrom, setDayFrom] = useState(() => toDateInput(from, false));
  const [dayTo, setDayTo] = useState(() => toDateInput(to, true));

  const navigate = (next: { from?: string | undefined; to?: string | undefined }) => {
    const query = new URLSearchParams({ competition });
    if (next.from) query.set("from", next.from);
    if (next.to) query.set("to", next.to);
    router.push(`/fixtures?${query}`);
  };

  const applyPreset = (preset: Preset) => {
    const target = preset.range();
    setDayFrom(target?.from ?? "");
    setDayTo(target?.to ?? "");
    navigate(target ? { from: startOfUtcDay(target.from), to: endOfUtcDay(target.to) } : {});
  };

  const activePreset = (preset: Preset): boolean => {
    const target = preset.range();
    return target === null ? !dayFrom && !dayTo : target.from === dayFrom && target.to === dayTo;
  };

  const submit = () => {
    // A date picker speaks in whole days, so a reversed pair is repaired, not rejected.
    const [first, second] = dayFrom && dayTo && dayFrom > dayTo ? [dayTo, dayFrom] : [dayFrom, dayTo];
    navigate({ from: first ? startOfUtcDay(first) : undefined, to: second ? endOfUtcDay(second) : undefined });
  };

  const fieldLabel = { display: "flex", flexDirection: "column", gap: 6, fontSize: "0.875rem", color: "var(--color-text-secondary)" } as const;

  return (
    <form className="fixtures-filter-card" onSubmit={(event) => { event.preventDefault(); submit(); }}>
      <div className="filter-presets" role="group" aria-label="Быстрый выбор периода">
        {PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            className="filter-chip"
            aria-pressed={activePreset(preset)}
            onClick={() => applyPreset(preset)}
          >
            {preset.label}
          </button>
        ))}
      </div>
      <div className="filter-fields">
        <label style={fieldLabel}>
          <span>С (дата, UTC)</span>
          <input
            type="date"
            value={dayFrom}
            max={dayTo || undefined}
            onChange={(event) => setDayFrom(event.target.value)}
            style={{ minHeight: 44, width: 220, maxWidth: "100%" }}
          />
        </label>
        <label style={fieldLabel}>
          <span>По (дата, UTC, включительно)</span>
          <input
            type="date"
            value={dayTo}
            min={dayFrom || undefined}
            onChange={(event) => setDayTo(event.target.value)}
            style={{ minHeight: 44, width: 220, maxWidth: "100%" }}
          />
        </label>
        <label style={fieldLabel}>
          <span>Соревнование</span>
          <select defaultValue={competition} style={{ minHeight: 44, maxWidth: "100%" }}>
            <option>Premier League</option>
          </select>
        </label>
        <button type="submit" className="btn-primary" style={{ minHeight: 44, padding: "8px 20px" }}>
          Применить даты
        </button>
      </div>
      <p className="filter-hint">
        Даты выбираются календарём и трактуются по UTC: выбранный день «По» включается целиком.
        Пустые даты означают ближайшие 48 часов.
      </p>
    </form>
  );
}
