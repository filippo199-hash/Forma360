'use client';

import { ArrowLeft, CalendarClock, ChevronLeft, ChevronRight, LogIn } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import {
  VISIT_STATUS_BADGE,
  VisitCreateDialog,
  VisitDetailDialog,
  type VisitStatus,
} from '../../../../src/components/contractors/contractor-visits';
import { Button } from '../../../../src/components/ui/button';
import { Card, CardContent } from '../../../../src/components/ui/card';
import { useHasPermission } from '../../../../src/lib/permissions-context';
import { trpc } from '../../../../src/lib/trpc/client';

/** Local YYYY-MM-DD for a Date (calendar grouping is done in local time). */
function localKey(d: Date): string {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function ContractorCalendarPage() {
  const t = useTranslations('contractors');
  const format = useFormatter();
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';
  const canManage = useHasPermission('contractors.manage');

  const [anchor, setAnchor] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [contractorId, setContractorId] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [walkInOpen, setWalkInOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [createDay, setCreateDay] = useState<string | undefined>(undefined);

  const viewYear = anchor.getFullYear();
  const viewMonth = anchor.getMonth();

  const cells = useMemo(() => {
    const firstOfMonth = new Date(viewYear, viewMonth, 1);
    const dow = firstOfMonth.getDay();
    const mondayOffset = (dow + 6) % 7;
    const start = new Date(firstOfMonth);
    start.setDate(firstOfMonth.getDate() - mondayOffset);
    const out: { key: string; day: number; inMonth: boolean; date: Date }[] = [];
    for (let i = 0; i < 42; i += 1) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      out.push({ key: localKey(d), day: d.getDate(), inMonth: d.getMonth() === viewMonth, date: d });
    }
    return out;
  }, [viewYear, viewMonth]);

  const rangeFrom = cells[0]?.date ?? anchor;
  const rangeTo = useMemo(() => {
    const last = cells[cells.length - 1]?.date ?? anchor;
    const d = new Date(last);
    d.setDate(d.getDate() + 1);
    return d;
  }, [cells, anchor]);

  const utils = trpc.useUtils();
  const contractorsQ = trpc.contractors.list.useQuery();
  const { data } = trpc.contractors.visits.list.useQuery({
    from: rangeFrom.toISOString(),
    to: rangeTo.toISOString(),
    ...(contractorId !== '' ? { contractorId } : {}),
  });

  const byDay = useMemo(() => {
    const map = new Map<string, NonNullable<typeof data>>();
    for (const v of data ?? []) {
      const key = localKey(new Date(v.scheduledStart));
      const list = map.get(key) ?? [];
      list.push(v);
      map.set(key, list);
    }
    return map;
  }, [data]);

  const weekdayLabels = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(locale, { weekday: 'short' });
    return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(Date.UTC(2024, 0, 1 + i))));
  }, [locale]);

  const monthLabel = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(
    anchor,
  );
  const todayKey = localKey(new Date());

  function refresh() {
    void utils.contractors.visits.list.invalidate();
  }

  return (
    <div className="space-y-6 px-4 py-6">
      <Link
        href={`/${locale}/contractors`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        {t('backToList')}
      </Link>

      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('visits.calendarTitle')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('visits.calendarSubtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAnchor(new Date(viewYear, viewMonth - 1, 1))}
            aria-label={t('visits.prevMonth')}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-[10rem] text-center text-sm font-medium">{monthLabel}</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAnchor(new Date(viewYear, viewMonth + 1, 1))}
            aria-label={t('visits.nextMonth')}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const now = new Date();
              setAnchor(new Date(now.getFullYear(), now.getMonth(), 1));
            }}
          >
            {t('visits.today')}
          </Button>
        </div>
      </header>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="w-56">
          <label className="mb-1 block text-xs font-medium text-muted-foreground">
            {t('visits.filterContractor')}
          </label>
          <select
            value={contractorId}
            onChange={(e) => setContractorId(e.target.value)}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">{t('visits.allContractors')}</option>
            {(contractorsQ.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        {canManage ? (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setWalkInOpen(true);
              }}
            >
              <LogIn className="mr-1 h-4 w-4" />
              {t('visits.logWalkIn')}
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setCreateDay(undefined);
                setCreateOpen(true);
              }}
            >
              <CalendarClock className="mr-1 h-4 w-4" />
              {t('visits.newVisit')}
            </Button>
          </div>
        ) : null}
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="grid grid-cols-7 border-b text-center text-xs font-medium text-muted-foreground">
            {weekdayLabels.map((w) => (
              <div key={w} className="py-2">
                {w}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {cells.map((cell) => {
              const items = byDay.get(cell.key) ?? [];
              const isToday = cell.key === todayKey;
              return (
                <div
                  key={cell.key}
                  className={`min-h-[104px] border-b border-r p-1.5 text-left align-top ${
                    cell.inMonth ? '' : 'bg-muted/30 text-muted-foreground'
                  }`}
                >
                  <div className="mb-1 flex items-center justify-between">
                    <span
                      className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs ${
                        isToday ? 'bg-primary font-semibold text-primary-foreground' : ''
                      }`}
                    >
                      {cell.day}
                    </span>
                    {canManage && cell.inMonth ? (
                      <button
                        type="button"
                        aria-label={t('visits.newVisit')}
                        className="text-muted-foreground opacity-0 transition hover:text-foreground focus:opacity-100 group-hover:opacity-100"
                        onClick={() => {
                          setCreateDay(cell.key);
                          setCreateOpen(true);
                        }}
                      >
                        +
                      </button>
                    ) : null}
                  </div>
                  <ul className="space-y-1">
                    {items.slice(0, 3).map((v) => (
                      <li key={v.id}>
                        <button
                          type="button"
                          onClick={() => setDetailId(v.id)}
                          title={`${v.contractorName} · ${v.title}`}
                          className={`block w-full truncate rounded px-1 py-0.5 text-left text-[11px] leading-tight ${
                            VISIT_STATUS_BADGE[v.status as VisitStatus] ??
                            'bg-muted text-muted-foreground'
                          }`}
                        >
                          {format.dateTime(new Date(v.scheduledStart), { timeStyle: 'short' })}{' '}
                          {v.contractorName}
                        </button>
                      </li>
                    ))}
                    {items.length > 3 ? (
                      <li className="px-1 text-[11px] text-muted-foreground">
                        {t('visits.more', { count: items.length - 3 })}
                      </li>
                    ) : null}
                  </ul>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <VisitCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        {...(createDay !== undefined ? { defaultDay: createDay } : {})}
        onDone={refresh}
      />
      <VisitCreateDialog
        open={walkInOpen}
        onOpenChange={setWalkInOpen}
        walkIn
        onDone={refresh}
      />
      <VisitDetailDialog
        visitId={detailId}
        onOpenChange={(o) => !o && setDetailId(null)}
        canManage={canManage}
        onChanged={refresh}
      />
    </div>
  );
}
