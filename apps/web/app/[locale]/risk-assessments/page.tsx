'use client';

/**
 * Risk assessments list (FreeHS module B1). Filterable by status/type,
 * shows worst residual band, review-due badge and acknowledgement
 * progress per assessment, plus a banner when the signed-in user has
 * assessments waiting for their acknowledgement.
 */
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { RiskBandChip } from '../../../src/components/risk-assessments/risk-band-chip';
import { Button } from '../../../src/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../src/components/ui/dialog';
import { Input } from '../../../src/components/ui/input';
import { Label } from '../../../src/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../src/components/ui/select';
import { Skeleton } from '../../../src/components/ui/skeleton';
import { Textarea } from '../../../src/components/ui/textarea';
import { useHasPermission } from '../../../src/lib/permissions-context';
import { trpc } from '../../../src/lib/trpc/client';

type StatusFilter = 'all' | 'draft' | 'active' | 'archived';
type TypeFilter = 'all' | 'standing' | 'dynamic';

export default function RiskAssessmentsPage() {
  const t = useTranslations('riskAssessments');
  const locale = useLocale();
  const router = useRouter();
  const canCreate = useHasPermission('riskAssessments.create');

  const [status, setStatus] = useState<StatusFilter>('all');
  const [type, setType] = useState<TypeFilter>('all');
  const [search, setSearch] = useState('');
  const [dueOnly, setDueOnly] = useState(false);
  // One round-trip: archived rows need their own fetch, everything else is
  // filtered client-side so filters + search feel instant.
  const list = trpc.riskAssessments.list.useQuery({
    status: status === 'archived' ? 'archived' : 'all',
    type: 'all',
  });
  const pending = trpc.riskAssessments.listMyPending.useQuery();

  const needle = search.trim().toLowerCase();
  const rows = (list.data ?? []).filter(
    (a) =>
      (status === 'all' || status === 'archived' || a.status === status) &&
      (type === 'all' || a.type === type) &&
      (!dueOnly || a.reviewDue) &&
      (needle.length === 0 ||
        a.title.toLowerCase().includes(needle) ||
        (a.referenceNumber ?? '').toLowerCase().includes(needle)),
  );
  const stats = {
    active: (list.data ?? []).filter((a) => a.status === 'active').length,
    drafts: (list.data ?? []).filter((a) => a.status === 'draft').length,
    reviewDue: (list.data ?? []).filter((a) => a.reviewDue).length,
    myPending: pending.data?.length ?? 0,
  };

  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [activity, setActivity] = useState('');
  const [newType, setNewType] = useState<'standing' | 'dynamic'>('standing');
  const [location, setLocation] = useState('');

  const create = trpc.riskAssessments.create.useMutation({
    onSuccess: (res) => {
      router.push(`/${locale}/risk-assessments/${res.assessmentId}`);
    },
  });

  return (
    <div className="mx-auto max-w-6xl space-y-4 px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        {canCreate ? (
          <Button type="button" onClick={() => setCreateOpen(true)}>
            {t('newButton')}
          </Button>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        {(
          [
            { key: 'active', value: stats.active, onClick: () => setStatus('active') },
            { key: 'drafts', value: stats.drafts, onClick: () => setStatus('draft') },
            { key: 'reviewDue', value: stats.reviewDue, onClick: () => setDueOnly((v) => !v) },
            { key: 'myPending', value: stats.myPending, onClick: undefined },
          ] as const
        ).map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={s.onClick}
            disabled={s.onClick === undefined}
            className={`rounded-md border px-3 py-1.5 text-left transition-colors ${
              s.key === 'reviewDue' && dueOnly ? 'border-primary bg-accent' : 'hover:bg-accent'
            } ${s.onClick === undefined ? 'cursor-default' : ''}`}
          >
            <span className="block text-lg font-semibold leading-tight">{s.value}</span>
            <span className="block text-xs text-muted-foreground">{t(`stats.${s.key}`)}</span>
          </button>
        ))}
      </div>

      {pending.data !== undefined && pending.data.length > 0 ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
          {t('distribution.pendingBanner', { count: pending.data.length })}{' '}
          {pending.data.map((p) => (
            <Link
              key={p.assessmentId}
              className="mr-2 font-medium underline underline-offset-2"
              href={`/${locale}/risk-assessments/${p.assessmentId}`}
            >
              {p.referenceNumber ?? p.title}
            </Link>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Input
          className="w-64"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('searchPlaceholder')}
        />
        <Select value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('filters.all')}</SelectItem>
            <SelectItem value="draft">{t('status.draft')}</SelectItem>
            <SelectItem value="active">{t('status.active')}</SelectItem>
            <SelectItem value="archived">{t('status.archived')}</SelectItem>
          </SelectContent>
        </Select>
        <Select value={type} onValueChange={(v) => setType(v as TypeFilter)}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('filters.all')}</SelectItem>
            <SelectItem value="standing">{t('type.standing')}</SelectItem>
            <SelectItem value="dynamic">{t('type.dynamic')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {list.isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : rows.length === 0 ? (
        <div className="space-y-3 rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          <p>{t('empty')}</p>
          {canCreate ? (
            <Button type="button" onClick={() => setCreateOpen(true)}>
              {t('newButton')}
            </Button>
          ) : null}
        </div>
      ) : (
        <ul className="divide-y rounded-md border">
          {rows.map((a) => (
            <li key={a.id}>
              <Link
                href={`/${locale}/risk-assessments/${a.id}`}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-3 transition-colors hover:bg-accent"
              >
                <span className="w-16 shrink-0 font-mono text-xs text-muted-foreground">
                  {a.referenceNumber}
                </span>
                <span className="min-w-40 flex-1 font-medium">{a.title}</span>
                <span className="rounded bg-muted px-1.5 py-0.5 text-xs">
                  {t(`type.${a.type}`)}
                </span>
                <span className="rounded bg-muted px-1.5 py-0.5 text-xs">
                  {t(`status.${a.status}`)}
                </span>
                {a.personSpecificFor !== null ? (
                  <span className="rounded bg-muted px-1.5 py-0.5 text-xs">
                    {t(`personSpecific.badge.${a.personSpecificFor}`)}
                  </span>
                ) : null}
                <span className="text-xs text-muted-foreground">
                  {t('columns.hazards')}: {a.hazardCount}
                </span>
                <RiskBandChip
                  score={a.maxResidualScore > 0 ? a.maxResidualScore : null}
                  matrix={a.matrix}
                />
                {a.reviewDue ? (
                  <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800 dark:bg-red-900/40 dark:text-red-300">
                    {t('reviewDue')}
                  </span>
                ) : null}
                {a.ackTotal > 0 ? (
                  <span className="text-xs text-muted-foreground">
                    {t('columns.acks')}: {a.ackDone}/{a.ackTotal}
                  </span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('create.title')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="ra-title">{t('create.titleLabel')}</Label>
              <Input
                id="ra-title"
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && title.trim().length > 0 && !create.isPending) {
                    e.preventDefault();
                    create.mutate({
                      title: title.trim(),
                      activity: activity.trim(),
                      type: newType,
                      ...(location.trim().length > 0 ? { locationText: location.trim() } : {}),
                    });
                  }
                }}
                placeholder={t('create.titlePlaceholder')}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ra-activity">{t('create.activityLabel')}</Label>
              <Textarea
                id="ra-activity"
                rows={2}
                value={activity}
                onChange={(e) => setActivity(e.target.value)}
                placeholder={t('create.activityPlaceholder')}
              />
            </div>
            <div className="space-y-1">
              <Label>{t('create.typeLabel')}</Label>
              <Select
                value={newType}
                onValueChange={(v) => setNewType(v as 'standing' | 'dynamic')}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="standing">{t('type.standing')}</SelectItem>
                  <SelectItem value="dynamic">{t('type.dynamic')}</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {newType === 'standing'
                  ? t('create.typeStandingHint')
                  : t('create.typeDynamicHint')}
              </p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="ra-location">{t('create.locationLabel')}</Label>
              <Input
                id="ra-location"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder={t('create.locationPlaceholder')}
              />
            </div>
            {create.isError ? <p className="text-sm text-red-600">{t('create.error')}</p> : null}
          </div>
          <DialogFooter>
            <Button
              type="button"
              disabled={title.trim().length === 0 || create.isPending}
              onClick={() =>
                create.mutate({
                  title: title.trim(),
                  activity: activity.trim(),
                  type: newType,
                  ...(location.trim().length > 0 ? { locationText: location.trim() } : {}),
                })
              }
            >
              {create.isPending ? t('create.submitting') : t('create.submit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
