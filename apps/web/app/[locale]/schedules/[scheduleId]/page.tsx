'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  GroupPicker,
  SitePicker,
  UserPicker,
} from '../../../../src/components/templates/audience-pickers';
import { RRuleBuilder } from '../../../../src/components/schedules/rrule-builder';
import { Button } from '../../../../src/components/ui/button';
import { Card, CardContent } from '../../../../src/components/ui/card';
import { Input } from '../../../../src/components/ui/input';
import { Label } from '../../../../src/components/ui/label';
import { Skeleton } from '../../../../src/components/ui/skeleton';
import { Switch } from '../../../../src/components/ui/switch';
import { formatInTimeZone } from '@forma360/shared/timezone';
import { trpc } from '../../../../src/lib/trpc/client';

// ─── Timezone helpers ────────────────────────────────────────────────────────

function getTimezones(): string[] {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return ((Intl as any).supportedValuesOf('timeZone') as string[]).sort();
  } catch {
    return [
      'UTC',
      'Europe/Rome',
      'Europe/London',
      'Europe/Paris',
      'Europe/Berlin',
      'America/New_York',
      'America/Chicago',
      'America/Denver',
      'America/Los_Angeles',
      'Asia/Tokyo',
      'Asia/Shanghai',
      'Asia/Kolkata',
      'Australia/Sydney',
    ];
  }
}

const TIMEZONES = getTimezones();

// ─── Summary builder ─────────────────────────────────────────────────────────

