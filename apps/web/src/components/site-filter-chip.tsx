'use client';

import { Building2, MapPin, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { trpc } from '../lib/trpc/client';

/**
 * Reads the `?site=<id>` query param that the Sites/Projects hub detail
 * tiles link with, and hands back the id (for the list query) plus a
 * `clear()` that strips the param from the URL. Pages pass `siteId` into
 * their tRPC list input and render {@link SiteFilterChip} so the active
 * filter is visible and dismissible.
 */
export function useSiteFilterParam(): { siteId: string; clear: () => void } {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const siteId = searchParams.get('site') ?? '';

  function clear(): void {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('site');
    const qs = params.toString();
    router.replace(qs.length > 0 ? `${pathname}?${qs}` : pathname);
  }

  return { siteId, clear };
}

/**
 * A dismissible pill showing which site/project a module list is filtered
 * to. Resolves the name via `sites.list` (cached); degrades gracefully to a
 * placeholder if the viewer lacks `sites.view` or the site is archived.
 */
export function SiteFilterChip({
  siteId,
  onClear,
}: {
  siteId: string;
  onClear: () => void;
}): React.ReactElement | null {
  const t = useTranslations('sites');
  const { data: sites } = trpc.sites.list.useQuery(undefined, { enabled: siteId !== '' });

  if (siteId === '') return null;

  const site = sites?.find((s) => s.id === siteId);
  const isProject = site?.kind === 'project';

  return (
    <div className="inline-flex items-center gap-2 rounded-full border bg-muted/40 py-1 pl-3 pr-1.5 text-sm">
      {isProject ? (
        <MapPin className="h-3.5 w-3.5 text-primary" />
      ) : (
        <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
      )}
      <span className="text-muted-foreground">{t('filteredBy')}</span>
      <span className="font-medium">{site?.name ?? '…'}</span>
      <button
        type="button"
        onClick={onClear}
        aria-label={t('clearFilter')}
        className="ml-0.5 rounded-full p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
