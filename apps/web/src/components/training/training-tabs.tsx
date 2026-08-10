'use client';

/**
 * Module tab bar, matching the Inspections section pattern so the module
 * reads as part of the same product.
 *
 * Order is the panel's priority order, not the database's: the **gap
 * list leads** because it is what a practitioner opens on a Tuesday
 * morning; the grid is the monthly review artefact; compliance is the
 * board number; requirements is admin.
 *
 * Two review fixes live here:
 *   - **TR-B11** — "My training" is a tab. The one page built for
 *     ordinary staff used to sit outside the module's own navigation:
 *     you arrived from a link and left with the browser back button.
 *   - **TR-B10** — the three org-wide tabs are gated on `training.view`,
 *     which the Standard set no longer holds. A user without it sees
 *     exactly one tab: their own. The server enforces the same rule; this
 *     is the UX half (ground rule 6).
 */
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useHasPermission } from '../../lib/permissions-context';

export type TrainingTab = 'me' | 'gaps' | 'matrix' | 'compliance' | 'requirements';

const TAB_PATHS: Record<TrainingTab, string> = {
  me: '/training/me',
  gaps: '/training',
  matrix: '/training/matrix',
  compliance: '/training/compliance',
  requirements: '/training/requirements',
};

export function TrainingTabs({ activeTab, locale }: { activeTab: TrainingTab; locale: string }) {
  const t = useTranslations('training.tabs');
  const canViewOrg = useHasPermission('training.view');
  const canManage = useHasPermission('training.manage');

  const tabs: TrainingTab[] = [
    // Always: your own record needs no permission.
    'me',
    ...(canViewOrg ? (['gaps', 'matrix', 'compliance'] as const) : []),
    ...(canManage ? (['requirements'] as const) : []),
  ];

  return (
    <div className="mb-6 flex gap-1 overflow-x-auto no-scrollbar border-b border-slate-300 dark:border-slate-700">
      {tabs.map((tab) => (
        <Link
          key={tab}
          href={`/${locale}${TAB_PATHS[tab]}`}
          aria-current={activeTab === tab ? 'page' : undefined}
          className={`-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
            activeTab === tab
              ? 'border-primary font-semibold text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          {t(tab)}
        </Link>
      ))}
    </div>
  );
}
