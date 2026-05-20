'use client';

import { useEffect, useState } from 'react';
import { Label } from '../ui/label';

type Freq = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
type MonthMode = 'day' | 'weekday';

const WEEK_DAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;
type WeekDay = (typeof WEEK_DAYS)[number];

const DAY_LABELS: Record<WeekDay, string> = {
  MO: 'Mon',
  TU: 'Tue',
  WE: 'Wed',
  TH: 'Thu',
  FR: 'Fri',
  SA: 'Sat',
  SU: 'Sun',
};

const SET_POS_OPTIONS = [
  { value: 1, label: 'First' },
  { value: 2, label: 'Second' },
  { value: 3, label: 'Third' },
  { value: 4, label: 'Fourth' },
  { value: -1, label: 'Last' },
] as const;

interface RRuleState {
  freq: Freq;
  interval: number;
  weekDays: WeekDay[];
  monthMode: MonthMode;
  monthDay: number;
  monthSetPos: number;
  monthWeekDay: WeekDay;
  hour: number;
  minute: number;
}

const DEFAULT_STATE: RRuleState = {
  freq: 'WEEKLY',
  interval: 1,
  weekDays: ['MO'],
  monthMode: 'day',
  monthDay: 1,
  monthSetPos: 1,
  monthWeekDay: 'MO',
  hour: 9,
  minute: 0,
};

function buildRRule(state: RRuleState): string {
  const parts: string[] = [`FREQ=${state.freq}`];
  if (state.interval > 1) {
    parts.push(`INTERVAL=${state.interval}`);
  }
  if (state.freq === 'WEEKLY') {
    const days = state.weekDays.length > 0 ? state.weekDays : ['MO'];
    parts.push(`BYDAY=${days.join(',')}`);
  }
  if (state.freq === 'MONTHLY') {
    if (state.monthMode === 'day') {
      parts.push(`BYMONTHDAY=${state.monthDay}`);
    } else {
      parts.push(`BYDAY=${state.monthWeekDay}`);
      parts.push(`BYSETPOS=${state.monthSetPos}`);
    }
  }
  parts.push(`BYHOUR=${state.hour}`);
  parts.push(`BYMINUTE=${state.minute}`);
  return parts.join(';');
}

function parseRRule(rrule: string): RRuleState {
  const state: RRuleState = { ...DEFAULT_STATE };
  if (!rrule || rrule.trim() === '') return state;

  // Strip optional "RRULE:" prefix
  const raw = rrule.replace(/^RRULE:/i, '');
  const map: Record<string, string> = {};
  for (const part of raw.split(';')) {
    const eqIdx = part.indexOf('=');
    if (eqIdx === -1) continue;
    const key = part.slice(0, eqIdx).toUpperCase();
    const val = part.slice(eqIdx + 1);
    map[key] = val;
  }

  if (map['FREQ'] === 'DAILY') state.freq = 'DAILY';
  else if (map['FREQ'] === 'WEEKLY') state.freq = 'WEEKLY';
  else if (map['FREQ'] === 'MONTHLY') state.freq = 'MONTHLY';
  else if (map['FREQ'] === 'YEARLY') state.freq = 'YEARLY';

  if (map['INTERVAL'] !== undefined) {
    const iv = Number.parseInt(map['INTERVAL'], 10);
    if (!Number.isNaN(iv) && iv > 0) state.interval = iv;
  }

  if (map['BYHOUR'] !== undefined) {
    const h = Number.parseInt(map['BYHOUR'], 10);
    if (!Number.isNaN(h)) state.hour = h;
  }

  if (map['BYMINUTE'] !== undefined) {
    const m = Number.parseInt(map['BYMINUTE'], 10);
    if (!Number.isNaN(m)) state.minute = m;
  }

  if (map['BYDAY'] !== undefined) {
    const days = map['BYDAY'].split(',');
    if (state.freq === 'WEEKLY') {
      state.weekDays = days.filter((d): d is WeekDay =>
        (WEEK_DAYS as readonly string[]).includes(d),
      );
    } else if (state.freq === 'MONTHLY') {
      const candidate = days[0] ?? 'MO';
      if ((WEEK_DAYS as readonly string[]).includes(candidate)) {
        state.monthMode = 'weekday';
        state.monthWeekDay = candidate as WeekDay;
      }
    }
  }

  if (map['BYMONTHDAY'] !== undefined) {
    const d = Number.parseInt(map['BYMONTHDAY'], 10);
    if (!Number.isNaN(d)) {
      state.monthMode = 'day';
      state.monthDay = d;
    }
  }

  if (map['BYSETPOS'] !== undefined) {
    const pos = Number.parseInt(map['BYSETPOS'], 10);
    if (!Number.isNaN(pos)) {
      state.monthSetPos = pos;
    }
  }

  return state;
}

