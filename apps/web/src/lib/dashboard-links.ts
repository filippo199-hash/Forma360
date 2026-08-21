/**
 * Drill-down targets for dashboard widgets (ADR 0018).
 *
 * Every widget links back to the module register its numbers come from —
 * the "where is this data from" answer. Registers enforce their own
 * access rules, so a viewer who can see a count but not the records hits
 * the module's own gate, not ours.
 */
import type { DashboardSourceId } from '@forma360/shared/dashboard-sources';

const REGISTER_PATHS: Record<DashboardSourceId, string> = {
  actions: '/actions',
  inspections: '/inspections',
  observations: '/observations',
  headsUp: '/briefings',
  incidents: '/incidents',
  permits: '/permits',
  riskAssessments: '/risk-assessments',
  coshh: '/coshh',
  fireSafety: '/fire-safety',
  rams: '/rams',
  training: '/training',
};

export function registerHref(locale: string, source: DashboardSourceId): string {
  return `/${locale}${REGISTER_PATHS[source]}`;
}
