'use client';

/**
 * Module tab bar, matching the Inspections section pattern so the module
 * reads as part of the same product.
 *
 * Order is the panel's priority order, not the database's: the **gap
 * list leads** because it is what a practitioner opens on a Tuesday
 * morning; the grid is the monthly review artefact; compliance is the
 * board number; requirements is admin.
 */
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useHasPermission } from '../../lib/permissions-context';

export type TrainingTab = 'gaps' | 'matrix' | 'compliance' | 'requirements';

const TAB_PATHS: Record<TrainingTab, string> = {
  gaps: '/training',
  matrix: '/training/matrix',
  compliance: '/training/compliance',
  requirements: '/training/requirements',
};

export function TrainingTabs({ activeTab, locale }: { activeTab: TrainingTab; locale: string }) {
  const t = useTranslations('training.tabs');
  const canManage = useHasPermission('training.manage');
  const tabs: TrainingTab[] = canManage
    ? ['gaps', 'matrix', 'compliance', 'requirements']
    : ['gaps', 'matrix', 'compliance'];

  return (
    <div className="mb-6 flex gap-1 overflow-x-auto border-b">
      {tabs.map((tab) => (
        <Link
          key={tab}
          href={`/${locale}${TAB_PATHS[tab]}`}
          aria-current={activeTab === tab ? 'page' : undefined}
          className={`-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
            activeTab === tab
              ? 'border-foreground font-semibold text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          {t(tab)}
        </Link>
      ))}
    </div>
  );
}