export interface RRuleBuilderProps {
  value: string;
  onChange: (rrule: string) => void;
}

const selectClass =
  'rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

export function RRuleBuilder({ value, onChange }: RRuleBuilderProps) {
  const [state, setState] = useState<RRuleState>(() => parseRRule(value));

  // Parse incoming value on mount (and when it changes externally)
  useEffect(() => {
    setState(parseRRule(value));
    // We intentionally only parse when the prop changes, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function update(patch: Partial<RRuleState>) {
    const next = { ...state, ...patch };
    setState(next);
    onChange(buildRRule(next));
  }

  function toggleWeekDay(day: WeekDay) {
    const current = state.weekDays;
    const already = current.includes(day);
    const next = already
      ? current.filter((d) => d !== day)
      : [...current, day];
    // Always keep at least one day selected
    const final = next.length === 0 ? [day] : next;
    update({ weekDays: final });
  }

  return (
    <div className="space-y-4">
      {/* Frequency row */}
      <div className="flex flex-wrap items-center gap-2">
        <Label className="shrink-0">Every</Label>
        <select
          className={selectClass}
          value={state.freq}
          onChange={(e) => update({ freq: e.target.value as Freq })}
        >
          <option value="DAILY">Day</option>
          <option value="WEEKLY">Week</option>
          <option value="MONTHLY">Month</option>
          <option value="YEARLY">Year</option>
        </select>
      </div>

      {/* Weekly: day toggles */}
      {state.freq === 'WEEKLY' && (
        <div className="flex flex-wrap gap-1">
          {WEEK_DAYS.map((day) => {
            const active = state.weekDays.includes(day);
            return (
              <button
                key={day}
                type="button"
                onClick={() => toggleWeekDay(day)}
                className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                  active
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-background text-foreground hover:bg-muted'
                }`}
              >
                {DAY_LABELS[day]}
              </button>
            );
          })}
        </div>
      )}

      {/* Monthly options */}
      {state.freq === 'MONTHLY' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-sm">
              <input
                type="radio"
                name="monthMode"
                value="day"
                checked={state.monthMode === 'day'}
                onChange={() => update({ monthMode: 'day' })}
                className="accent-primary"
              />
              On day
            </label>
            {state.monthMode === 'day' && (
              <select
                className={selectClass}
                value={state.monthDay}
                onChange={(e) => update({ monthDay: Number.parseInt(e.target.value, 10) })}
              >
                {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            )}
            {state.monthMode === 'day' && (
              <span className="text-sm text-muted-foreground">of the month</span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-sm">
              <input
                type="radio"
                name="monthMode"
                value="weekday"
                checked={state.monthMode === 'weekday'}
                onChange={() => update({ monthMode: 'weekday' })}
                className="accent-primary"
              />
              On the
            </label>
            {state.monthMode === 'weekday' && (
              <>
                <select
                  className={selectClass}
                  value={state.monthSetPos}
                  onChange={(e) => update({ monthSetPos: Number.parseInt(e.target.value, 10) })}
                >
                  {SET_POS_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <select
                  className={selectClass}
                  value={state.monthWeekDay}
                  onChange={(e) => update({ monthWeekDay: e.target.value as WeekDay })}
                >
                  {WEEK_DAYS.map((day) => (
                    <option key={day} value={day}>
                      {DAY_LABELS[day]}
                    </option>
                  ))}
                </select>
              </>
            )}
          </div>
        </div>
      )}

      {/* Time row */}
      <div className="flex flex-wrap items-center gap-2">
        <Label className="shrink-0">at</Label>
        <select
          className={selectClass}
          value={state.hour}
          onChange={(e) => update({ hour: Number.parseInt(e.target.value, 10) })}
        >
          {Array.from({ length: 24 }, (_, i) => i).map((h) => (
            <option key={h} value={h}>
              {String(h).padStart(2, '0')}
            </option>
          ))}
        </select>
        <span className="text-sm font-medium">:</span>
        <select
          className={selectClass}
          value={state.minute}
          onChange={(e) => update({ minute: Number.parseInt(e.target.value, 10) })}
        >
          <option value={0}>00</option>
          <option value={30}>30</option>
        </select>
      </div>
    </div>
  );
}
