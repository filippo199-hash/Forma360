'use client';

import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Button } from '../../../src/components/ui/button';
import { Card, CardContent } from '../../../src/components/ui/card';
import { Skeleton } from '../../../src/components/ui/skeleton';
import { useHasPermission } from '../../../src/lib/permissions-context';
import { trpc } from '../../../src/lib/trpc/client';

type StatusFilter = 'all' | 'open' | 'in_progress' | 'completed' | 'cancelled';
type SourceFilter = 'all' | 'standalone' | 'inspection' | 'issue';

const STATUSES: ReadonlyArray<StatusFilter> = [
  'all',
  'open',
  'in_progress',
  'completed',
  'cancelled',
];
const SOURCES: ReadonlyArray<SourceFilter> = ['all', 'standalone', 'inspection', 'issue'];

/**
 * Actions list page (Phase 4 build).
 *
 * SafetyCulture parity: status + source + assignee + site filters plus
 * a "hide closed" toggle. Standalone actions ride on the same list as
 * actions raised from inspection questions and observations — the
 * `Source` column tells them apart.
 *
 * The route segment is `/actions`; the create flow lives at
 * `/actions/new` and the detail at `/actions/[actionId]`.
 */
export default function ActionsListPage() {
  const t = useTranslations('actions.list');
  const tStatus = useTranslations('actions.status');
  const tPriority = useTranslations('actions.priority');
  const tCommon = useTranslations('common');
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';
  const canCreate = useHasPermission('actions.create');

  const [status, setStatus] = useState<StatusFilter>('all');
  const [source, setSource] = useState<SourceFilter>('all');
  const [hideClosed, setHideClosed] = useState(true);
  const [includeArchived, setIncludeArchived] = useState(false);

  const listInput: {
    status?: Exclude<StatusFilter, 'all'>;
    sourceType?: Exclude<SourceFilter, 'all'>;
    includeArchived: boolean;
    hideClosed: boolean;
  } = { includeArchived, hideClosed };
  if (status !== 'all') listInput.status = status;
  if (source !== 'all') listInput.sourceType = source;

  const { data: rows, isLoading } = trpc.actions.list.useQuery(listInput);
  const list = rows ?? [];

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          {canCreate ? (
            <Button asChild>
              <Link href={`/${locale}/actions/new`}>
                <Plus className="mr-1 h-4 w-4" />
                {t('newButton')}
              </Link>
            </Button>
          ) : null}
        </div>
      </header>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1 text-sm">
          <label htmlFor="filter-status" className="text-xs font-medium text-muted-foreground">
            {t('filterStatus')}
          </label>
          <select
            id="filter-status"
            value={status}
            onChange={(e) => setStatus(e.target.value as StatusFilter)}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s === 'all' ? t('filterStatusAll') : tStatus(s)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1 text-sm">
          <label htmlFor="filter-source" className="text-xs font-medium text-muted-foreground">
            {t('filterSource')}
          </label>
          <select
            id="filter-source"
            value={source}
            onChange={(e) => setSource(e.target.value as SourceFilter)}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            {SOURCES.map((s) => (
              <option key={s} value={s}>
                {s === 'all'
                  ? t('filterSourceAll')
                  : s === 'standalone'
                  ? t('filterSourceStandalone')
                  : s === 'inspection'
                  ? t('filterSourceInspection')
                  : t('filterSourceIssue')}
              </option>
            ))}
          </select>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={hideClosed}
            onChange={(e) => setHideClosed(e.target.checked)}
            className="h-4 w-4"
          />
          <span>{t('hideClosed')}</span>
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(e) => setIncludeArchived(e.target.checked)}
            className="h-4 w-4"
          />
          <span>{t('showArchived')}</span>
        </label>
      </div>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40">
              <tr className="text-left">
                <th className="px-3 py-2 font-medium">{t('columns.reference')}</th>
                <th className="px-3 py-2 font-medium">{t('columns.title')}</th>
                <th className="px-3 py-2 font-medium">{t('columns.status')}</th>
                <th className="px-3 py-2 font-medium">{t('columns.priority')}</th>
                <th className="px-3 py-2 font-medium">{t('columns.assignee')}</th>
                <th className="px-3 py-2 font-medium">{t('columns.due')}</th>
                <th className="px-3 py-2 font-medium">{t('columns.source')}</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="p-4">
                    <Skeleton className="h-4 w-full" />
                  </td>
                </tr>
              ) : list.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-muted-foreground">
                    <p>{t('empty')}</p>
                    {canCreate ? (
                      <Link
                        href={`/${locale}/actions/new`}
                        className="mt-2 inline-block text-foreground underline-offset-4 hover:underline"
                      >
                        {t('emptyCta')}
                      </Link>
                    ) : null}
                  </td>
                </tr>
              ) : (
                list.map((row) => {
                  const overdue =
                    row.dueAt !== null &&
                    row.status !== 'completed' &&
                    row.status !== 'cancelled' &&
                    new Date(row.dueAt).getTime() < Date.now();
                  return (
                    <tr key={row.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                        <Link href={`/${locale}/actions/${row.id}`}>
                          {row.referenceNumber ?? row.id.slice(-6)}
                        </Link>
                      </td>
                      <td className="px-3 py-2 font-medium">
                        <Link href={`/${locale}/actions/${row.id}`} className="hover:underline">
                          {row.title}
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {tStatus(row.status)}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {row.priority !== null &&
                        (row.priority === 'low' ||
                          row.priority === 'medium' ||
                          row.priority === 'high' ||
                          row.priority === 'critical')
                          ? tPriority(row.priority)
                          : t('noPriority')}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {row.assigneeName ?? t('noAssignee')}
                      </td>
                      <td
                        className={
                          overdue
                            ? 'px-3 py-2 font-medium text-destructive'
                            : 'px-3 py-2 text-muted-foreground'
                        }
                      >
                        {row.dueAt !== null
                          ? new Date(row.dueAt).toLocaleDateString()
                          : t('noDueDate')}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {row.sourceType === 'inspection'
                          ? t('sourceInspection')
                          : row.sourceType === 'issue'
                          ? t('sourceIssue')
                          : t('sourceStandalone')}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
      {/* tCommon kept for parity with peer list pages — used by surrounding chrome. */}
      <span className="sr-only">{tCommon('search')}</span>
    </div>
  );
}
