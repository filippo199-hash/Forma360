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
import { Button } from '../../../../src/components/ui/button';
import { Card, CardContent } from '../../../../src/components/ui/card';
import { Input } from '../../../../src/components/ui/input';
import { Label } from '../../../../src/components/ui/label';
import { Skeleton } from '../../../../src/components/ui/skeleton';
import { Textarea } from '../../../../src/components/ui/textarea';
import { trpc } from '../../../../src/lib/trpc/client';

export default function ScheduleEditPage() {
  const t = useTranslations('schedules');
  const tCommon = useTranslations('common');
  const params = useParams<{ locale: string; scheduleId: string }>();
  const router = useRouter();
  const locale = params.locale ?? 'en';
  const scheduleId = params.scheduleId ?? '';

  const { data, isLoading, refetch } = trpc.schedules.get.useQuery({ scheduleId });
  const updateMutation = trpc.schedules.update.useMutation();
  const pauseMutation = trpc.schedules.pause.useMutation();
  const resumeMutation = trpc.schedules.resume.useMutation();
  const deleteMutation = trpc.schedules.delete.useMutation();
  const materialiseMutation = trpc.schedules.materialiseNow.useMutation();

  const [name, setName] = useState('');
  const [timezone, setTimezone] = useState('UTC');
  const [rrule, setRrule] = useState('');
  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');
  const [reminderMinutes, setReminderMinutes] = useState('');
  const [assigneeUserIds, setAssigneeUserIds] = useState<string[]>([]);
  const [assigneeGroupIds, setAssigneeGroupIds] = useState<string[]>([]);
  const [siteIds, setSiteIds] = useState<string[]>([]);

  useEffect(() => {
    if (data === undefined) return;
    const s = data.schedule;
    setName(s.name);
    setTimezone(s.timezone);
    setRrule(s.rrule);
    setStartAt(new Date(s.startAt).toISOString().slice(0, 16));
    setEndAt(s.endAt === null ? '' : new Date(s.endAt).toISOString().slice(0, 16));
    setReminderMinutes(s.reminderMinutesBefore === null ? '' : String(s.reminderMinutesBefore));
    setAssigneeUserIds([...s.assigneeUserIds]);
    setAssigneeGroupIds([...s.assigneeGroupIds]);
    setSiteIds([...s.siteIds]);
  }, [data]);

  const noAssignees =
    assigneeUserIds.length === 0 && assigneeGroupIds.length === 0 && siteIds.length === 0;

  async function onSave(): Promise<void> {
    try {
      await updateMutation.mutateAsync({
        scheduleId,
        name,
        timezone,
        rrule,
        startAt: new Date(startAt).toISOString(),
        endAt: endAt === '' ? null : new Date(endAt).toISOString(),
        assigneeUserIds,
        assigneeGroupIds,
        siteIds,
        reminderMinutesBefore: reminderMinutes === '' ? null : Number.parseInt(reminderMinutes, 10),
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
        <CardContent className="space-y-4 py-6">
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
          <div className="space-y-2">
            <Label htmlFor="reminder">{t('form.reminder')}</Label>
            <Input
              id="reminder"
              type="number"
              value={reminderMinutes}
              onChange={(e) => setReminderMinutes(e.target.value)}
            />
          </div>
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

      <Card>
        <CardContent className="py-6">
          <h2 className="mb-3 text-sm font-semibold">{t('form.previewHeading')}</h2>
          {data.upcomingPreview.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('form.previewEmpty')}</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {data.upcomingPreview.map((iso) => (
                <li key={iso} className="font-mono text-xs">
                  {new Date(iso).toLocaleString(locale)}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
