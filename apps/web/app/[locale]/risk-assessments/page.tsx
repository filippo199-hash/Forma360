'use client';

/**
 * Risk assessments list (FreeHS module B1). Status tabs (matching the
 * Observations page pattern), dashboard stat chips, instant client-side
 * search + filters, and a pending-acknowledgements banner. "New
 * assessment" creates an untitled draft and lands straight on the editor
 * — no dialog; the editor guards the title at publish time.
 */
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { RiskBandChip } from '../../../src/components/risk-assessments/risk-band-chip';
import { Button } from '../../../src/components/ui/button';
import { Input } from '../../../src/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../src/components/ui/select';
import { Skeleton } from '../../../src/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '../../../src/components/ui/tabs';
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
  // filtered client-side so tabs + search feel instant.
  const list = trpc.riskAssessments.list.useQuery({
    status: status === 'archived' ? 'archived' : 'all',
    type: 'all',
  });
  const pending = trpc.riskAssessments.listMyPending.useQuery();

  const create = trpc.riskAssessments.create.useMutation({
    onSuccess: (res) => {
      router.push(`/${locale}/risk-assessments/${res.assessmentId}`);
    },
    onError: () => toast.error(t('create.error')),
  });

  function handleCreate(): void {
    if (create.isPending) return;
    create.mutate({ title: t('untitled'), activity: '' });
  }

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

  const newButton = canCreate ? (
    <Button type="button" disabled={create.isPending} onClick={handleCreate}>
      {create.isPending ? t('create.submitting') : t('newButton')}
    </Button>
  ) : null;

  return (
    <div className="mx-auto max-w-6xl space-y-4 px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        {newButton}
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

      <Tabs value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
        <TabsList>
          <TabsTrigger value="all">{t('filters.all')}</TabsTrigger>
          <TabsTrigger value="active">{t('status.active')}</TabsTrigger>
          <TabsTrigger value="draft">{t('status.draft')}</TabsTrigger>
          <TabsTrigger value="archived">{t('status.archived')}</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="flex flex-wrap gap-2">
        <Input
          className="w-64"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('searchPlaceholder')}
        />
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
          {newButton}
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
    </div>
  );
}
