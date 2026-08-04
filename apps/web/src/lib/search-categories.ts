/**
 * The Cmd-K result vocabulary — one row per category `search.global` returns.
 *
 * PF-6 and RS-A9 were the same bug twice: the server started returning a new
 * category (brand modules, then RAMS) and the palette silently dropped every
 * hit because it iterates a hand-maintained list. Keeping that list here, next
 * to a test that walks the router's return shape, turns "we forgot" into a
 * failing test instead of a category nobody can search.
 */

export type SearchIconKey =
  | 'asset'
  | 'inspection'
  | 'observation'
  | 'action'
  | 'headsUp'
  | 'document'
  | 'incident';

export interface SearchCategoryDef {
  /** Key on the `search.global` result object. */
  key: string;
  /** Key inside the `search` i18n namespace. */
  labelKey: string;
  /** Path segment prepended to `/{locale}/…/{id}`. */
  basePath: string;
  /** Which icon the palette draws for this category. */
  icon: SearchIconKey;
}

export const SEARCH_CATEGORIES: ReadonlyArray<SearchCategoryDef> = [
  { key: 'assets', labelKey: 'categories.assets', basePath: 'assets', icon: 'asset' },
  {
    key: 'inspections',
    labelKey: 'categories.inspections',
    basePath: 'inspections',
    icon: 'inspection',
  },
  {
    key: 'observations',
    labelKey: 'categories.observations',
    basePath: 'observations',
    icon: 'observation',
  },
  { key: 'actions', labelKey: 'categories.actions', basePath: 'actions', icon: 'action' },
  { key: 'headsUp', labelKey: 'categories.headsUp', basePath: 'heads-up', icon: 'headsUp' },
  { key: 'documents', labelKey: 'categories.documents', basePath: 'documents', icon: 'document' },
  // PF-6: the brand modules, contractors, sites and templates were invisible
  // to Cmd-K until this block landed.
  { key: 'permits', labelKey: 'categories.permits', basePath: 'permits', icon: 'document' },
  { key: 'coshh', labelKey: 'categories.coshh', basePath: 'coshh', icon: 'asset' },
  {
    key: 'riskAssessments',
    labelKey: 'categories.riskAssessments',
    basePath: 'risk-assessments',
    icon: 'inspection',
  },
  {
    key: 'fireBuildings',
    labelKey: 'categories.fireBuildings',
    basePath: 'fire-safety',
    icon: 'observation',
  },
  {
    key: 'fireRiskAssessments',
    labelKey: 'categories.fireRiskAssessments',
    basePath: 'fire-safety/fra',
    icon: 'observation',
  },
  { key: 'incidents', labelKey: 'categories.incidents', basePath: 'incidents', icon: 'incident' },
  {
    key: 'contractors',
    labelKey: 'categories.contractors',
    basePath: 'contractors',
    icon: 'action',
  },
  { key: 'sites', labelKey: 'categories.sites', basePath: 'sites', icon: 'asset' },
  { key: 'templates', labelKey: 'categories.templates', basePath: 'templates', icon: 'inspection' },
  // RS-A9: the server has returned RAMS hits since the module landed.
  { key: 'rams', labelKey: 'categories.rams', basePath: 'rams', icon: 'inspection' },
];
