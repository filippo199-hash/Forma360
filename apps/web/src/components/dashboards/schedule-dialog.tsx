'use client';

/**
 * Scheduled PDF delivery (ADR 0018). Recipients are free-text emails —
 * external allowed by decision — behind analytics.schedules.manage.
 * The simple builder covers daily / weekly / monthly at a chosen time;
 * the server validates the resulting RRULE.
 */
import { Pause, Play, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { trpc } from '../../lib/trpc/client';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';

type Frequency = 'daily' | 'weekly' | 'monthly';
const WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;

function buildRrule(input: {
  frequency: Frequency;
  weekday: (typeof WEEKDAYS)[number];
  monthday: number;
  time: string;
}): string {
  const [hourRaw, minuteRaw] = input.time.split(':');
  const hour = Number(hourRaw ?? '8');
  const minute = Number(minuteRaw ?? '0');
  const at = `BYHOUR=${hour};BYMINUTE=${minute}`;
  if (input.frequency === 'daily') return `FREQ=DAILY;${at}`;
  if (input.frequency === 'weekly') return `FREQ=WEEKLY;BYDAY=${input.weekday};${at}`;
  return `FREQ=MONTHLY;BYMONTHDAY=${input.monthday};${at}`;
}

export function ScheduleDialog({
  open,
  onOpenChange,
  dashboardId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dashboardId: string;
}) {
  const t = useTranslations('dashboards');
  const utils = trpc.useUtils();
  const list = trpc.dashboards.listSchedules.useQuery({ dashboardId }, { enabled: open });
  const create = trpc.dashboards.createSchedule.useMutation();
  const setPaused = trpc.dashboards.setSchedulePaused.useMutation();
  const remove = trpc.dashboards.deleteSchedule.useMutation();

  const [frequency, setFrequency] = useState<Frequency>('weekly');
  const [weekday, setWeekday] = useState<(typeof WEEKDAYS)[number]>('MO');
  const [monthday, setMonthday] = useState(1);
  const [time, setTime] = useState('08:00');
  const [recipientsRaw, setRecipientsRaw] = useState('');

  const timezone =
    Intl.DateTimeFormat().resolvedOptions().timeZone.length > 0
      ? Intl.DateTimeFormat().resolvedOptions().timeZone
      : 'UTC';

  const refresh = () => utils.dashboards.listSchedules.invalidate({ dashboardId });

  const submit = async () => {
    const recipients = [
      ...new Set(
        recipientsRaw
          .split(/[\s,;]+/)
          .map((r) => r.trim().toLowerCase())
          .filter((r) => r.length > 0),
      ),
    ];
    if (recipients.length === 0) {
      toast.error(t('scheduleDialog.noRecipients'));
      return;
    }
    try {
      await create.mutateAsync({
        dashboardId,
        rrule: buildRrule({ frequency, weekday, monthday, time }),
        timezone,
        startAt: new Date(),
        recipients,
      });
      setRecipientsRaw('');
      await refresh();
      toast.success(t('scheduleDialog.created'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('scheduleDialog.failed'));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('scheduleDialog.title')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {(list.data ?? []).length > 0 ? (
            <ul className="space-y-2">
              {(list.data ?? []).map((schedule) => (
                <li
                  key={schedule.id}
                  className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm"
                >
                  <div className="min-w-0">
                    <p className="truncate font-mono text-xs">{schedule.rrule}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {(schedule.recipients as string[]).join(', ')} · {schedule.timezone}
                      {schedule.paused ? ` · ${t('scheduleDialog.paused')}` : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      aria-label={
                        schedule.paused ? t('scheduleDialog.resume') : t('scheduleDialog.pause')
                      }
                      onClick={() =>
                        void setPaused
                          .mutateAsync({ id: schedule.id, paused: !schedule.paused })
                          .then(refresh)
                      }
                    >
                      {schedule.paused ? (
                        <Play className="h-4 w-4" />
                      ) : (
                        <Pause className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-destructive"
                      aria-label={t('scheduleDialog.delete')}
                      onClick={() => void remove.mutateAsync({ id: schedule.id }).then(refresh)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">{t('scheduleDialog.empty')}</p>
          )}

          <div className="rounded-md border p-3">
            <p className="mb-2 text-sm font-medium">{t('scheduleDialog.newTitle')}</p>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <select
                value={frequency}
                onChange={(e) => setFrequency(e.target.value as Frequency)}
                className="h-9 rounded-md border border-input bg-background px-2"
                aria-label={t('scheduleDialog.frequency')}
              >
                <option value="daily">{t('scheduleDialog.daily')}</option>
                <option value="weekly">{t('scheduleDialog.weekly')}</option>
                <option value="monthly">{t('scheduleDialog.monthly')}</option>
              </select>
              {frequency === 'weekly' ? (
                <select
                  value={weekday}
                  onChange={(e) => setWeekday(e.target.value as (typeof WEEKDAYS)[number])}
                  className="h-9 rounded-md border border-input bg-background px-2"
                  aria-label={t('scheduleDialog.weekday')}
                >
                  {WEEKDAYS.map((d) => (
                    <option key={d} value={d}>
                      {t(`scheduleDialog.weekdays.${d}`)}
                    </option>
                  ))}
                </select>
              ) : null}
              {frequency === 'monthly' ? (
                <select
                  value={monthday}
                  onChange={(e) => setMonthday(Number(e.target.value))}
                  className="h-9 rounded-md border border-input bg-background px-2"
                  aria-label={t('scheduleDialog.monthday')}
                >
                  {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              ) : null}
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-2"
                aria-label={t('scheduleDialog.time')}
              />
              <span className="text-xs text-muted-foreground">{timezone}</span>
            </div>
            <textarea
              value={recipientsRaw}
              onChange={(e) => setRecipientsRaw(e.target.value)}
              placeholder={t('scheduleDialog.recipientsPlaceholder')}
              className="mt-2 min-h-16 w-full rounded-md border border-input bg-background p-2 text-sm"
              aria-label={t('scheduleDialog.recipients')}
            />
            <p className="mt-1 text-xs text-muted-foreground">{t('scheduleDialog.externalNote')}</p>
            <Button
              size="sm"
              className="mt-2"
              onClick={() => void submit()}
              disabled={create.isPending}
            >
              {t('scheduleDialog.add')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
