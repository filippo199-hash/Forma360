'use client';

/**
 * The numbers the menu is allowed to show (ADR 0014, extended by the
 * navigation review's recommendation 1).
 *
 * One poll, shared by the sidebar, the mobile drawer and the tab bar —
 * React Query dedupes them because they issue the same query key. The
 * payload carries both the caller's own queues and the per-module
 * needs-attention numbers, so a sixteen-entry menu still costs exactly
 * one request. Failure is silent: a menu that renders an error where a
 * count should be is worse than a menu with no count, and the count is
 * never the reason the viewer opened the page.
 */
import type { NavBadgeKey } from '../../lib/nav-model';
import { trpc } from '../../lib/trpc/client';

export type NavCounts = Readonly<Partial<Record<NavBadgeKey, number>>>;

/** Poll interval for the menu badges. Matches the notification bell. */
export const NAV_COUNTS_POLL_MS = 60_000;

export function useNavCounts(): NavCounts {
  const query = trpc.myWork.counts.useQuery(undefined, {
    refetchInterval: NAV_COUNTS_POLL_MS,
    retry: false,
  });
  const data = query.data;
  if (data === undefined) return {};
  const modules = data.modules;
  return {
    myActions: data.myOpenActions,
    myAcknowledgements: data.myPendingAcks,
    approvals: data.awaitingApproval,
    actions: data.myOpenActions,
    ...(modules.incidents !== undefined ? { incidents: modules.incidents } : {}),
    ...(modules.permits !== undefined ? { permits: modules.permits } : {}),
    ...(modules.riskAssessments !== undefined ? { riskAssessments: modules.riskAssessments } : {}),
    ...(modules.fireSafety !== undefined ? { fireSafety: modules.fireSafety } : {}),
  };
}
