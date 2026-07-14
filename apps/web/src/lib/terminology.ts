'use client';

import type { SiteTerminology } from '@forma360/db/schema';
import { useTranslations } from 'next-intl';
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

/** i18n key (sites namespace) for the singular place noun — "Site" / "Project". */
export function placeLabelKey(term: SiteTerminology): 'kindSite' | 'kindProject' | 'kindSiteProject' {
  if (term === 'sites') return 'kindSite';
  if (term === 'projects') return 'kindProject';
  return 'kindSiteProject';
}

/**
 * Terminology-aware place labels for forms/selectors. `label` is the singular
 * field noun ("Site" / "Project" / "Site / Project"); `selectPlaceholder` is
 * the picker's empty-state ("Select a project"). Respects the tenant setting so
 * every place-picker reads the way the user configured it.
 */
export function usePlaceTerms(): {
  term: SiteTerminology;
  /** Singular field noun — "Site" / "Project" / "Site / Project". */
  label: string;
  /** Plural noun — "Sites" / "Projects" / "Sites & Projects". */
  labelPlural: string;
  /** Picker empty-state — "Select a project". */
  selectPlaceholder: string;
  /** Multi-select "add" placeholder — "Add projects". */
  addPlaceholder: string;
} {
  const term = useTerminology();
  const t = useTranslations('sites');
  const tNav = useTranslations('nav');
  const selectKey =
    term === 'sites' ? 'selectSite' : term === 'projects' ? 'selectProject' : 'selectSiteProject';
  const addKey =
    term === 'sites' ? 'addSites' : term === 'projects' ? 'addProjects' : 'addSitesProjects';
  return {
    term,
    label: t(placeLabelKey(term)),
    labelPlural: tNav(navLabelKey(term)),
    selectPlaceholder: t(selectKey),
    addPlaceholder: t(addKey),
  };
}
