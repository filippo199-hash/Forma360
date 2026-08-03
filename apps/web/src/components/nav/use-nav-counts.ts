'use client';

/**
 * The numbers the menu is allowed to show (ADR 0014).
 *
 * One poll, shared by the sidebar, the mobile drawer and the tab bar —
 * React Query dedupes them because they issue the same query key. Failure
 * is silent: a menu that renders an error where a count should be is
 * worse than a menu with no count, and the count is never the reason the
 * viewer opened the page.
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
  return {
    myWork: data.total,
    approvals: data.awaitingApproval,
    actions: data.myOpenActions,
    headsUp: data.myPendingAcks,
  };
}
