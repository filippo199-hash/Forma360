'use client';

import { Building2, ChevronRight, MapPin } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { SiteHeaderActions } from '../../../../src/components/sites/site-header-actions';
import { SiteLocationCard } from '../../../../src/components/sites/site-location-card';
import { SiteMediaGallery } from '../../../../src/components/sites/site-media-gallery';
import { SiteOverview } from '../../../../src/components/sites/site-overview';
import { SitePlansViewer } from '../../../../src/components/sites/site-plans-viewer';
import { SiteTeamAccess } from '../../../../src/components/sites/site-team-access';
import { Skeleton } from '../../../../src/components/ui/skeleton';
import { cn } from '../../../../src/lib/cn';
import { hubTitleKey, usePlaceTerms } from '../../../../src/lib/terminology';
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
  const tCommon = useTranslations('common');
  const format = useFormatter();
  const { term } = usePlaceTerms();
  const params = useParams<{ locale: string; siteId: string }>();
  const locale = params.locale ?? 'en';
  const siteId = params.siteId ?? '';

  const { data, isLoading, error } = trpc.sites.getHub.useQuery(
    { id: siteId },
    { enabled: siteId !== '' },
  );
  const searchParams = useSearchParams();
  const initialTab = searchParams.get('tab');
  const [tab, setTab] = useState(
    initialTab === 'media' || initialTab === 'plans' || initialTab === 'team'
      ? initialTab
      : 'overview',
  );

  if (isLoading || data === undefined) {
    // Error check inside the loading gate: on error `data` is undefined, so a
    // bare skeleton would hang forever. Render not-found / error instead.
    if (error !== null && error !== undefined) {
      return (
        <p role="alert" className="text-sm text-destructive">
          {error.data?.code === 'NOT_FOUND' ? tCommon('notFound') : tCommon('error')}
        </p>
      );
    }
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const { site, parent, counts } = data;
  const isProject = site.kind === 'project';
  const statusLabel: string | null =
    site.status === 'planning' ||
    site.status === 'active' ||
    site.status === 'on_hold' ||
    site.status === 'completed'
      ? t(`status_${site.status}` as 'status_active')
      : null;

  return (
    <div className="space-y-6">
      {/* Breadcrumb: Hub › Parent › This — makes hierarchy visible on child
          sites (previously the parent link only existed at creation time). */}
      <nav className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
        <Link href={`/${locale}/sites`} className="hover:text-foreground">
          {t(hubTitleKey(term))}
        </Link>
        {parent !== null ? (
          <>
            <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <Link href={`/${locale}/sites/${parent.id}`} className="hover:text-foreground">
              {parent.name}
            </Link>
          </>
        ) : null}
        <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="text-foreground">{site.name}</span>
      </nav>

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
          <SiteHeaderActions
            site={{
              id: site.id,
              name: site.name,
              kind: site.kind,
              status: site.status,
              client: site.client,
              startDate: site.startDate,
              endDate: site.endDate,
            }}
            counts={counts}
          />
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-muted-foreground">
          {site.client !== null && site.client !== '' ? (
            <span>
              {t('detailClient')}: {site.client}
            </span>
          ) : null}
          {isProject && (site.startDate !== null || site.endDate !== null) ? (
            <span>
              {t('detailTimeline')}:{' '}
              {site.startDate !== null
                ? format.dateTime(new Date(site.startDate), { dateStyle: 'medium' })
                : '—'}{' '}
              →{' '}
              {site.endDate !== null
                ? format.dateTime(new Date(site.endDate), { dateStyle: 'medium' })
                : '—'}
            </span>
          ) : null}
        </div>
      </header>

      <div className="border-b border-slate-300 dark:border-slate-700">
        <nav aria-label={t('title')} className="flex gap-1 overflow-x-auto no-scrollbar">
          {(['overview', 'media', 'plans', 'team'] as const).map((key) => {
            const active = tab === key;
            const label =
              key === 'overview'
                ? t('tabOverview')
                : key === 'media'
                  ? t('tabMedia')
                  : key === 'plans'
                    ? t('tabPlans')
                    : t('tabTeam');
            return (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  '-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-sm transition-colors',
                  active
                    ? 'border-[#234fe1] font-medium text-[#234fe1]'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                {label}
              </button>
            );
          })}
        </nav>
      </div>

      <div className="mt-4">
        {tab === 'overview' ? (
          <div className="space-y-4">
            <SiteOverview siteId={siteId} locale={locale} onOpenTab={setTab} />
            <SiteLocationCard
              siteId={siteId}
              latitude={site.latitude}
              longitude={site.longitude}
              locationAddress={site.locationAddress}
            />
          </div>
        ) : null}
        {tab === 'media' ? <SiteMediaGallery siteId={siteId} /> : null}
        {tab === 'plans' ? <SitePlansViewer siteId={siteId} /> : null}
        {tab === 'team' ? <SiteTeamAccess siteId={siteId} /> : null}
      </div>
    </div>
  );
}
