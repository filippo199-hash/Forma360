'use client';

import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  ClipboardCheck,
  FolderOpen,
  ListChecks,
  MapPin,
  Users,
  Wrench,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import type { ReactNode } from 'react';
import { Card, CardContent } from '../../../../src/components/ui/card';
import { Skeleton } from '../../../../src/components/ui/skeleton';
import { cn } from '../../../../src/lib/cn';
import { trpc } from '../../../../src/lib/trpc/client';

type Status = 'planning' | 'active' | 'on_hold' | 'completed';

const STATUS_COLORS: Record<Status, string> = {
  planning: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-100',
  active: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-100',
  on_hold: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-100',
  completed: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-100',
};

export default function SiteDetailPage() {
  const t = useTranslations('sites');
  const params = useParams<{ locale: string; siteId: string }>();
  const locale = params.locale ?? 'en';
  const siteId = params.siteId ?? '';

  const { data, isLoading } = trpc.sites.getHub.useQuery(
    { id: siteId },
    { enabled: siteId !== '' },
  );

  if (isLoading || data === undefined) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const { site, counts } = data;
  const isProject = site.kind === 'project';
  const statusLabel: string | null =
    site.status === 'planning' ||
    site.status === 'active' ||
    site.status === 'on_hold' ||
    site.status === 'completed'
      ? t(`status_${site.status}` as 'status_active')
      : null;

  const tiles: Array<{
    key: string;
    label: string;
    value: number;
    icon: ReactNode;
    href: string | null;
  }> = [
    {
      key: 'observations',
      label: t('countObservations'),
      value: counts.observations,
      icon: <AlertTriangle className="h-5 w-5" />,
      href: `/${locale}/observations?site=${siteId}`,
    },
    {
      key: 'inspections',
      label: t('countInspections'),
      value: counts.inspections,
      icon: <ClipboardCheck className="h-5 w-5" />,
      href: `/${locale}/inspections?site=${siteId}`,
    },
    {
      key: 'actions',
      label: t('countActions'),
      value: counts.actions,
      icon: <ListChecks className="h-5 w-5" />,
      href: `/${locale}/actions?site=${siteId}`,
    },
    {
      key: 'assets',
      label: t('countAssets'),
      value: counts.assets,
      icon: <Wrench className="h-5 w-5" />,
      href: `/${locale}/assets?site=${siteId}`,
    },
    {
      key: 'documents',
      label: t('countDocuments'),
      value: counts.documents,
      icon: <FolderOpen className="h-5 w-5" />,
      href: `/${locale}/documents?site=${siteId}`,
    },
    {
      key: 'members',
      label: t('countMembers'),
      value: counts.members,
      icon: <Users className="h-5 w-5" />,
      href: null,
    },
  ];

  return (
    <div className="space-y-6">
      <Link
        href={`/${locale}/sites`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        {t('backToList')}
      </Link>

      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          {isProject ? (
            <MapPin className="h-6 w-6 text-primary" />
          ) : (
            <Building2 className="h-6 w-6 text-muted-foreground" />
          )}
          <h1 className="text-2xl font-semibold tracking-tight">{site.name}</h1>
          <span className="rounded-md border bg-background px-2 py-0.5 text-xs font-medium text-muted-foreground">
            {isProject ? t('kindProject') : t('kindSite')}
          </span>
          {statusLabel !== null ? (
            <span
              className={cn(
                'rounded-md px-2 py-0.5 text-xs font-medium',
                STATUS_COLORS[site.status as Status] ?? STATUS_COLORS.active,
              )}
            >
              {statusLabel}
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-muted-foreground">
          {site.client !== null && site.client !== '' ? (
            <span>
              {t('detailClient')}: {site.client}
            </span>
          ) : null}
          {isProject && (site.startDate !== null || site.endDate !== null) ? (
            <span>
              {t('detailTimeline')}: {site.startDate ?? '—'} → {site.endDate ?? '—'}
            </span>
          ) : null}
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {tiles.map((tile) => {
          const inner = (
            <Card
              className={cn(
                'h-full',
                tile.href !== null
                  ? 'transition-colors hover:border-primary/50 hover:bg-muted/30'
                  : '',
              )}
            >
              <CardContent className="space-y-2 p-4">
                <div className="text-muted-foreground">{tile.icon}</div>
                <div className="text-2xl font-semibold">{tile.value}</div>
                <div className="text-xs text-muted-foreground">{tile.label}</div>
              </CardContent>
            </Card>
          );
          return tile.href !== null ? (
            <Link key={tile.key} href={tile.href}>
              {inner}
            </Link>
          ) : (
            <div key={tile.key}>{inner}</div>
          );
        })}
      </div>
    </div>
  );
}
