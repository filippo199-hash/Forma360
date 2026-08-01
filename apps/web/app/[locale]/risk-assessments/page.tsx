'use client';

/**
 * Risk assessments list (FreeHS module B1). Status tabs, instant
 * client-side search + filters (type, reviews due), an Inspections-style
 * table, and a pending-acknowledgements banner. "New assessment" creates
 * an untitled draft and lands straight on the editor — no dialog; the
 * editor guards the title at publish time.
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
  // 'all' | 'none' (no site) | a site id present in the data.
  const [siteFilter, setSiteFilter] = useState('all');
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

  // Site/project filter options come from the loaded rows themselves, so
  // every option is guaranteed to match at least one assessment.
  const siteNameById = new Map<string, string>();
  for (const a of list.data ?? []) {
    if (a.siteId !== null && a.siteName !== null) siteNameById.set(a.siteId, a.siteName);
  }
  const siteOptions = [...siteNameById.entries()].sort((x, y) => x[1].localeCompare(y[1]));
  const hasSiteless = (list.data ?? []).some((a) => a.siteId === null);

  const needle = search.trim().toLowerCase();
  const rows = (list.data ?? []).filter(
    (a) =>
      (status === 'all' || status === 'archived' || a.status === status) &&
      (type === 'all' || a.type === type) &&
      (siteFilter === 'all' ||
        (siteFilter === 'none' ? a.siteId === null : a.siteId === siteFilter)) &&
      (!dueOnly || a.reviewDue) &&
      (needle.length === 0 ||
        a.title.toLowerCase().includes(needle) ||
        (a.referenceNumber ?? '').toLowerCase().includes(needle) ||
        (a.siteName ?? '').toLowerCase().includes(needle)),
  );
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

      <div className="flex flex-wrap items-center gap-2">
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
        {siteOptions.length > 0 ? (
          <Select value={siteFilter} onValueChange={setSiteFilter}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('filters.allSites')}</SelectItem>
              {hasSiteless ? <SelectItem value="none">{t('filters.noSite')}</SelectItem> : null}
              {siteOptions.map(([id, name]) => (
                <SelectItem key={id} value={id}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant={dueOnly ? 'default' : 'outline'}
          onClick={() => setDueOnly((v) => !v)}
        >
          {t('filters.reviewDueOnly')}
        </Button>
        <span className="ml-auto text-sm text-muted-foreground">
          {t('resultsCount', { count: rows.length })}
        </span>
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
        <div className="rounded-md border">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left">
                <tr>
                  <th className="w-20 px-3 py-2 font-medium">{t('columns.reference')}</th>
                  <th className="px-3 py-2 font-medium">{t('columns.title')}</th>
                  <th className="w-36 px-3 py-2 font-medium">{t('columns.site')}</th>
                  <th className="w-28 px-3 py-2 font-medium">{t('columns.type')}</th>
                  <th className="w-24 px-3 py-2 font-medium">{t('columns.status')}</th>
                  <th className="w-20 px-3 py-2 font-medium">{t('columns.hazards')}</th>
                  <th className="w-32 px-3 py-2 font-medium">{t('columns.residualRisk')}</th>
                  <th className="w-32 px-3 py-2 font-medium">{t('columns.review')}</th>
                  <th className="w-36 px-3 py-2 font-medium">{t('columns.acks')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <tr
                    key={a.id}
                    className="cursor-pointer border-b last:border-0 hover:bg-muted/10"
                    onClick={() => router.push(`/${locale}/risk-assessments/${a.id}`)}
                  >
                    <td className="px-3 py-3 font-mono text-xs text-muted-foreground">
                      {a.referenceNumber}
                    </td>
                    <td className="px-3 py-3">
                      <Link
                        href={`/${locale}/risk-assessments/${a.id}`}
                        className="font-medium hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {a.title}
                      </Link>
                      {a.personSpecificFor !== null ? (
                        <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs">
                          {t(`personSpecific.badge.${a.personSpecificFor}`)}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-3 text-xs text-muted-foreground">{a.siteName ?? '—'}</td>
                    <td className="px-3 py-3 text-xs">{t(`type.${a.type}`)}</td>
                    <td className="px-3 py-3">
                      <span className="rounded bg-muted px-1.5 py-0.5 text-xs">
                        {t(`status.${a.status}`)}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-xs">{a.hazardCount}</td>
                    <td className="px-3 py-3">
                      <RiskBandChip
                        score={a.maxResidualScore > 0 ? a.maxResidualScore : null}
                        matrix={a.matrix}
                      />
                    </td>
                    <td className="px-3 py-3">
                      {a.reviewDue ? (
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800 dark:bg-red-900/40 dark:text-red-300">
                          {t('reviewDue')}
                        </span>
                      ) : a.nextReviewAt !== null ? (
                        <span className="text-xs text-muted-foreground">
                          {new Date(a.nextReviewAt).toLocaleDateString(locale)}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {t('noReviewScheduled')}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-xs text-muted-foreground">
                      {a.ackTotal > 0 ? `${a.ackDone}/${a.ackTotal}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