function buildSummary(opts: {
  rrule: string;
  timezone: string;
  reminderEnabled: boolean;
  allowLateSubmissions: boolean;
  scheduleName: string;
}): string {
  const raw = opts.rrule.replace(/^RRULE:/i, '');
  const map: Record<string, string> = {};
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    map[part.slice(0, idx).toUpperCase()] = part.slice(idx + 1);
  }

  const freq = map['FREQ'] ?? 'WEEKLY';
  const byday = map['BYDAY'] ?? '';
  const byhour = map['BYHOUR'] ?? '9';
  const byminute = map['BYMINUTE'] ?? '0';
  const bymonthday = map['BYMONTHDAY'];
  const bysetpos = map['BYSETPOS'];

  const hour = Number.parseInt(byhour, 10);
  const minute = Number.parseInt(byminute, 10);
  const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

  const DAY_FULL: Record<string, string> = {
    MO: 'Monday',
    TU: 'Tuesday',
    WE: 'Wednesday',
    TH: 'Thursday',
    FR: 'Friday',
    SA: 'Saturday',
    SU: 'Sunday',
  };

  const SET_POS_LABEL: Record<string, string> = {
    '1': 'first',
    '2': 'second',
    '3': 'third',
    '4': 'fourth',
    '-1': 'last',
  };

  let recurrenceDesc = '';
  if (freq === 'DAILY') {
    recurrenceDesc = 'every day';
  } else if (freq === 'WEEKLY' && byday !== '') {
    const days = byday
      .split(',')
      .map((d) => DAY_FULL[d] ?? d)
      .join(', ');
    recurrenceDesc = `every ${days}`;
  } else if (freq === 'MONTHLY') {
    if (bymonthday !== undefined) {
      recurrenceDesc = `every month on day ${bymonthday}`;
    } else if (bysetpos !== undefined && byday !== '') {
      const posLabel = SET_POS_LABEL[bysetpos] ?? bysetpos;
      const dayLabel = DAY_FULL[byday] ?? byday;
      recurrenceDesc = `every month on the ${posLabel} ${dayLabel}`;
    } else {
      recurrenceDesc = 'every month';
    }
  } else if (freq === 'YEARLY') {
    recurrenceDesc = 'every year';
  } else {
    recurrenceDesc = 'on a recurring schedule';
  }

  const namePart = opts.scheduleName !== '' ? `"${opts.scheduleName}"` : 'This schedule';

  let summary = `${namePart} runs ${recurrenceDesc} at ${timeStr} (${opts.timezone}).`;
  if (opts.reminderEnabled) {
    summary += ' Recipients will be reminded 1 hour before each occurrence.';
  }
  if (!opts.allowLateSubmissions) {
    summary += ' Late submissions are not allowed.';
  }
  return summary;
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function ScheduleEditPage() {
  const t = useTranslations('schedules');
  const tCommon = useTranslations('common');
  const params = useParams<{ locale: string; scheduleId: string }>();
  const router = useRouter();
  const locale = params.locale ?? 'en';
  const scheduleId = params.scheduleId ?? '';

  const { data, isLoading, refetch } = trpc.schedules.get.useQuery({ scheduleId });
  const occurrencesQuery = trpc.schedules.listOccurrences.useQuery({ scheduleId, limit: 20 });
  const updateMutation = trpc.schedules.update.useMutation();
  const pauseMutation = trpc.schedules.pause.useMutation();
  const resumeMutation = trpc.schedules.resume.useMutation();
  const deleteMutation = trpc.schedules.delete.useMutation();
  const materialiseMutation = trpc.schedules.materialiseNow.useMutation();

  const [name, setName] = useState('');
  const [timezone, setTimezone] = useState('UTC');
  const [rrule, setRrule] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reminderEnabled, setReminderEnabled] = useState(false);
  const [allowLateSubmissions, setAllowLateSubmissions] = useState(true);
  const [assigneeUserIds, setAssigneeUserIds] = useState<string[]>([]);
  const [assigneeGroupIds, setAssigneeGroupIds] = useState<string[]>([]);
  const [siteIds, setSiteIds] = useState<string[]>([]);

  useEffect(() => {
    if (data === undefined) return;
    const s = data.schedule;
    setName(s.name);
    setTimezone(s.timezone);
    setRrule(s.rrule);
    setStartDate(new Date(s.startAt).toISOString().slice(0, 10));
    setEndDate(s.endAt === null ? '' : new Date(s.endAt).toISOString().slice(0, 10));
    setReminderEnabled(s.reminderMinutesBefore !== null);
    setAllowLateSubmissions(s.allowLateSubmissions);
    setAssigneeUserIds([...s.assigneeUserIds]);
    setAssigneeGroupIds([...s.assigneeGroupIds]);
    setSiteIds([...s.siteIds]);
  }, [data]);

  const noAssignees =
    assigneeUserIds.length === 0 && assigneeGroupIds.length === 0 && siteIds.length === 0;

  const summary = buildSummary({
    rrule,
    timezone,
    reminderEnabled,
    allowLateSubmissions,
    scheduleName: name,
  });

  async function onSave(): Promise<void> {
    try {
      const startAt = new Date(`${startDate}T00:00:00.000Z`).toISOString();
      const endAt = endDate === '' ? null : new Date(`${endDate}T00:00:00.000Z`).toISOString();

      await updateMutation.mutateAsync({
        scheduleId,
        name,
        timezone,
        rrule,
        startAt,
        endAt,
        assigneeUserIds,
        assigneeGroupIds,
        siteIds,
        reminderMinutesBefore: reminderEnabled ? 60 : null,
        allowLateSubmissions,
      });
      toast.success(t('toast.updated'));
      await refetch();
    } catch {
      toast.error(t('toast.error'));
    }
  }

  if (isLoading || data === undefined) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const s = data.schedule;
  return (
    <div className="space-y-6 px-4 py-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link
            href={`/${locale}/schedules`}
            className="text-sm text-muted-foreground hover:underline"
          >
            {t('detail.backToList')}
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{s.name}</h1>
        </div>
        <div className="flex gap-2">
          {s.paused ? (
            <Button
              variant="outline"
              onClick={async () => {
                await resumeMutation.mutateAsync({ scheduleId });
                toast.success(t('toast.resumed'));
                await refetch();
              }}
            >
              {t('detail.resumeButton')}
            </Button>
          ) : (
            <Button
              variant="outline"
              onClick={async () => {
                await pauseMutation.mutateAsync({ scheduleId });
                toast.success(t('toast.paused'));
                await refetch();
              }}
            >
              {t('detail.pauseButton')}
            </Button>
          )}
          <Button
            variant="outline"
            onClick={async () => {
              await materialiseMutation.mutateAsync({ scheduleId });
              toast.success(t('toast.materialised'));
            }}
          >
            {t('detail.materialiseNow')}
          </Button>
          <Button
            variant="destructive"
            onClick={async () => {
              await deleteMutation.mutateAsync({ scheduleId });
              toast.success(t('toast.deleted'));
              router.push(`/${locale}/schedules`);
            }}
          >
            {t('detail.deleteButton')}
          </Button>
        </div>
      </header>

      <Card>
        <CardContent className="space-y-6 py-6">
          {/* Schedule name */}
          <div className="space-y-2">
            <Label htmlFor="name">{t('form.name')}</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          {/* Recurrence */}
          <div className="space-y-2">
            <Label>{t('form.recurrenceLabel')}</Label>
            <Card>
              <CardContent className="py-4">
                <RRuleBuilder value={rrule} onChange={setRrule} />
              </CardContent>
            </Card>
          </div>

          {/* Timezone */}
          <div className="space-y-2">
            <Label htmlFor="tz">{t('form.timezoneLabel')}</Label>
            <select
              id="tz"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
            >
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </div>

          {/* Start / End dates */}
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="startDate">{t('form.startDate')}</Label>
              <Input
                id="startDate"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="endDate">{t('form.endDate')}</Label>
              <Input
                id="endDate"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </div>

          {/* Assigned to */}
          <section className="space-y-4 rounded-md border border-border bg-muted/30 p-4">
            <div className="space-y-1">
              <h2 className="text-sm font-semibold">{t('form.assignedSectionHeading')}</h2>
              <p className="text-xs text-muted-foreground">{t('form.assignedHint')}</p>
            </div>
            <div className="space-y-4">
              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t('form.assignedUsersLabel')}
                </p>
                <UserPicker selected={assigneeUserIds} onChange={setAssigneeUserIds} />
              </div>
              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t('form.assignedGroupsLabel')}
                </p>
                <GroupPicker selected={assigneeGroupIds} onChange={setAssigneeGroupIds} />
              </div>
              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t('form.assignedSitesLabel')}
                </p>
                <SitePicker selected={siteIds} onChange={setSiteIds} />
              </div>
            </div>
            {noAssignees ? (
              <p className="text-xs text-destructive">{t('form.noAssigneesError')}</p>
            ) : null}
          </section>

          {/* Settings */}
          <section className="space-y-4">
            <h2 className="text-sm font-semibold">{t('form.settingsHeading')}</h2>
            <div className="flex items-center justify-between gap-4">
              <Label htmlFor="reminder-toggle" className="cursor-pointer">
                {t('form.reminderToggle')}
              </Label>
              <Switch
                id="reminder-toggle"
                checked={reminderEnabled}
                onCheckedChange={setReminderEnabled}
              />
            </div>
            <div className="flex items-center justify-between gap-4">
              <Label htmlFor="late-toggle" className="cursor-pointer">
                {t('form.allowLateToggle')}
              </Label>
              <Switch
                id="late-toggle"
                checked={allowLateSubmissions}
                onCheckedChange={setAllowLateSubmissions}
              />
            </div>
          </section>

          {/* Summary */}
          <section className="space-y-2">
            <h2 className="text-sm font-semibold">{t('form.summaryHeading')}</h2>
            <div className="rounded-md border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-foreground/90">
              {summary}
            </div>
          </section>

          {/* Footer actions */}
          <div className="flex justify-end gap-2">
            <Button variant="outline" asChild>
              <Link href={`/${locale}/schedules`}>{tCommon('cancel')}</Link>
            </Button>
            <Button onClick={onSave} disabled={updateMutation.isPending || noAssignees}>
              {t('form.save')}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Upcoming occurrences preview */}
      <Card>
        <CardContent className="py-6">
          <h2 className="mb-3 text-sm font-semibold">{t('form.previewHeading')}</h2>
          {data.upcomingPreview.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('form.previewEmpty')}</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {data.upcomingPreview.map((iso) => (
                <li key={iso} className="font-mono text-xs">
                  {formatInTimeZone(new Date(iso), data.schedule.timezone, locale)}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Past completed inspections */}
      <Card>
        <CardContent className="py-6">
          <h2 className="mb-3 text-sm font-semibold">{t('detail.pastHeading')}</h2>
          {occurrencesQuery.isLoading ? (
            <Skeleton className="h-20 w-full" />
          ) : occurrencesQuery.data === undefined || occurrencesQuery.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('detail.pastEmpty')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs font-medium text-muted-foreground">
                    <th className="pb-2 pr-4">{t('detail.pastOccurrence')}</th>
                    <th className="pb-2 pr-4">{t('detail.pastInspection')}</th>
                    <th className="pb-2">{t('detail.pastStatus')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {occurrencesQuery.data.map((row) => (
                    <tr key={row.id} className="py-2">
                      <td className="py-2 pr-4 font-mono text-xs">
                        {formatInTimeZone(
                          new Date(row.occurrenceAt),
                          data.schedule.timezone,
                          locale,
                        )}
                      </td>
                      <td className="py-2 pr-4">
                        {row.inspectionId !== null && row.inspectionTitle !== null ? (
                          <Link
                            href={`/${locale}/inspections/${row.inspectionId}`}
                            className="text-primary hover:underline"
                          >
                            {row.inspectionTitle}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="py-2">
                        <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900/30 dark:text-green-400">
                          {row.inspectionStatus ?? row.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
