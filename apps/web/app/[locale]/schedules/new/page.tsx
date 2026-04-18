'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../../../src/components/ui/button';
import { Card, CardContent } from '../../../../src/components/ui/card';
import { Input } from '../../../../src/components/ui/input';
import { Label } from '../../../../src/components/ui/label';
import { Textarea } from '../../../../src/components/ui/textarea';
import { trpc } from '../../../../src/lib/trpc/client';

export default function NewSchedulePage() {
  const t = useTranslations('schedules');
  const tCommon = useTranslations('common');
  const params = useParams<{ locale: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const locale = params.locale ?? 'en';

  const { data: templates } = trpc.templates.list.useQuery({});
  const [templateId, setTemplateId] = useState(searchParams.get('templateId') ?? '');
  const [name, setName] = useState('');
  const [timezone, setTimezone] = useState('UTC');
  const [rrule, setRrule] = useState('FREQ=WEEKLY;BYDAY=MO;BYHOUR=9');
  const [startAt, setStartAt] = useState(new Date().toISOString().slice(0, 16));
  const [endAt, setEndAt] = useState('');
  const [assigneeUserIds, setAssigneeUserIds] = useState('');
  const [reminderMinutes, setReminderMinutes] = useState('');

  const createMutation = trpc.schedules.create.useMutation();

  async function onSubmit(): Promise<void> {
    try {
      const result = await createMutation.mutateAsync({
        templateId,
        name,
        timezone,
        rrule,
        startAt: new Date(startAt).toISOString(),
        endAt: endAt === '' ? null : new Date(endAt).toISOString(),
        assigneeUserIds: assigneeUserIds
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        assigneeGroupIds: [],
        siteIds: [],
        reminderMinutesBefore: reminderMinutes === '' ? null : Number.parseInt(reminderMinutes, 10),
      });
      toast.success(t('toast.created'));
      router.push(`/${locale}/schedules/${result.scheduleId}`);
    } catch {
      toast.error(t('toast.error'));
    }
  }

  return (
    <div className="space-y-6 px-4 py-6">
      <header>
        <Link
          href={`/${locale}/schedules`}
          className="text-sm text-muted-foreground hover:underline"
        >
          {t('detail.backToList')}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{t('create')}</h1>
      </header>

      <Card>
        <CardContent className="space-y-4 py-6">
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
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="name">{t('form.name')}</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tz">{t('form.timezone')}</Label>
              <Input id="tz" value={timezone} onChange={(e) => setTimezone(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="rrule">{t('form.rrule')}</Label>
            <Textarea
              id="rrule"
              rows={2}
              value={rrule}
              onChange={(e) => setRrule(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">{t('form.rruleHelp')}</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="startAt">{t('form.startAt')}</Label>
              <Input
                id="startAt"
                type="datetime-local"
                value={startAt}
                onChange={(e) => setStartAt(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="endAt">{t('form.endAt')}</Label>
              <Input
                id="endAt"
                type="datetime-local"
                value={endAt}
                onChange={(e) => setEndAt(e.target.value)}
              />
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="users">{t('form.assigneesUsers')}</Label>
              <Input
                id="users"
                value={assigneeUserIds}
                onChange={(e) => setAssigneeUserIds(e.target.value)}
                placeholder={t('form.assigneesPlaceholder')}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="reminder">{t('form.reminder')}</Label>
              <Input
                id="reminder"
                type="number"
                value={reminderMinutes}
                onChange={(e) => setReminderMinutes(e.target.value)}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" asChild>
              <Link href={`/${locale}/schedules`}>{tCommon('cancel')}</Link>
            </Button>
            <Button
              onClick={onSubmit}
              disabled={createMutation.isPending || templateId === '' || name === ''}
            >
              {t('form.save')}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
