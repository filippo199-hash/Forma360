'use client';

import type { SiteTerminology } from '@forma360/db/schema';
import { trpc } from './trpc/client';

/**
 * The tenant's chosen terminology for its places (Settings → Company).
 * Defaults to `'both'` (the historical behaviour) until an admin picks
 * otherwise. Backed by the cached `tenants.get` query, so calling this in
 * several components in a page costs one request.
 */
export function useTerminology(): SiteTerminology {
  const { data } = trpc.tenants.get.useQuery();
  return data?.tenant.settings?.terminology ?? 'both';
}

/** i18n key under the `nav` namespace for the top-level places item. */
export function navLabelKey(term: SiteTerminology): 'sites' | 'projects' | 'sitesAndProjects' {
  if (term === 'sites') return 'sites';
  if (term === 'projects') return 'projects';
  return 'sitesAndProjects';
}

/** i18n key under the `sites` namespace for the hub page title. */
export function hubTitleKey(term: SiteTerminology): 'titleSites' | 'titleProjects' | 'title' {
  if (term === 'sites') return 'titleSites';
  if (term === 'projects') return 'titleProjects';
  return 'title';
}
