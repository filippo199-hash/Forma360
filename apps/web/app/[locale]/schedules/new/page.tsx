'use client';

import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
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
import { Switch } from '../../../../src/components/ui/switch';
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

const browserTz =
  typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC';

// ─── Summary builder ─────────────────────────────────────────────────────────

function buildSummary(opts: {
  rrule: string;
  timezone: string;
  reminderEnabled: boolean;
  allowLateSubmissions: boolean;
  templateName: string;
  groupNames: string[];
  userNames: string[];
}): string {
  // Parse recurrence description from the RRULE string
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
    recurrenceDesc = `every day`;
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

  const tplPart =
    opts.templateName !== '' ? `"${opts.templateName}"` : 'The selected template';

  const assigneeParts: string[] = [];
  if (opts.groupNames.length > 0) {
    assigneeParts.push(opts.groupNames.join(' and '));
  }
  if (opts.userNames.length > 0) {
    assigneeParts.push(opts.userNames.join(' and '));
  }
  const assigneeStr =
    assigneeParts.length > 0 ? assigneeParts.join(' and ') : 'all assigned recipients';

  let summary = `${tplPart} will be sent ${recurrenceDesc} at ${timeStr} (${opts.timezone}), assigned to ${assigneeStr}.`;
  if (opts.reminderEnabled) {
    summary += ' Recipients will be reminded 1 hour before each occurrence.';
  }
  if (!opts.allowLateSubmissions) {
    summary += ' Late submissions are not allowed.';
  }
  return summary;
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function NewSchedulePage() {
  const t = useTranslations('schedules');
  const tCommon = useTranslations('common');
  const params = useParams<{ locale: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const locale = params.locale ?? 'en';

  const { data: templates } = trpc.templates.list.useQuery({ status: 'published' });
  const [templateId, setTemplateId] = useState(searchParams.get('templateId') ?? '');
  const [name, setName] = useState('');
  const [timezone, setTimezone] = useState(browserTz);
  const [rrule, setRrule] = useState('FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0');
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState('');
  const [reminderEnabled, setReminderEnabled] = useState(false);
  const [allowLateSubmissions, setAllowLateSubmissions] = useState(true);
  const [assigneeUserIds, setAssigneeUserIds] = useState<string[]>([]);
  const [assigneeGroupIds, setAssigneeGroupIds] = useState<string[]>([]);
  const [siteIds, setSiteIds] = useState<string[]>([]);

  const createMutation = trpc.schedules.create.useMutation();

  const noAssignees =
    assigneeUserIds.length === 0 && assigneeGroupIds.length === 0 && siteIds.length === 0;

  const selectedTemplate = templates?.find((tpl) => tpl.id === templateId);

  const summary = buildSummary({
    rrule,
    timezone,
    reminderEnabled,
    allowLateSubmissions,
    templateName: selectedTemplate?.name ?? '',
    groupNames: [],
    userNames: [],
  });

  async function onSubmit(): Promise<void> {
    try {
      // Build ISO datetime strings from date-only inputs using UTC midnight
      const startAt = new Date(`${startDate}T00:00:00.000Z`).toISOString();
      const endAt =
        endDate === '' ? null : new Date(`${endDate}T00:00:00.000Z`).toISOString();

      const result = await createMutation.mutateAsync({
        templateId,
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
      toast.success(t('toast.created'));
      router.push(`/${locale}/schedules/${result.scheduleId}`);
    } catch {
      toast.error(t('toast.error'));
    }
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/40">
      <div className="mx-auto my-8 w-full max-w-2xl rounded-xl border bg-background shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-6 py-4">
          <h1 className="text-xl font-semibold tracking-tight">{t('create')}</h1>
          <Link
            href={`/${locale}/schedules`}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={tCommon('close')}
          >
            <X className="h-5 w-5" />
          </Link>
        </div>

        <div className="space-y-6 px-6 py-6">
          {/* 1. Template selector */}
          <div className="space-y-2">
            <Label htmlFor="tpl">{t('table.template')}</Label>
            <select
              id="tpl"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
            >
              <option value="">—</option>
              {templates?.map((tpl) => (
                <option key={tpl.id} value={tpl.id}>
                  {tpl.name}
                </option>
              ))}
            </select>
          </div>

          {/* 2. Schedule name */}
          <div className="space-y-2">
            <Label htmlFor="name">{t('form.name')}</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          {/* 3. Recurrence (RRuleBuilder) */}
          <div className="space-y-2">
            <Label>{t('form.recurrenceLabel')}</Label>
            <Card>
              <CardContent className="py-4">
                <RRuleBuilder value={rrule} onChange={setRrule} />
              </CardContent>
            </Card>
          </div>

          {/* 4. Timezone */}
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

          {/* 5. Start / End dates */}
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

          {/* 6. Assigned to */}
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

          {/* 7. Settings */}
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

          {/* 8. Summary */}
          <section className="space-y-2">
            <h2 className="text-sm font-semibold">{t('form.summaryHeading')}</h2>
            <div className="rounded-md border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-foreground/90">
              {summary}
            </div>
          </section>
        </div>

        {/* Footer — sticky */}
        <div className="flex justify-end gap-2 border-t px-6 py-4">
          <Button variant="outline" asChild>
            <Link href={`/${locale}/schedules`}>{tCommon('cancel')}</Link>
          </Button>
          <Button
            onClick={onSubmit}
            disabled={createMutation.isPending || templateId === '' || name === '' || noAssignees}
          >
            {t('form.save')}
          </Button>
        </div>
      </div>
    </div>
  );
}
