'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMemo } from 'react';
import { Card, CardContent } from '../../../../src/components/ui/card';
import { trpc } from '../../../../src/lib/trpc/client';

/**
 * Lightweight calendar view — the next 30 days as a flat day-grouped
 * table. Per PR 32 scope cliff, we deliberately avoid a full month-grid
 * component so no extra dependency is needed.
 */
export default function SchedulesCalendarPage() {
  const t = useTranslations('schedules.calendar');
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';

  const { data: occurrences } = trpc.schedules.listUpcoming.useQuery({ daysAhead: 30 });

  const grouped = useMemo(() => {
    const map = new Map<string, typeof occurrences>();
    if (occurrences === undefined) return map;
    for (const o of occurrences) {
      const day = new Date(o.occurrenceAt).toISOString().slice(0, 10);
      const list = map.get(day) ?? [];
      list.push(o);
      map.set(day, list);
    }
    return map;
  }, [occurrences]);

  const days = useMemo(() => {
    const out: string[] = [];
    const now = new Date();
    now.setUTCHours(0, 0, 0, 0);
    for (let i = 0; i < 30; i += 1) {
      const d = new Date(now);
      d.setUTCDate(now.getUTCDate() + i);
      out.push(d.toISOString().slice(0, 10));
    }
    return out;
  }, []);

  return (
    <div className="space-y-6 px-4 py-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      </header>

      <Card>
        <CardContent className="divide-y divide-border py-0">
          {days.map((day) => {
            const items = grouped.get(day) ?? [];
            if (items.length === 0) return null;
            return (
              <div key={day} className="flex items-start gap-4 py-3">
                <div className="w-24 shrink-0 font-mono text-xs text-muted-foreground">{day}</div>
                <ul className="flex-1 space-y-1 text-sm">
                  {items.map((o) => (
                    <li key={o.id}>
                      <Link
                        className="hover:underline"
                        href={`/${locale}/inspections?upcoming=${o.id}`}
                      >
                        {new Date(o.occurrenceAt).toLocaleTimeString(locale)} · {o.templateId}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
