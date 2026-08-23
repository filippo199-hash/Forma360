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
  { key: 'headsUp', labelKey: 'categories.headsUp', basePath: 'briefings', icon: 'headsUp' },
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
  {
    // BUG-10: a PEEP lives on its building's page, so the result routes to
    // the building — the router returns the building id for exactly that
    // reason. A night carer searching a resident's name lands on the plan.
    key: 'firePeeps',
    labelKey: 'categories.firePeeps',
    basePath: 'fire-safety/peeps',
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
  {
    // NR3-06: reviews of CONTRACTORS' packs live on the shared reviews
    // workspace, so the hit routes through a thin redirect that lands
    // with the review preselected (the PEEP/BUG-10 precedent).
    key: 'ramsReviews',
    labelKey: 'categories.ramsReviews',
    basePath: 'rams/reviews',
    icon: 'document',
  },
  // TR-A13: training was in the nav but not in Cmd-K — the same bug a
  // third time, and the reason this list has a test.
  // TR-B3: people, at a route that exists. `training/requirements/<id>`
  // was never a route, so every training hit 404'd.
  {
    key: 'training',
    labelKey: 'categories.training',
    basePath: 'training/person',
    icon: 'action',
  },
];
